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
    // Enter the alternate screen + enable SGR mouse tracking (1000=button,
    // 1002=drag, 1006=SGR encoding). We draw our own text selection in the
    // message area from these events (Shift+events are consumed by Windows
    // Terminal for native selection and never forwarded — see
    // ControlInteractivity::_canSendVTMouseInput). With mouse tracking on,
    // the wheel arrives as SGR events (64/65) handled by the App, so 1007
    // (alternate scroll) is no longer needed but stays harmless.
    // Hide the hardware cursor: the TUI renders its own ✏️ caret inside the
    // input box (TextInput), so the terminal cursor would otherwise stay
    // visible at the last written row (the status bar) and blink there.
    // Bracketed paste (2004h): wraps pasted text in ESC[200~..ESC[201~ so the
    // TextInput can distinguish paste content from keystrokes — without it,
    // CR/LF inside multi-line pastes arrive as raw \r\n and ink turns them
    // into return/enter keys (breaking the input and/or submitting early).
    process.stdout.write("\x1b[?1049h\x1b[?1007h\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?2004h\x1b[?25l");
    // Keep the hardware cursor hidden (the TUI draws its own ✏️ caret). Position
    // is managed by ink's useCursor().setCursorPosition (TextInput) — ink
    // accounts for it in its redraw math. Hiding (?25l) never moves the cursor,
    // so it cannot desync ink's relative redraws (the previous CUP-based anchor
    // did — frames got painted at wrong rows on Windows Terminal).
    const rawWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((data: Uint8Array | string, ...args: any[]) => {
      rawWrite(data as never, ...(args as never[]));
      rawWrite("\x1b[?25l");
      return true;
    }) as typeof process.stdout.write;
    // Restore the terminal on every exit path (Ctrl+C, /quit, crash).
    const restore = () => {
      try {
        process.stdout.write(
          "\x1b[?25h\x1b[?2004l\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?1007l\x1b[?1049l"
        );
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

  // exitOnCtrlC: false — the App handles Ctrl+C itself (clears the input box
  // when it has content, exits only when empty). ink's default would swallow
  // the keypress and quit immediately.
  render(React.createElement(App, { runtime, repo }), { exitOnCtrlC: false });
  // TUI owns the process lifecycle from here (Ctrl+C handled by the App).
}

main().catch((err) => {
  process.stderr.write(`Error: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
