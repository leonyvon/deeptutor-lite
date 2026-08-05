/**
 * Configuration loading: defaults <- config.json (app root) <- ~/.deeptutor/config.json
 * with ${ENV_VAR} reference resolution (same mechanism as the old pi extension).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** App data root: ~/.deeptutor (overridable via DEEPTUTOR_HOME). */
export function dataHome(): string {
  return process.env.DEEPTUTOR_HOME ?? join(homedir(), ".deeptutor");
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

function expandHome(p: string): string {
  return p.replace(/^~\//, homedir() + "/");
}

function defaults(): Config {
  const home = dataHome();
  return {
    search: {
      provider: "brave",
      apiKey: "",
      proxy: "http://127.0.0.1:7897",
      maxResults: 5,
    },
    kb: {
      rootDir: join(home, "kbs"),
      indexDir: join(home, "knowledge"),
      defaultKB: "default",
    },
    python: {
      timeout: 30,
      maxTimeout: 300,
    },
    model: {
      provider: "openai-compat",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen3:8b",
      embeddingModel: "nomic-embed-text",
    },
    session: {
      dir: join(home, "sessions"),
    },
  };
}

/** Candidate config files, later ones override earlier ones. */
function configCandidates(): string[] {
  const appRoot = join(__dirname, "..");
  return [
    join(appRoot, "config.json"),
    join(dataHome(), "config.json"),
  ];
}

function deepMerge<T extends Record<string, any>>(base: T, patch: unknown): T {
  if (typeof patch !== "object" || patch === null) return base;
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch as Record<string, any>)) {
    if (v !== undefined && v !== null) {
      out[k] =
        typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && out[k] !== null
          ? deepMerge(out[k], v)
          : v;
    }
  }
  return out as T;
}

export function loadConfig(): Config {
  let cfg = defaults();
  for (const path of configCandidates()) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      cfg = deepMerge(cfg, raw);
    } catch {
      // missing or unreadable file — keep current config
    }
  }
  // Resolve env var references + home expansion on string fields
  const resolve = (c: Config): Config => ({
    ...c,
    search: { ...c.search, apiKey: resolveEnvVars(c.search.apiKey), proxy: c.search.proxy ? expandHome(c.search.proxy) : undefined },
    kb: { ...c.kb, rootDir: expandHome(resolveEnvVars(c.kb.rootDir)), indexDir: expandHome(resolveEnvVars(c.kb.indexDir)), defaultKB: resolveEnvVars(c.kb.defaultKB) },
    python: { ...c.python },
    model: { ...c.model, provider: c.model.provider ?? "openai-compat", baseUrl: resolveEnvVars(c.model.baseUrl), model: resolveEnvVars(c.model.model), embeddingModel: resolveEnvVars(c.model.embeddingModel), apiKey: c.model.apiKey ? resolveEnvVars(c.model.apiKey) : undefined },
    session: { ...c.session, dir: expandHome(resolveEnvVars(c.session.dir)) },
  });
  return resolve(cfg);
}

/**
 * Persist config to ~/.deeptutor/config.json (the user-level override file).
 * Used by the in-TUI settings (model switch, Brave config). The app-root
 * config.json is left untouched.
 */
export function saveConfig(cfg: Config): string {
  const home = dataHome();
  const path = join(home, "config.json");
  mkdirSync(home, { recursive: true });
  const serializable = {
    search: cfg.search,
    kb: cfg.kb,
    python: cfg.python,
    model: cfg.model,
    session: cfg.session,
  };
  writeFileSync(path, JSON.stringify(serializable, null, 2), "utf-8");
  return path;
}
