/**
 * Agent runtime for the deeptutor TUI.
 *
 * Owns the pi-ai models collection (full built-in catalog: every provider
 * from @earendil-works/pi-ai), the AgentHarness, and live configuration.
 * Supports runtime model switching (like pi coding agent's /model), in-TUI
 * Brave configuration (web_search tool rebuild), and session replacement.
 *
 * Auth mirrors pi: a file CredentialStore (~/.deeptutor/auth.json) holds
 * per-provider API keys; envApiKeyAuth resolves stored keys first, then
 * falls back to environment variables.
 */
import { AgentHarness } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { Session, JsonlSessionMetadata, JsonlSessionRepo, AgentHarnessTool } from "@earendil-works/pi-agent-core";
import type { Config, SearchConfig, ToolContext } from "../types.js";
import { saveConfig } from "../config.js";
import { FileCredentialStore } from "../auth-store.js";
import { loadSkills, loadPromptTemplates } from "./resources.js";
import { createWebSearchTool } from "../tools/web_search.js";
import { createKBManagerTools } from "../tools/kb_manager.js";
import { createPythonRunnerTool } from "../tools/python_runner.js";
import { createMasteryTools } from "../tools/mastery.js";
import { createKnowledgeTools } from "../tools/knowledge.js";
import { createAskUserTool } from "../tools/ask_user.js";

