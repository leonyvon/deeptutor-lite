// Smoke test: ink cursor API (IME positioning) — TextInput publishes the input
// caret to ink's useCursor().setCursorPosition, and ink emits the cursor
// suffix (cursorUp + cursorTo + ?25h show) in its frame write.
//
// Part B: focused + screenRow/screenColBase → ink emits "\x1b[7G\x1b[?25h"
// (cursorTo(6) = 0-based x, since col = screenColBase 5 + caret col 2 = 7 → 6).
// Unfocused or missing screenRow → setCursorPosition(undefined) → no suffix.
//
// Part C: ink #982 fullscreen off-by-one — this App's root <Box height={rows}>
// always renders a frame WITHOUT a trailing newline, where ink's
// buildCursorSuffix assumes the cursor sits one line PAST the last line while
// it actually sits ON it, emitting cursorUp one too large (hardware cursor
// lands one row above the requested y → IME pinyin appears one row too high).
// TextInput compensates by publishing y+1 (publish y = row, not row - 1);
// Part C renders a 30-row frame and asserts the emitted cursorUp is
// 30 - (27 + ... ) — i.e. exactly 3, NOT 4 — locking the compensation in.
//
// Conventions from _smoke_parts.mjs: fake stdin must be a real Readable with
// isTTY/setRawMode/setEncoding/ref/unref; render from ink; waitFor polls every
// 20ms with a 3s timeout; imports come from ./dist/*.js (run AFTER `npm run
// build`); PASS/FAIL per assert; exit non-zero on failure.
import { Readable } from "node:stream";
import React from "react";
import { Box, Text, render } from "ink";
import { TextInput } from "./dist/cli/tui/TextInput.js";
import { theme } from "./dist/cli/tui/theme.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, label, timeout = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (cond()) return;
    await delay(20);
  }
  throw new Error(`TIMEOUT waiting for: ${label}`);
}
let failures = 0;
let assertCount = 0;
function assert(cond, label) {
  assertCount++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

// ---- fake stdin/stdout (recipe from _smoke_parts.mjs) ----
const stdin = new Readable({ read() {} });
stdin.isTTY = true;
stdin.setRawMode = () => stdin;
stdin.setEncoding = () => {};
stdin.ref = () => {};
stdin.unref = () => {};
stdin.columns = 120;
stdin.rows = 30;

const chunks = [];
const stdout = new Readable({ read() {} });
stdout.columns = 80;
stdout.rows = 24;
stdout.isTTY = true;
stdout.write = (c) => { chunks.push(String(c)); return true; };
stdout.setEncoding = () => {};
stdout.unref = () => {};

// cursorTo(6) = "\x1b[7G" + show cursor "\x1b[?25h"
const CURSOR_SUFFIX = "\x1b[7G\x1b[?25h";

const parts = [{ kind: "text", text: "ab" }];

// ---- Part B: TextInput publishes the caret to ink's cursor API ----
// Focused with screenRow/screenColBase: caret col = 5 + 2 = 7 (1-based) →
// 0-based x = 6; row = 10 → 0-based y = 9; the single-line frame has
// visibleCount 1 < 9 so no cursorUp precedes the suffix.
const instB = render(
  React.createElement(TextInput, {
    parts,
    focus: true,
    screenRow: 10,
    screenColBase: 5,
    onChange: () => {},
    onSubmit: () => {},
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => chunks.join("").includes(CURSOR_SUFFIX), "cursor suffix in frame");
assert(
  chunks.join("").includes(CURSOR_SUFFIX),
  "TextInput: focused → ink emits cursor suffix (\\x1b[7G\\x1b[?25h) at the caret"
);
instB.unmount();

// Unfocused → setCursorPosition(undefined) → no cursor suffix.
chunks.length = 0;
const instB2 = render(
  React.createElement(TextInput, {
    parts,
    focus: false,
    screenRow: 10,
    screenColBase: 5,
    onChange: () => {},
    onSubmit: () => {},
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => chunks.join("").includes("ab"), "unfocused frame rendered");
await delay(400);
assert(
  !chunks.join("").includes("\x1b[7G"),
  "TextInput: unfocused → no cursor suffix (setCursorPosition(undefined))"
);
instB2.unmount();

// Missing screenRow → setCursorPosition(undefined) → no cursor suffix.
chunks.length = 0;
const instB3 = render(
  React.createElement(TextInput, {
    parts,
    focus: true,
    onChange: () => {},
    onSubmit: () => {},
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => chunks.join("").includes("ab"), "no-screenRow frame rendered");
await delay(400);
assert(
  !chunks.join("").includes("\x1b[7G"),
  "TextInput: no screenRow prop → no cursor suffix"
);
instB3.unmount();

// ---- Part C: ink #982 fullscreen off-by-one compensation ----
// A fullscreen 30-row frame (root height={rows}, alternate-screen style: no
// trailing newline — the flexGrow message area MUST be filled with 25 rows;
// ink does NOT pad empty rows, and a short frame (visibleLineCount < y)
// emits no cursorUp at all). TextInput at screenRow=27 publishes y = row = 27
// (0-based, +1 compensation for #982). visibleLineCount = 30 → cursorUp must
// be 30 - 27 = 3. The uncompensated value would be 4 (cursor one row high).
chunks.length = 0;
const instC = render(
  React.createElement(
    Box,
    { flexDirection: "column", height: 30 },
    React.createElement(
      Box,
      { flexDirection: "column", flexGrow: 1, overflow: "hidden" },
      ...Array.from({ length: 25 }, (_, i) =>
        React.createElement(
          Box,
          { key: i, height: 1, flexShrink: 0 },
          React.createElement(Text, null, `msg-${String(i).padStart(2, "0")}`)
        )
      )
    ),
    React.createElement(
      Box,
      {
        flexDirection: "column",
        height: 3,
        flexShrink: 0,
        borderStyle: "single",
        borderTop: true,
        borderColor: theme.borderActive,
        paddingX: 1,
      },
      React.createElement(
        Box,
        { flexDirection: "row" },
        React.createElement(Text, null, "❯ "),
        React.createElement(TextInput, {
          parts: [{ kind: "text", text: "abc" }],
          focus: true,
          screenRow: 27,
          screenColBase: 5,
          onChange: () => {},
          onSubmit: () => {},
        })
      )
    ),
    React.createElement(
      Box,
      { flexDirection: "column", flexShrink: 0 },
      React.createElement(Box, { height: 1 }, React.createElement(Text, null, "status-1")),
      React.createElement(Box, { height: 1 }, React.createElement(Text, null, "status-2"))
    )
  ),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => chunks.join("").includes("\x1b[3A"), "fullscreen frame cursorUp=3");
assert(
  chunks.join("").includes("\x1b[3A"),
  "TextInput: #982 compensation — fullscreen frame emits cursorUp 3 (not 4)"
);
assert(
  !chunks.join("").includes("\x1b[4A"),
  "TextInput: #982 compensation — cursorUp 4 (uncompensated off-by-one) never emitted"
);
instC.unmount();

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} FAILURES`);
console.error(`DIAG: asserts ran = ${assertCount}, failures = ${failures}`);
process.exit(failures === 0 ? 0 : 1);
