/**
 * Agent runtime for the deeptutor TUI.
 *
 * Owns the pi-ai models collection, the AgentHarness, and live configuration.
 * Supports runtime model switching (like pi coding agent's /model), in-TUI
 * Brave configuration (web_search tool rebuild), and session replacement.
 */
import { AgentHarness } from "@earendil-works/pi-agent-core";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import type { Session, JsonlSessionMetadata, AgentHarnessTool } from "@earendil-works/pi-agent-core";
import type { Config, SearchConfig, ToolContext } from "../types.js";
import { saveConfig } from "../config.js";
import { loadSkills, loadPromptTemplates } from "./resources.js";
import { createWebSearchTool } from "../tools/web_search.js";
import { createKBManagerTools } from "../tools/kb_manager.js";
import { createPythonRunnerTool } from "../tools/python_runner.js";
import { createMasteryTools } from "../tools/mastery.js";
import { createKnowledgeTools } from "../tools/knowledge.js";

/** OpenAI-compatible provider id (Ollama etc.). */
export const PROVIDER_ID = "openai-compat";
/** OpenCode Zen Go provider id (deepseek-v4-flash etc.). */
export const OPENCODE_GO_PROVIDER_ID = "opencode-go";

const SYSTEM_PROMPT = `You are deeptutor, a document tutoring assistant. You help learners study documents from a knowledge base using:
- knowledge_search / knowledge_add (RAG over the active knowledge base)
- web_search (Brave) for real-time information
- python_run for executing Python code (visualization, computation)
- kb_switch / kb_list / kb_create for knowledge base management
- mastery_* tools for structured learning paths (mastery_generate, mastery_quiz, mastery_grade, mastery_status, etc.)

Rules:
- Ground answers in the knowledge base first; cite sources when available.
- When a quiz question is presented interactively, the learner's answer is captured by the tool — call mastery_grade with the returned userAnswer, do NOT re-present the question.
- For code questions, include code blocks in the question text.
- Keep explanations concise and well-structured.`;

/** One selectable model in the TUI model picker. */
export interface ModelChoice {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  baseUrl?: string;
  reasoning: boolean;
}

function openAICompatModel(cfg: Config, modelId: string, baseUrl: string): Model<"openai-completions"> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 8192,
  };
}

function openAICompatProvider(
  cfg: Config,
  model: Model<"openai-completions">
): ReturnType<typeof createProvider> {
  return createProvider({
    id: PROVIDER_ID,
    name: "OpenAI Compatible",
    baseUrl: model.baseUrl,
    auth: {
      apiKey: {
        name: "OpenAI Compatible API key",
        resolve: async () => ({
          auth: { apiKey: cfg.model.apiKey ?? "ollama" },
          source: "config",
        }),
      },
    },
    models: [model],
    api: openAICompletionsApi(),
  });
}

/** Build all deeptutor tools for the given config. */
export function buildTools(config: Config): AgentHarnessTool<ToolContext>[] {
  return [
    createWebSearchTool(config.search),
    ...createKBManagerTools(config.kb),
    createPythonRunnerTool(config.python, config.kb),
    ...createMasteryTools(config.kb),
    ...createKnowledgeTools(config.kb, config.model),
  ];
}

/**
 * The runtime owns the mutable models collection + harness and exposes
 * live switches: model switching, Brave config updates, session swap.
 */
export class DeeptutorRuntime {
  readonly config: Config;
  readonly models: MutableModels;
  readonly session: Session<JsonlSessionMetadata>;
  harness: AgentHarness<ToolContext>;
  private readonly ask?: ToolContext["ask"];

  constructor(config: Config, session: Session<JsonlSessionMetadata>, ask?: ToolContext["ask"]) {
    this.config = config;
    this.session = session;
    this.ask = ask;
    this.models = createModels();
    this.harness = this.buildHarness();
  }

  private buildHarness(): AgentHarness<ToolContext> {
    const model = this.resolveModel(this.config.model.provider ?? "openai-compat", this.config.model.model);
    const toolContext: ToolContext = this.ask ? { ask: this.ask } : {};
    return new AgentHarness({
      session: this.session,
      models: this.models,
      tools: buildTools(this.config),
      resources: {
        skills: loadSkills(),
        promptTemplates: loadPromptTemplates(),
      },
      systemPrompt: SYSTEM_PROMPT,
      model,
      toolContext,
    });
  }

