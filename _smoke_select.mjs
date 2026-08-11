// Smoke test: drag-select (划词复制) — input-area text extraction + selection
// highlight on ALL message rows (user/label/tool/…) and on the input box.
//
// Part A: extractInputSelectionText (pure). Part B: MessageList renders the
// selection background on plain (non-markdown) rows. Part C: TextInput renders
// the selection background on selected chars.
//
// Harness conventions from _smoke_parts.mjs: fake stdin must be a real
// Readable with isTTY/setRawMode/setEncoding/ref/unref; render from ink;
// waitFor polls every 20ms with a 3s timeout; imports come from ./dist/*.js
// (run AFTER `npm run build`). MessageList reads process.stdout.columns (the
// REAL terminal width), so coordinates are derived from that width.
//
// COLOR NOTE: ink colors text via chalk, which disables colors when the real
// process.stdout is not a TTY (this script runs piped). FORCE_COLOR must be
// set BEFORE any ink/chalk module loads, so ink-dependent modules are imported
// dynamically (static imports would evaluate before the env var is set).
process.env.FORCE_COLOR = "3";

import { Readable } from "node:stream";
import React from "react";

const { render } = await import("ink");
const { MessageList, extractSelectionText, displayWidth } = await import(
  "./dist/cli/tui/MessageList.js"
);
const { TextInput, extractInputSelectionText } = await import(
  "./dist/cli/tui/TextInput.js"
);

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

// ---- Part A: extractInputSelectionText (pure, no rendering) ----
const SEL = (startX, startY, endX, endY) => ({ startX, startY, endX, endY });
// Selection columns are HALF-OPEN [start, end): a char at column c is included
// when c >= start and c + width <= end. Content col 0 = 1-based screen col
// screenColBase, so to select a full row the drag must end ONE column past the
// last char (identical to the message-area behavior). The render highlight
// uses the same mapping, so highlight and copy always agree.

// 1. full row of plain text (drag ends one col past 'f')
assert(
  extractInputSelectionText([{ kind: "text", text: "abcdef" }], 20, 10, 5, SEL(5, 10, 11, 10)) === "abcdef",
  "extractInputSelectionText: full row 'abcdef'"
);
// 2. partial row → content cols 1..3 = "bcd"
assert(
  extractInputSelectionText([{ kind: "text", text: "abcdef" }], 20, 10, 5, SEL(6, 10, 9, 10)) === "bcd",
  "extractInputSelectionText: partial row 'bcd'"
);
// 3. multi-row hard break (content rows 10 and 11); line 2 selected through
//    its 2nd char (drag ends one col past 'e' → 'f' excluded)
assert(
  extractInputSelectionText([{ kind: "text", text: "abc\ndef" }], 20, 10, 5, SEL(5, 10, 7, 11)) === "abc\nde",
  "extractInputSelectionText: multi-row 'abc\\nde'"
);
// 4. block segment: full-row selection copies the label (padding excluded)
const label = "[已粘贴 2 行]";
const labelW = displayWidth(label);
assert(
  extractInputSelectionText(
    [{ kind: "block", id: "b", text: "x\ny", lines: 2 }],
    30, 10, 5, SEL(5, 10, 5 + labelW + 2 - 1, 10)
  ) === label,
  "extractInputSelectionText: block label copied, padding cols excluded"
);
// 5. selection entirely below the input rows → ""
assert(
  extractInputSelectionText([{ kind: "text", text: "abcdef" }], 20, 10, 5, SEL(5, 30, 10, 31)) === "",
  "extractInputSelectionText: out-of-range selection → ''"
);
// 6. partial overlap of the block label: content cols [1,3) cover only the
//    first CJK char ("已" occupies display cols 1-2; "[" sits at col 0 and
//    "粘" starts at col 3, past the colEnd cut of 3).
assert(
  extractInputSelectionText(
    [{ kind: "block", id: "b", text: "x\ny", lines: 2 }],
    30, 10, 5, SEL(6, 10, 8, 10)
  ) === "已",
  "extractInputSelectionText: partial block overlap → '已'"
);

// ---- fake stdin/stdout (exact recipe from _smoke_parts.mjs) ----
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

const outRaw = () => chunks.join("");
// theme.selection #3d3d68 → rgb(61,61,104)
const BG = "\x1b[48;2;61;61;104m";

// ---- Part B: MessageList user-row highlight (render headless) ----
const termW = process.stdout.columns ?? 80;
const messages = [{ type: "user", text: "选中我", id: "u1" }];

