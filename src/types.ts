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
   * "anthropic", "openai", "openrouter", ...). No default: the user must
   * pick one via /model.
   */
  provider?: string;
  /** Model id, e.g. deepseek-v4-flash */
  model?: string;
  /** Optional API key for the provider. */
  apiKey?: string;
  /** Embedding model id used for RAG (OpenAI-compatible embedding service). */
  embeddingModel: string;
  /** OpenAI-compatible base URL of the embedding service (RAG). */
  embeddingBaseUrl: string;
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