const SYSTEM_PROMPT = `You are deeptutor, a document tutoring assistant. You help learners study documents from a knowledge base using:
- knowledge_search / knowledge_add (RAG over the active knowledge base)
- web_search (Brave) for real-time information
- python_run for executing Python code (visualization, computation)
- kb_switch / kb_list / kb_create for knowledge base management
- mastery_* tools for structured learning paths (mastery_generate, mastery_quiz, mastery_grade, mastery_status, etc.)
- ui_ask for INTERACTIVE multiple-choice questions

Rules:
- For MASTERY PATH quiz questions: ALWAYS use mastery_quiz. For choice questions pass question_type="choice" together with the options — the TUI pops the interactive picker and mastery_grade records the result. Never use ui_ask for mastery quiz questions.
- Use ui_ask only for multiple-choice questions that are NOT part of the mastery path (e.g. conversational choices, letting the learner pick a direction).
- When using ui_ask or mastery_quiz with options, keep the question text free of the options — the interactive picker displays them.
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

/** Build all deeptutor tools for the given config. */
export function buildTools(config: Config): AgentHarnessTool<ToolContext>[] {
  return [
    createWebSearchTool(config.search),
    ...createKBManagerTools(config.kb),
    createPythonRunnerTool(config.python, config.kb),
    ...createMasteryTools(config.kb),
    ...createKnowledgeTools(config.kb, config.model),
    createAskUserTool(),
  ];
}

/**
 * The runtime owns the mutable models collection + harness and exposes
 * live switches: model switching, Brave config updates, session swap.
 */
export class DeeptutorRuntime {
  readonly config: Config;
  readonly models: MutableModels;
  session: Session<JsonlSessionMetadata> | null;
  harness: AgentHarness<ToolContext> | null;
  private readonly ask?: ToolContext["ask"];
  private readonly credentials: FileCredentialStore;

  constructor(config: Config, session: Session<JsonlSessionMetadata> | null, ask?: ToolContext["ask"]) {
    this.config = config;
    this.session = session;
    this.ask = ask;
    this.credentials = new FileCredentialStore();
    this.models = createModels({ credentials: this.credentials });
    // Full pi built-in catalog: every provider from @earendil-works/pi-ai
    // (anthropic, openai, google, deepseek, openrouter, ... ~38 providers).
    for (const provider of builtinProviders()) {
      if (!this.models.getProvider(provider.id)) {
        this.models.setProvider(provider);
      }
    }
    // No session → no harness yet. The TUI lazily creates the session on the
    // first user message (via ensureSession) and builds the harness then.
    this.harness = session ? this.buildHarness() : null;
  }

  private buildHarness(): AgentHarness<ToolContext> {
    const session = this.session;
    if (!session) {
      throw new Error("Cannot build harness without a session");
    }
    const { provider, model: modelId } = this.config.model;
    if (!provider || !modelId) {
      throw new Error("No model configured. Run /model to select a model first.");
    }
    const model = this.resolveModel(provider, modelId);
    const toolContext: ToolContext = this.ask ? { ask: this.ask } : {};
    return new AgentHarness({
      session,
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

  /** Resolve a model in the built-in catalog. */
  private resolveModel(providerId: string, modelId: string): Model<any> {
    const provider = this.models.getProvider(providerId);
    if (!provider) {
      throw new Error(
        `Provider "${providerId}" not found. Run /model to pick from the built-in catalog.`
      );
    }
    const m = this.models.getModel(providerId, modelId);
    if (!m) {
      throw new Error(
        `Model "${modelId}" not found in provider "${providerId}". Run /model to pick from the catalog.`
      );
    }
    return m;
  }

  /** All selectable models across every built-in provider (for the TUI picker). */
  listModelChoices(): ModelChoice[] {
    const out: ModelChoice[] = [];
    for (const provider of this.models.getProviders()) {
      for (const m of this.models.getModels(provider.id)) {
        out.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId: m.id,
          modelName: m.name,
          baseUrl: m.baseUrl,
          reasoning: m.reasoning,
        });
      }
    }
    return out;
  }

  /**
   * Switch the active model at runtime. Persists to ~/.deeptutor/config.json.
   * Mirrors pi coding agent's /model: providers requiring an API key fail
   * loudly here (no silent switch to a broken model).
   */
  async switchModel(providerId: string, modelId: string, opts?: { apiKey?: string }): Promise<Model<any>> {
    const cfg = this.config.model;
    const provider = this.models.getProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    cfg.provider = providerId;
    cfg.model = modelId;
    if (opts?.apiKey !== undefined) await this.setApiKey(providerId, opts.apiKey);
    if (!(await this.authStatus(providerId)).configured) {
      throw new Error(
        `No API key for ${provider.name}. Press /model to enter one (saved to ~/.deeptutor/auth.json), or set its env var (e.g. OPENCODE_API_KEY).`
      );
    }
    const model = this.resolveModel(cfg.provider, cfg.model);
    // No harness yet (lazy session): the switch still persists and will be
    // applied by buildHarness when the session is created.
    if (this.harness) {
      await this.harness.setModel(model);
    }
    saveConfig(this.config);
    return model;
  }

  /**
   * Whether a provider needs an API key and whether one is configured.
   * Resolution order matches pi: stored credential (auth.json) → env vars.
   */
  async authStatus(providerId: string): Promise<{ needsKey: boolean; configured: boolean; source: string }> {
    const provider = this.models.getProvider(providerId);
    if (!provider) {
      return { needsKey: false, configured: false, source: "unknown provider" };
    }
    const auth = await this.models.getAuth(providerId);
    return {
      needsKey: Boolean(provider.auth?.apiKey),
      configured: Boolean(auth?.auth?.apiKey),
      source: auth?.source ?? "none",
    };
  }

  /** Store an API key for a provider (like pi's /login → auth.json). */
  async setApiKey(providerId: string, key: string): Promise<void> {
    if (!key.trim()) throw new Error("API key cannot be empty");
    await this.credentials.modify(providerId, async () => ({
      type: "api_key",
      key: key.trim(),
    }));
  }

  /** Update Brave search config live (rebuilds the web_search tool). */
  async updateSearch(patch: Partial<SearchConfig>): Promise<void> {
    Object.assign(this.config.search, patch);
    if (this.harness) {
      const tools = buildTools(this.config);
      await this.harness.setTools(tools);
    }
    saveConfig(this.config);
  }

  /** Swap to another session (new harness on the same models collection). */
  async setSession(session: Session<JsonlSessionMetadata>): Promise<void> {
    this.session = session;
    this.harness = this.buildHarness();
  }

  /**
   * Lazily create the session on the first user message: startup creates
   * nothing, so launching the TUI never leaves behind empty session files.
   * Builds the harness the first time a session exists.
   */
  async ensureSession(repo: JsonlSessionRepo): Promise<Session<JsonlSessionMetadata>> {
    if (!this.session) {
      const s = await repo.create({ cwd: process.cwd() });
      this.session = s;
      this.harness = this.buildHarness();
    }
    return this.session;
  }

  /** Current model descriptor (for the status bar). */
  currentModel(): ModelChoice {
    const c = this.config.model;
    const provider = c.provider ? this.models.getProvider(c.provider) : undefined;
    const harness = this.harness;
    if (!harness) {
      // No session yet: report the configured model without a live harness.
      return {
        providerId: c.provider ?? "none",
        providerName: provider?.name ?? "not set",
        modelId: c.model ?? "not set",
        modelName: c.model ?? "not set",
        baseUrl: undefined,
        reasoning: false,
      };
    }
    const m = harness.getModel();
    return {
      providerId: c.provider ?? "none",
      providerName: provider?.name ?? "not set",
      modelId: c.model ?? "not set",
      modelName: m.name ?? c.model ?? "not set",
      baseUrl: m.baseUrl,
      reasoning: m.reasoning ?? false,
    };
  }
}

export type DeeptutorHarness = AgentHarness<ToolContext>;