  /** Resolve (and register if needed) a model in the models collection. */
  private resolveModel(providerId: string, modelId: string): Model<any> {
    if (providerId === OPENCODE_GO_PROVIDER_ID) {
      if (!this.models.getProvider(OPENCODE_GO_PROVIDER_ID)) {
        this.models.setProvider(opencodeGoProvider());
      }
      const m = this.models.getModel(OPENCODE_GO_PROVIDER_ID, modelId);
      if (!m) {
        throw new Error(
          `Model "${modelId}" not found in opencode-go provider. Available ids include deepseek-v4-flash, deepseek-v4-pro, glm-5.1, qwen3.6-plus.`
        );
      }
      return m;
    }
    // openai-compat: (re)register a custom provider with the current endpoint.
    const model = openAICompatModel(this.config, modelId, this.config.model.baseUrl);
    this.models.setProvider(openAICompatProvider(this.config, model));
    return model;
  }

  /** All selectable models across providers (for the TUI picker). */
  listModelChoices(): ModelChoice[] {
    const out: ModelChoice[] = [];
    // opencode-go built-in catalog
    if (!this.models.getProvider(OPENCODE_GO_PROVIDER_ID)) {
      this.models.setProvider(opencodeGoProvider());
    }
    for (const m of this.models.getModels(OPENCODE_GO_PROVIDER_ID)) {
      out.push({
        providerId: OPENCODE_GO_PROVIDER_ID,
        providerName: "OpenCode Zen Go",
        modelId: m.id,
        modelName: m.name,
        baseUrl: m.baseUrl,
        reasoning: m.reasoning,
      });
    }
    // current openai-compat endpoint (single custom model)
    const c = this.config.model;
    out.push({
      providerId: PROVIDER_ID,
      providerName: "OpenAI Compatible",
      modelId: c.model,
      modelName: c.model,
      baseUrl: c.baseUrl,
      reasoning: false,
    });
    return out;
  }

  /**
   * Switch the active model at runtime. Persists to ~/.deeptutor/config.json.
   * For openai-compat, an optional baseUrl/apiKey can be supplied (custom endpoint).
   */
  async switchModel(providerId: string, modelId: string, opts?: { baseUrl?: string; apiKey?: string }): Promise<Model<any>> {
    const cfg = this.config.model;
    if (providerId === PROVIDER_ID) {
      cfg.provider = PROVIDER_ID;
      cfg.model = modelId;
      if (opts?.baseUrl) cfg.baseUrl = opts.baseUrl;
      if (opts?.apiKey !== undefined) cfg.apiKey = opts.apiKey;
    } else if (providerId === OPENCODE_GO_PROVIDER_ID) {
      cfg.provider = OPENCODE_GO_PROVIDER_ID;
      cfg.model = modelId;
    } else {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    const model = this.resolveModel(cfg.provider, cfg.model);
    await this.harness.setModel(model);
    saveConfig(this.config);
    return model;
  }

  /** Update Brave search config live (rebuilds the web_search tool). */
  async updateSearch(patch: Partial<SearchConfig>): Promise<void> {
    Object.assign(this.config.search, patch);
    const tools = buildTools(this.config);
    await this.harness.setTools(tools);
    saveConfig(this.config);
  }

  /** Swap to another session (new harness on the same models collection). */
  async setSession(session: Session<JsonlSessionMetadata>): Promise<void> {
    (this as { session: Session<JsonlSessionMetadata> }).session = session;
    this.harness = this.buildHarness();
  }

  /** Current model descriptor (for the status bar). */
  currentModel(): ModelChoice {
    const c = this.config.model;
    const m = this.harness.getModel();
    return {
      providerId: c.provider ?? PROVIDER_ID,
      providerName: c.provider === OPENCODE_GO_PROVIDER_ID ? "OpenCode Zen Go" : "OpenAI Compatible",
      modelId: c.model,
      modelName: m.name ?? c.model,
      baseUrl: m.baseUrl ?? c.baseUrl,
      reasoning: m.reasoning ?? false,
    };
  }
}

export type DeeptutorHarness = AgentHarness<ToolContext>;
