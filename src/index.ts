#!/usr/bin/env node
/**
 * deeptutor — standalone CLI entry point.
 *
 * Loads config, creates/opens the session, assembles the DeeptutorRuntime
 * (with the TUI ask callback for interactive quiz choices), and renders the
 * ink TUI.
 */
import React from "react";
import { render } from "ink";
import { loadConfig } from "./config.js";
import { createSessionRepo } from "./session/repo.js";
import { DeeptutorRuntime } from "./agent/harness.js";
import { App } from "./cli/tui/index.js";
import { inkAsk } from "./cli/tui/ask.js";

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

  let session;
  if (args.sessionId) {
    session = await repo.create({ id: args.sessionId, cwd: process.cwd() });
  } else {
    session = await repo.create({ cwd: process.cwd() });
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
