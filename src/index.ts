#!/usr/bin/env node
/**
 * deeptutor — standalone CLI entry point.
 *
 * Loads config, creates/opens the session, and starts the REPL.
 */
import { loadConfig } from "./config.js";
import { createSessionRepo } from "./session/repo.js";
import { runRepl } from "./cli/repl.js";
import { colors, info, error } from "./cli/ui.js";

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
      `deeptutor — document tutoring CLI\n\n` +
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

  const sessionPath = (await session.getMetadata()).path;
  info(`session: ${sessionPath}`);
  info(`model:   ${config.model.model} @ ${config.model.baseUrl}`);
  if (!config.search.apiKey) {
    info("web_search disabled (no BRAVE_API_KEY / search.apiKey configured)");
  }

  await runRepl({ config, session, repo });
  process.exit(0);
}

main().catch((err) => {
  error(err?.message ?? String(err));
  process.exit(1);
});
