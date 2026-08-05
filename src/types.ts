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
  /** OpenAI-compatible base URL, e.g. http://127.0.0.1:11434/v1 */
  baseUrl: string;
  /** Model id, e.g. qwen2.5-coder:14b or llama3.1 */
  model: string;
  /** Optional API key for OpenAI-compatible providers. */
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
