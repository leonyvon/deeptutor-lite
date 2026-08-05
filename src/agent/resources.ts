/**
 * Skills + prompt-template loading for the deeptutor app.
 *
 * Skills: one directory per skill under `skills/`, each containing a SKILL.md
 * with YAML frontmatter (`name`, `description`) followed by the body.
 * Prompt templates: one `.md` file per template under `prompts/` with
 * frontmatter (`description`, `argument-hint`); content is kept verbatim
 * (including frontmatter) — `$@`/`$1` placeholder substitution is handled by
 * the caller via `formatPromptTemplateInvocation`.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill, PromptTemplate } from "@earendil-works/pi-agent-core";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** App root: src/agent → src → project root (mirrors dist/agent → dist → project root). */
const APP_ROOT = join(__dirname, "..", "..");
const SKILLS_ROOT = join(APP_ROOT, "skills");
const PROMPTS_ROOT = join(APP_ROOT, "prompts");

/** Skill directories (one SKILL.md each), loaded in this order. */
const SKILL_DIRS = [
  "deeptutor",
  "deeptutor-mastery",
  "deeptutor-quiz",
  "deeptutor-research",
  "deeptutor-solve",
  "deeptutor-visualize",
] as const;

/** Prompt template filenames (without .md), loaded in this order. */
const PROMPT_FILES = ["mastery", "quiz", "research", "solve", "visualize"] as const;

interface Frontmatter {
  [key: string]: string | undefined;
}

/**
 * Parse simple YAML frontmatter of the form `---\nkey: value\n...\n---\n<body>`.
 * Returns the metadata map and the body that follows the closing `---`.
 * Files without valid frontmatter yield empty metadata and the full raw text.
 */
function parseFrontmatter(raw: string): { frontmatter: Frontmatter; content: string } {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: {}, content: raw };
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) {
    return { frontmatter: {}, content: raw };
  }
  const frontmatter: Frontmatter = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const sep = line.indexOf(":");
    if (sep > 0) {
      frontmatter[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
    }
  }
  return { frontmatter, content: raw.slice(end + 5) };
}

/** Load all bundled skills (sync, called once at app startup). */
export function loadSkills(): Skill[] {
  return SKILL_DIRS.map((dir) => {
    const filePath = resolve(join(SKILLS_ROOT, dir, "SKILL.md"));
    const raw = readFileSync(filePath, "utf-8");
    const { frontmatter, content } = parseFrontmatter(raw);
    return {
      name: frontmatter.name ?? dir,
      description: frontmatter.description ?? "",
      content,
      filePath,
    };
  });
}

/** Load all bundled prompt templates (sync, called once at app startup). */
export function loadPromptTemplates(): PromptTemplate[] {
  return PROMPT_FILES.map((name) => {
    const raw = readFileSync(resolve(join(PROMPTS_ROOT, `${name}.md`)), "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    return {
      name,
      description: frontmatter.description,
      content: raw,
    };
  });
}
