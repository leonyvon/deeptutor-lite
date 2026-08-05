/**
 * Agent harness assembly for the deeptutor standalone app.
 *
 * Wires together: pi-ai models (OpenAI-compatible endpoint, e.g. Ollama, or
 * the built-in OpenCode Zen Go provider), pi-agent-core AgentHarness,
 * deeptutor tools, skills/prompt templates, JSONL session, and the
 * interactive tool context (ctx.ask → clack select).
 */
import { AgentHarness } from "@earendil-works/pi-agent-core";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import type { Model } from "@earendil-works/pi-ai";
import type { Session } from "@earendil-works/pi-agent-core";
import type { Config, ToolContext } from "../types.js";
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

function buildModels(cfg: Config): { models: ReturnType<typeof createModels>; model: Model<any> } {
  const models = createModels();
  const modelId = cfg.model.model;

  if (cfg.model.provider === "opencode-go") {
    // Built-in OpenCode Zen Go provider: models catalog includes
    // deepseek-v4-flash etc. Auth resolves via OPENCODE_API_KEY.
    models.setProvider(opencodeGoProvider());
    const model = models.getModel(OPENCODE_GO_PROVIDER_ID, modelId);
    if (!model) {
      throw new Error(
        `Model "${modelId}" not found in opencode-go provider. Available ids include deepseek-v4-flash, deepseek-v4-pro, glm-5.1, qwen3.6-plus.`
      );
    }
    return { models, model };
  }

  // Default: custom OpenAI-compatible endpoint (Ollama etc.).
  const model: Model<"openai-completions"> = {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: cfg.model.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 8192,
  };

  const provider = createProvider({
    id: PROVIDER_ID,
    name: "OpenAI Compatible",
    baseUrl: cfg.model.baseUrl,
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

  models.setProvider(provider);
  return { models, model: models.getModel(PROVIDER_ID, modelId) ?? model };
}

export interface HarnessDeps {
  config: Config;
  session: Session;
  ask?: ToolContext["ask"];
}

export function buildHarness({ config, session, ask }: HarnessDeps) {
  const { models, model } = buildModels(config);
  const toolContext: ToolContext = ask ? { ask } : {};

  const tools = [
    createWebSearchTool(config.search),
    ...createKBManagerTools(config.kb),
    createPythonRunnerTool(config.python, config.kb),
    ...createMasteryTools(config.kb),
    ...createKnowledgeTools(config.kb, config.model),
  ];

  const harness = new AgentHarness({
    session,
    models,
    tools,
    resources: {
      skills: loadSkills(),
      promptTemplates: loadPromptTemplates(),
    },
    systemPrompt: SYSTEM_PROMPT,
    model,
    toolContext,
  });

  return harness;
}

export type DeeptutorHarness = AgentHarness<ToolContext>;
