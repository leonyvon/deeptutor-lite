import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerBraveSearch } from "./src/brave_search.js";
import { registerKBManager } from "./src/kb_manager.js";
import { registerPythonRunner } from "./src/python_runner.js";
import { registerMasteryTracker } from "./src/mastery.js";

interface SearchConfig {
  provider: string;
  apiKey: string;
  proxy?: string;
  maxResults: number;
}

interface KBConfig {
  rootDir: string;
  defaultKB: string;
}

interface PythonConfig {
  timeout: number;
  maxTimeout: number;
}

interface Config {
  search: SearchConfig;
  kb: KBConfig;
  python: PythonConfig;
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

function resolveConfig(raw: any): Config {
  const search = raw.search ?? {};
  const kb = raw.kb ?? {};
  const python = raw.python ?? {};

  const home = homedir();

  return {
    search: {
      provider: search.provider ?? "brave",
      apiKey: resolveEnvVars(search.apiKey ?? ""),
      proxy: search.proxy || undefined,
      maxResults: search.maxResults ?? 5,
    },
    kb: {
      rootDir: (kb.rootDir ?? "~/deeptutor-kbs").replace(/^~\//, home + "/"),
      defaultKB: kb.defaultKB ?? "default",
    },
    python: {
      timeout: python.timeout ?? 30,
      maxTimeout: python.maxTimeout ?? 300,
    },
  };
}

export default function (pi: ExtensionAPI) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const configPath = join(__dirname, "config.json");
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  const config = resolveConfig(raw);

  if (config.search.apiKey) {
    registerBraveSearch(pi, config.search);
  } else {
    console.warn("[deeptutor-lite] BRAVE_API_KEY not set — web_search tool not registered");
  }

  registerKBManager(pi, config.kb);
  registerPythonRunner(pi, config.python, config.kb);
  registerMasteryTracker(pi, config.kb);
}
