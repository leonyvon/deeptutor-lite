#!/usr/bin/env node
/**
 * deeptutor — standalone CLI entry point.
 *
 * Loads config, assembles the DeeptutorRuntime (with the TUI ask callback
 * for interactive quiz choices), and renders the ink TUI. No session is
 * created at startup: the TUI lazily creates one on the first user message
 * (unless --session is given, which resumes/creates eagerly).
 */
import React from "react";
import { render } from "ink";
import { loadConfig } from "./config.js";
import { createSessionRepo } from "./session/repo.js";
import { DeeptutorRuntime } from "./agent/harness.js";
import { App } from "./cli/tui/index.js";
import { inkAsk } from "./cli/tui/ask.js";
import type { Session, JsonlSessionMetadata } from "@earendil-works/pi-agent-core";

function parseArgs(argv: string[]): { sessionId?: string; help?: boolean } {
  const out: { sessionId?: string; help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--session" || a === "-s") out.sessionId = argv[++i];
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      `deeptutor — document tutoring CLI (TUI)\n\n` +
        `Usage: deeptutor [options]\n\n` +
        `Options:\n` +
        `  -s, --session <id>  Resume or create a session by id\n` +
        `  -h, --help          Show this help\n`
    );
    process.exit(0);
  }

  const config = loadConfig();
  const repo = createSessionRepo(config.session.dir);

  // Lazy session: only create one eagerly when an explicit id is requested.
  // Otherwise the TUI calls runtime.ensureSession() on the first message.
  let session: Session<JsonlSessionMetadata> | null = null;
  if (args.sessionId) {
    session = await repo.create({ id: args.sessionId, cwd: process.cwd() });
  }

  // Enter the alternate screen + enable Alternate Scroll (DECSET 1007).
  // 1007 makes the terminal translate the wheel into ↑/↓ arrow keys inside
  // the alternate screen WITHOUT enabling mouse tracking, so native click-
  // drag text selection is preserved (pi/opencode behave the same).
  // Note: 1007 only takes effect in the alternate screen — in the primary
  // buffer the wheel would just scroll the (empty) scrollback.
  if (process.stdout.isTTY) {
    // Hide the hardware cursor: the TUI renders its own ▎ cursor inside the
    // input box (TextInput), so the terminal cursor would otherwise stay
    // visible at the last written row (the status bar) and blink there.
    process.stdout.write("\x1b[?1049h\x1b[?1007h\x1b[?25l");
    // Restore the terminal on every exit path (Ctrl+C, /quit, crash).
    const restore = () => {
      try {
        process.stdout.write("\x1b[?25h\x1b[?1007l\x1b[?1049l");
      } catch {
        /* terminal already gone */
      }
    };
    process.on("exit", restore);
    process.on("SIGINT", () => {
      restore();
      process.exit(130);
    });
    process.on("SIGTERM", () => {
      restore();
      process.exit(143);
    });
  }

  // Inject the TUI ask callback so tools (mastery_quiz etc.) can present
  // interactive choice questions inside the interface.
  const runtime = new DeeptutorRuntime(config, session, inkAsk);

  render(React.createElement(App, { runtime, repo }));
  // TUI owns the process lifecycle from here (Ctrl+C handled by ink).
}

main().catch((err) => {
  process.stderr.write(`Error: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
