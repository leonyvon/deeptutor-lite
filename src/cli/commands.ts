/**
 * Slash commands for the deeptutor REPL.
 *
 * Skill workflows (/quiz, /research, /solve, /visualize, /mastery) invoke the
 * bundled SKILL.md via the harness. Session commands (/new, /list, /switch)
 * operate on the JSONL session repo.
 */
import { select, isCancel } from "@clack/prompts";
import type { JsonlSessionRepo, Session, JsonlSessionMetadata } from "@earendil-works/pi-agent-core";
import type { Config } from "../types.js";
import type { DeeptutorHarness } from "../agent/harness.js";
import { buildHarness } from "../agent/harness.js";
import { colors } from "./ui.js";

export interface AppContext {
  config: Config;
  repo: JsonlSessionRepo;
  session: Session<JsonlSessionMetadata>;
  harness: DeeptutorHarness;
  ask: (question: string, options: Record<string, string>) => Promise<string | null>;
  /** Replace the active session+harness (used by /new and /switch). */
  setSession(session: Session<JsonlSessionMetadata>): void;
}

export const SKILL_COMMANDS: Record<string, { skill: string; hint: string }> = {
  "/quiz": { skill: "deeptutor-quiz", hint: "<topic/instructions>" },
  "/research": { skill: "deeptutor-research", hint: "<topic>" },
  "/solve": { skill: "deeptutor-solve", hint: "<problem>" },
  "/visualize": { skill: "deeptutor-visualize", hint: "<data/plot>" },
  "/mastery": { skill: "deeptutor-mastery", hint: "" },
};

export const HELP_TEXT = `Commands:
  /quiz <topic>      Generate a quiz from the knowledge base
  /research <topic>  Run the research agent
  /solve <problem>   Solve a problem step by step
  /visualize <data>  Create a chart or plot
  /mastery           Start the mastery learning path
  /new               Start a new session
  /list              List sessions
  /switch            Switch to another session
  /help              Show this help
  /quit              Exit`;

/**
 * Handle a slash command. Returns true when the REPL should exit.
 * The optional arg after the command (e.g. "/quiz calculus") is passed to
 * the skill invocation as additional instructions.
 */
export async function runCommand(ctx: AppContext, raw: string): Promise<boolean> {
  const [cmd, ...rest] = raw.trim().split(/\s+/);
  const arg = rest.join(" ");

  switch (cmd) {
    case "/quit":
    case "/exit":
      return true;

    case "/help":
      process.stdout.write(HELP_TEXT + "\n");
      return false;

    case "/new": {
      const session = await ctx.repo.create({ cwd: process.cwd() });
      ctx.setSession(session);
      process.stdout.write(`${colors.toolOk("New session started.")}\n`);
      return false;
    }

    case "/list": {
      const sessions = await ctx.repo.list();
      if (sessions.length === 0) {
        process.stdout.write(`${colors.dim("No sessions yet.")}\n`);
        return false;
      }
      const active = (await ctx.session.getMetadata()).path;
      for (const s of sessions) {
        const mark = s.path === active ? "▶ " : "  ";
        process.stdout.write(`${mark}${colors.dim(s.path)}\n`);
      }
      return false;
    }

    case "/switch": {
      const sessions = await ctx.repo.list();
      if (sessions.length === 0) {
        process.stdout.write(`${colors.dim("No sessions to switch to.")}\n`);
        return false;
      }
      const choice = await select({
        message: "Switch to session:",
        options: sessions.map((s) => ({ value: s.path, label: s.path })),
      });
      if (isCancel(choice)) return false;
      const target = sessions.find((s) => s.path === choice);
      if (!target) return false;
      const session = await ctx.repo.open(target);
      ctx.setSession(session);
      process.stdout.write(`${colors.toolOk(`Switched to ${target.path}`)}\n`);
      return false;
    }

    default: {
      const entry = SKILL_COMMANDS[cmd];
      if (!entry) {
        process.stdout.write(`${colors.toolErr(`Unknown command: ${cmd}`)} — try /help\n`);
        return false;
      }
      const instructions = arg ? `User instructions: ${arg}` : undefined;
      process.stdout.write(`${colors.tool(`Running /${entry.skill.replace("deeptutor-", "")}...`)}\n`);
      await ctx.harness.skill(entry.skill, instructions);
      return false;
    }
  }
}

/** Rebuild the harness for a given session (shared by /new and /switch). */
export function harnessFor(ctx: AppContext, session: Session): DeeptutorHarness {
  return buildHarness({ config: ctx.config, session, ask: ctx.ask });
}
