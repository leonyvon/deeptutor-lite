/**
 * REPL main loop: clack input → harness prompt / slash commands.
 * Renders streamed assistant output and tool cards via ui.ts.
 */
import { text, select, isCancel, cancel } from "@clack/prompts";
import type { JsonlSessionRepo, Session, JsonlSessionMetadata } from "@earendil-works/pi-agent-core";
import type { Config } from "../types.js";
import { buildHarness, type DeeptutorHarness } from "../agent/harness.js";
import { createSessionRepo } from "../session/repo.js";
import { runCommand, type AppContext } from "./commands.js";
import { renderEvent, renderUserLine, colors, error } from "./ui.js";

/** clack-backed interactive choice prompt for tools (mastery_quiz etc.). */
async function clackAsk(
  question: string,
  options: Record<string, string>
): Promise<string | null> {
  const choice = await select({
    message: question,
    options: Object.entries(options).map(([label, textValue]) => ({
      value: label,
      label: `${label}) ${textValue}`,
    })),
  });
  if (isCancel(choice)) return null;
  return `${choice}: ${options[choice]}`;
}

export interface ReplOptions {
  config: Config;
  /** Initial session; created by caller. */
  session: Session<JsonlSessionMetadata>;
  /** Optional session repo (defaults to config.session.dir). */
  repo?: JsonlSessionRepo;
}

export async function runRepl(options: ReplOptions): Promise<void> {
  const repo = options.repo ?? createSessionRepo(options.config.session.dir);
  let session = options.session;
  let running = false;

  const ctx: AppContext = {
    config: options.config,
    repo,
    session,
    harness: null as unknown as DeeptutorHarness,
    ask: clackAsk,
    setSession(next) {
      session = next;
      ctx.session = next;
      ctx.harness = buildHarness({ config: options.config, session: next, ask: clackAsk });
    },
  };
  ctx.harness = buildHarness({ config: options.config, session, ask: clackAsk });

  // Wire harness events to the renderer.
  ctx.harness.subscribe((event) => {
    renderEvent(event);
  });

  process.stdout.write(
    `${colors.header("deeptutor")} ${colors.dim("— document tutoring. Type /help for commands.\n")}`
  );

  // SIGINT during a run: abort the current turn gracefully.
  let aborting = false;
  const onSigint = () => {
    if (running) {
      aborting = true;
      ctx.harness.abort();
    } else {
      process.exit(0);
    }
  };
  process.on("SIGINT", onSigint);

  try {
    for (;;) {
      const input = await text({
        message: "",
        placeholder: "Ask about your knowledge base… (/help)",
      });
      if (isCancel(input)) {
        cancel("bye");
        process.exit(0);
      }
      const line = (input ?? "").trim();
      if (!line) continue;

      if (line.startsWith("/")) {
        const shouldExit = await runCommand(ctx, line);
        if (shouldExit) {
          process.stdout.write(`${colors.dim("bye\n")}`);
          process.exit(0);
        }
        continue;
      }

      renderUserLine(line);
      running = true;
      try {
        await ctx.harness.prompt(line);
      } catch (err: any) {
        error(err?.message ?? String(err));
      } finally {
        running = false;
      }
      if (aborting) {
        process.stdout.write(`${colors.dim("(aborted)\n")}`);
        aborting = false;
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}