// Buffer rows: row 1 = "You" (label), row 2 = "选中我" (body). PAD_COLS=2,
// so content col 0 is at 1-based screen col 3.
const bodySel = { startX: 3, startY: 2, endX: 9, endY: 2 };
const instB = render(
  React.createElement(MessageList, {
    messages,
    scrollOffset: 0,
    visibleHeight: 5,
    selection: bodySel,
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => outRaw().includes(BG), "user row highlight in frame");
assert(outRaw().includes(BG), "MessageList: user message row renders selection background");
assert(
  extractSelectionText(messages, termW, 5, 0, bodySel) === "选中我",
  "MessageList: user-row copy (extractSelectionText) regression"
);
instB.unmount();
chunks.length = 0;

// Label row (row 1) also highlights now.
const labelSel = { startX: 3, startY: 1, endX: 5, endY: 1 };
const instB2 = render(
  React.createElement(MessageList, {
    messages,
    scrollOffset: 0,
    visibleHeight: 5,
    selection: labelSel,
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => outRaw().includes(BG), "label row highlight in frame");
assert(outRaw().includes(BG), "MessageList: user-label row renders selection background");
instB2.unmount();
chunks.length = 0;

// ---- Part C: TextInput selection render (headless) ----
// screenRow=10, screenColBase=5 → content line 0 is at screen row 10, and
// content cols 1..3 (screen 6..8) = "bcd" get the selection background.
const partsC = [{ kind: "text", text: "abcdef" }];
const instC = render(
  React.createElement(TextInput, {
    parts: partsC,
    focus: false,
    screenRow: 10,
    screenColBase: 5,
    selection: { startX: 6, startY: 10, endX: 9, endY: 10 },
    onChange: () => {},
    onSubmit: () => {},
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => outRaw().includes(BG), "input selected chars highlight in frame");
assert(outRaw().includes(BG), "TextInput: selected chars render selection background");
instC.unmount();
chunks.length = 0;

// Clean run: no selection → no selection background anywhere.
const instC2 = render(
  React.createElement(TextInput, {
    parts: partsC,
    focus: false,
    screenRow: 10,
    screenColBase: 5,
    selection: null,
    onChange: () => {},
    onSubmit: () => {},
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await delay(400);
assert(!outRaw().includes(BG), "TextInput: without selection no selection background");
instC2.unmount();

// Regression: a text segment AFTER a paste block on the same line ("CD" after
// the block) must highlight too — its selection columns start at the segment's
// line offset (17), not 0. Layout (contentWidth 76): "AB" cols 0-1, block
// label (13) + padding (2) cols 2-16, "CD" cols 17-18. Screen: colBase 5 →
// "CD" spans screen cols 22..23; half-open end needs bottomX = 5+19 = 24.
const partsC3 = [
  { kind: "text", text: "AB" },
  { kind: "block", id: "b", text: "x\ny", lines: 2 },
  { kind: "text", text: "CD" },
];
const selC3 = { startX: 22, startY: 10, endX: 24, endY: 10 };
const instC3 = render(
  React.createElement(TextInput, {
    parts: partsC3,
    focus: false,
    screenRow: 10,
    screenColBase: 5,
    selection: selC3,
    onChange: () => {},
    onSubmit: () => {},
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => outRaw().includes(BG), "trailing-text-after-block highlight in frame");
assert(outRaw().includes(BG), "TextInput: text after a block highlights (segStart offset)");
assert(
  extractInputSelectionText(partsC3, 76, 10, 5, selC3) === "CD",
  "extractInputSelectionText: text after a block extracts 'CD'"
);
instC3.unmount();

// ---- Part D: extraction window must match the RENDERED window (ask mode) ----
// ask 模式下 MessageList 用 askMessageHeight 渲染(窗口从 buffer 尾部截取),
// release 划词时 extractSelectionText 必须用同一个高度;若用全量 visibleHeight
// (修复前的 bug),viewStart 不同 → 屏幕行 → buffer 行映射错位 → 复制内容与
// 高亮位置不符(用户实测:选择题菜单弹出后划词内容错位)。
// buffer(8 行):0"You" 1"AAA" 2spacer 3"You" 4"BBB" 5spacer 6"You" 7"CCC"
const msgsD = [
  { type: "user", text: "AAA", id: "d1" },
  { type: "user", text: "BBB", id: "d2" },
  { type: "user", text: "CCC", id: "d3" },
];
// ask 渲染窗口高度 4:viewStart = 8-4 = 4 → 屏幕行 1..4 = buffer 行 4..7
// (BBB, spacer, You, CCC)。PAD_COLS=2 → 内容列 0 在屏幕列 3。
const askSelRow1 = { startX: 3, startY: 1, endX: 99, endY: 1 };
assert(
  extractSelectionText(msgsD, termW, 4, 0, askSelRow1).includes("BBB"),
  "ask-window: screen row 1 maps to buffer row 4 ('BBB') with window=4"
);
assert(
  extractSelectionText(msgsD, termW, 4, 0, { startX: 3, startY: 4, endX: 99, endY: 4 }).includes("CCC"),
  "ask-window: screen row 4 maps to buffer row 7 ('CCC') with window=4"
);
// 回归护栏:用全量窗口(修复前)提取同一 selection 得到的是 buffer 行 0
// ("You"),不是渲染窗口内的 "BBB" —— 这就是划词错位的机制。
assert(
  !extractSelectionText(msgsD, termW, 8, 0, askSelRow1).includes("BBB"),
  "regression guard: full-window (8) extraction of ask selection does NOT hit 'BBB' — caller must pass the rendered window height"
);

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} FAILURES`);
console.error(`DIAG: asserts ran = ${assertCount}, failures = ${failures}`);
process.exit(failures === 0 ? 0 : 1);
