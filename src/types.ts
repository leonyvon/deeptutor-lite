/**
 * Shared type contracts for the deeptutor standalone app.
 */

/** Context passed to every tool execution (AgentHarness toolContext). */
export interface ToolContext {
  /**
   * Interactive choice prompt (injected by the REPL). Resolves to a string
   * like "A: <option text>" (same format as the old pi TUI flow), or null
   * when the user cancels. Undefined when running headless — tools must
   * fall back to text mode.
   */
  ask?: (question: string, options: Record<string, string>) => Promise<string | null>;
}

export interface SearchConfig {
  provider: string;
  apiKey: string;
  proxy?: string;
  maxResults: number;
}

export interface KBConfig {
  /** Root directory holding one subdirectory per knowledge base. */
  rootDir: string;
  /** Directory for the RAG index (sqlite + vectors). */
  indexDir: string;
  defaultKB: string;
}

export interface PythonConfig {
  timeout: number;
  maxTimeout: number;
}

export interface ModelConfig {
  /**
   * Provider backend id. Any built-in pi-ai provider (e.g. "opencode-go",
   * "anthropic", "openai", "openrouter", ...) or "openai-compat" for a
   * custom OpenAI-compatible endpoint (Ollama etc.).
   */
  provider?: string;
  /**
   * OpenAI-compatible base URL, e.g. http://127.0.0.1:11434/v1.
   * Only meaningful for "openai-compat"; ignored for built-in providers
   * (which use their catalog endpoint).
   */
  baseUrl?: string;
  /** Model id, e.g. qwen3:8b or deepseek-v4-flash */
  model: string;
  /** Optional API key for the openai-compat endpoint. */
  apiKey?: string;
  /** Embedding model id used for RAG and semantic grading. */
  embeddingModel: string;
}

export interface SessionConfig {
  /** Directory for JSONL session files. */
  dir: string;
}

export interface Config {
  search: SearchConfig;
  kb: KBConfig;
  python: PythonConfig;
  model: ModelConfig;
  session: SessionConfig;
}
