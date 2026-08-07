// Smoke test: interactive choice-question flow.
//
// Part A — ask.ts module flow (src/cli/tui/ask.js): inkAsk sets a pending ask
// + notifies listeners; resolveAsk resolves the promise, clears the pending
// ask, and notifies listeners again (so App returns to chat mode).
//
// Part B — ui_ask tool (src/tools/ask_user.js) execute() with dummy args:
// interactive answer, cancelled, headless text fallback, empty options.
//
// Part C — AskPicker rendering (src/cli/tui/AskPicker.js): options render as
// CONTIGUOUS blocks (label shares its row with the text via wrapToLines,
// char-level CJK wrap), the WHOLE selected block carries the accent color, and
// with a maxHeight cap the picker never overflows: the question is truncated
// first ("…" marker) so options always keep MIN_OPTION_ROWS, and the option
// block is windowed (selection always visible, "(showing X of Y)" when cut).
//
// Part D — letter-aware grading (src/tools/mastery.js): gradeAnswer resolves a
// letter/"A: text"/option-text answer against the pending question's options
// regardless of what form expectedAnswer uses, and keeps the legacy paths.
//
// Conventions from _smoke_parts.mjs: waitFor polls every 20ms with a 3s
// timeout; imports come from ./dist/*.js (run AFTER `npm run build`); PASS/FAIL
// per assertion; non-zero exit on any failure.
//
// COLOR NOTE (from _smoke_select.mjs): ink colors text via chalk, which
// disables colors when the real process.stdout is not a TTY. FORCE_COLOR must
// be set BEFORE any ink/chalk module loads, so ink-dependent modules (ink,
// AskPicker, MessageList) are imported dynamically.
process.env.FORCE_COLOR = "3";

import { Readable } from "node:stream";
import React from "react";
import { subscribeAsk, getPendingAsk, resolveAsk, inkAsk } from "./dist/cli/tui/ask.js";
import { createAskUserTool } from "./dist/tools/ask_user.js";

const { render } = await import("ink");
const { AskPicker } = await import("./dist/cli/tui/AskPicker.js");
const { wrapToLines } = await import("./dist/cli/tui/MessageList.js");

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

// ---- Part A: ask.ts module flow ----
let listenerFires = 0;
const unsub = subscribeAsk(() => {
  listenerFires++;
});
assert(typeof unsub === "function", "ask: subscribeAsk returns an unsubscribe function");

const p1 = inkAsk("Q1", { A: "opt a", B: "opt b" });
await waitFor(() => listenerFires === 1, "inkAsk notifies listener");
assert(listenerFires === 1, "inkAsk: listener fired once on pending ask");
const pending1 = getPendingAsk();
assert(
  pending1 !== null &&
    pending1.question === "Q1" &&
    pending1.options.A === "opt a" &&
    pending1.options.B === "opt b",
  "inkAsk: getPendingAsk returns {question, options}"
);

let resolvedValue = "unset";
p1.then((v) => { resolvedValue = v; });
resolveAsk("A: opt a");
await waitFor(() => resolvedValue === "A: opt a", "inkAsk promise resolves");
assert(resolvedValue === "A: opt a", "resolveAsk: inkAsk resolves to the selected value");
await waitFor(() => getPendingAsk() === null, "pending cleared");
assert(getPendingAsk() === null, "resolveAsk: pending ask cleared");
assert(listenerFires === 2, "resolveAsk: listener fired again (pending cleared → back to chat)");

// ESC/cancel path: resolveAsk(null)
const p2 = inkAsk("Q2", { A: "a", B: "b" });
let resolved2 = "unset";
p2.then((v) => { resolved2 = v; });
resolveAsk(null);
await waitFor(() => resolved2 === null, "cancel path resolves null");
assert(resolved2 === null, "resolveAsk(null): inkAsk resolves null (cancelled)");
assert(getPendingAsk() === null, "resolveAsk(null): pending cleared after cancel");
assert(listenerFires === 4, "cancel path: listener fired twice more (pending + cleared)");

unsub();

// ---- Part B: ui_ask tool execute() with dummy args ----
const tool = createAskUserTool();
assert(typeof tool === "object" && tool.name === "ui_ask", "createAskUserTool: returns tool named ui_ask");

// 1. interactive answer
let r1 = await tool.execute("id", { question: "Q?", options: { A: "a", B: "b" } }, undefined, undefined, {
  ask: async (_q, _o) => "B: option b",
});
assert(r1.details.answer === "B", "ui_ask: details.answer = 'B' from interactive picker");
const c1 = r1.content[0].text;
assert(
  c1.includes('"answer": "B"') && c1.includes('"cancelled": false'),
  "ui_ask: content JSON contains answer 'B' and cancelled:false"
);
assert(
  r1.details.success === true,
  "ui_ask: details.success true on answered interactive picker"
);

// 2. cancelled
let r2 = await tool.execute("id", { question: "Q?", options: { A: "a", B: "b" } }, undefined, undefined, {
  ask: async () => null,
});
assert(r2.details.cancelled === true, "ui_ask: details.cancelled true when picker dismissed");
assert(r2.content[0].text.includes('"cancelled": true'), "ui_ask: content JSON contains cancelled:true");
assert(r2.details.success === false, "ui_ask: details.success false on cancelled picker");

// 3. headless / no ctx.ask → text fallback
let r3 = await tool.execute("id", { question: "Q?", options: { A: "a", B: "b" } }, undefined, undefined, {});
assert(r3.details.interactive === false, "ui_ask: headless → details.interactive false");
assert(r3.details.success === true, "ui_ask: headless → details.success true");
assert(
  r3.content[0].text.includes("A) a") && r3.content[0].text.includes("B) b"),
  "ui_ask: headless text fallback lists options (A) a / B) b"
);

// 4. empty options → error
let r4 = await tool.execute("id", { question: "Q?", options: {} }, undefined, undefined, {});
assert(r4.details.success === false, "ui_ask: empty options → details.success false");
assert(
  r4.content[0].text.includes("empty"),
  "ui_ask: empty options error mentions empty"
);

// ---- Part C: AskPicker rendering (headless) ----
// fake stdin/stdout (recipe from _smoke_select.mjs; picker box is 40 cols wide,
// so contentWidth = 40 - 4 = 36).
const stdin = new Readable({ read() {} });
stdin.isTTY = true;
stdin.setRawMode = () => stdin;
stdin.setEncoding = () => {};
stdin.ref = () => {};
stdin.unref = () => {};
stdin.columns = 120;
stdin.rows = 30;

const chunks = [];
const frames = [];
const stdout = new Readable({ read() {} });
stdout.columns = 40;
stdout.rows = 24;
stdout.isTTY = true;
stdout.write = (c) => {
  const s = String(c);
  chunks.push(s);
  // Each ink frame is one multi-line write (after the ?2026h/?25l prologue and
  // before the ?2026l epilogue).
  if (s.includes("\n") && s.length > 50) frames.push(s);
  return true;
};
stdout.setEncoding = () => {};
stdout.unref = () => {};

const send = (s) => { stdin.push(s); };
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b[()][0-9A-B]/g, "");
// theme.accent #9d7cd8 → rgb(157,124,216)
const ACCENT = "\x1b[38;2;157;124;216m";
const frame = () => frames[frames.length - 1] ?? "";

const selLog = [];
const Q_TEXT = "你更想要哪个";
const OPTS = {
  A: "先答完当前的短答题，推进掌握进度",
  B: "改成出一道选择题（比如关于即梦或合规注意点的题目）",
  C: "其他操作",
};

// Controlled wrapper: echoes onChangeIndex back into selectedIndex (REQUIRED —
// without it the picker never re-renders and selection never advances).
function Harness() {
  const [sel, setSel] = React.useState(0);
  return React.createElement(AskPicker, {
    question: Q_TEXT,
    options: OPTS,
    selectedIndex: sel,
    onChangeIndex: (i) => { setSel(i); selLog.push(i); },
  });
}

const instC = render(React.createElement(Harness), { stdin, stdout, exitOnCtrlC: false });

await waitFor(() => frames.length >= 1, "initial picker frame");
await waitFor(() => frame().includes(Q_TEXT), "question text in frame");
// A is initially selected: wait until the frame reflects it (guards against
// reading a stale/transient frame).
await waitFor(() => frame().includes("> A)"), "initial selection frame");

// Label-not-isolated: with wrapToLines the "B)" label shares its row with the
// option text (char-level CJK wrap) instead of ending up alone on its own row.
const rows0 = strip(frame()).split("\n");
assert(
  rows0.some((r) => r.includes("B)") && r.includes("改成出")),
  "AskPicker: B) label shares its row with the option text"
);
assert(
  !rows0.some((r) => /^[│ ]*B\)\s*[│ ]*$/.test(r)),
  "AskPicker: no isolated B) label row"
);

const Bcount = wrapToLines(`  B) ${OPTS.B}`, 36).length;
const Qcount = wrapToLines(Q_TEXT, 36).length;
assert(Bcount >= 2, `AskPicker: option B wraps to ${Bcount} rows at 40 cols`);

// Down → B selected; the WHOLE B block (every wrapped row) is accent-colored.
send("\x1b[B");
await waitFor(() => selLog.at(-1) === 1, "down selects B");
// Wait until the current frame actually shows B selected ("> B)" marker), so
// we never read a stale pre-press frame.
await waitFor(() => frame().includes("> B)"), "frame re-render after down");
assert(selLog.at(-1) === 1, "AskPicker: one down press moves A→B (sel=1)");

const rawB = frame().split("\n");
const rowsB = strip(frame()).split("\n");
const accentRows = rawB.filter((r) => r.includes(ACCENT)).length;
assert(
  accentRows === Bcount + Qcount,
  `AskPicker: whole-block highlight — accent rows ${accentRows} == B(${Bcount}) + question(${Qcount})`
);
const bAllAccent = rawB.every((r, i) => !rowsB[i]?.includes("B)") || r.includes(ACCENT));
assert(bAllAccent, "AskPicker: every row of B's block carries the accent highlight");

// Second down → C: exactly two presses to reach C.
send("\x1b[B");
await waitFor(() => selLog.at(-1) === 2, "second down selects C");
await waitFor(() => frame().includes("> C)"), "frame re-render after second down");
assert(selLog.at(-1) === 2, "AskPicker: exactly two presses reach C (first was B, not C)");

instC.unmount();

// ---- Part C (cont.): height-capped windowing ----
// With maxHeight set, the option block is windowed so the whole picker fits in
// the cap. Hardened budget math: OVERHEAD=11, MIN_OPTION_ROWS=4.
// S1: maxHeight 14, question "选择操作" = 1 row → questionShown = min(1, max(1,
// 14-11-4)) = 1; optionsBudget = max(1, 14-11-1) = 2 → window shows 2 one-line
// options (A, B) + "(showing 2 of 6)".
const selLog2 = [];
const OPTS6 = {
  A: "操作A",
  B: "操作B",
  C: "操作C",
  D: "操作D",
  E: "操作E",
  F: "操作F",
};
function HarnessCapped() {
  const [sel, setSel] = React.useState(0);
  return React.createElement(AskPicker, {
    question: "选择操作",
    options: OPTS6,
    selectedIndex: sel,
    onChangeIndex: (i) => { setSel(i); selLog2.push(i); },
    maxHeight: 14,
  });
}

// Guard against reading a stale frame from a previous render: wait for a NEW
// frame past the current count before inspecting content.
let baseFrames = frames.length;
const instC2 = render(React.createElement(HarnessCapped), { stdin, stdout, exitOnCtrlC: false });
await waitFor(() => frames.length > baseFrames, "capped picker first frame");
await waitFor(() => frame().includes("A)"), "capped picker shows A)");
// Total rendered rows (non-empty) must stay within the cap, with a window cut.
const cappedRows = strip(frame()).split("\n").filter((r) => r.trim() !== "").length;
assert(cappedRows <= 14, `AskPicker: capped picker rows ${cappedRows} <= maxHeight 14`);
assert(
  frame().includes("A)") && frame().includes("B)") && frame().includes("(showing") && !frame().includes("C)"),
  "AskPicker: capped picker windows options (A,B shown, C.. hidden, '(showing' visible)"
);

// 5 down presses → selection moves to F (index 5); the window follows down.
baseFrames = frames.length;
for (let k = 0; k < 5; k++) {
  send("\x1b[B");
  await delay(150);
}
await waitFor(() => frames.length > baseFrames, "capped picker re-render after downs");
await waitFor(() => selLog2.at(-1) === 5, "capped picker selection reaches F");
await waitFor(() => frame().includes("F)"), "capped picker frame follows to F");
assert(
  frame().includes("F)") && !frame().includes("A)"),
  "AskPicker: window follows selection down (F shown, A hidden)"
);

instC2.unmount();

// S2: maxHeight 18, question wrapping to 8 rows → questionShown = min(8,
// max(1, 18-11-4)) = 3 → question truncated with "…" (options never starved);
// optionsBudget = max(1, 18-11-3) = 4 → 4 one-line options (A-D) visible,
// "(showing 4 of 6)".
const LONG_Q =
  "请你仔细阅读当前文档中关于即时设计即时梦合规与内容安全的相关章节，然后告诉我们接下来你更希望进行哪一种操作方式来完成本次学习任务".repeat(2);
const selLog3 = [];
function HarnessLongQ() {
  const [sel, setSel] = React.useState(0);
  return React.createElement(AskPicker, {
    question: LONG_Q,
    options: OPTS6,
    selectedIndex: sel,
    onChangeIndex: (i) => { setSel(i); selLog3.push(i); },
    maxHeight: 18,
  });
}

baseFrames = frames.length;
const instC3 = render(React.createElement(HarnessLongQ), { stdin, stdout, exitOnCtrlC: false });
await waitFor(() => frames.length > baseFrames, "long-question picker first frame");
await waitFor(() => frame().includes("…"), "long question truncated marker");
const longRows = strip(frame()).split("\n").filter((r) => r.trim() !== "").length;
assert(longRows <= 18, `AskPicker: long-question picker rows ${longRows} <= maxHeight 18`);
assert(
  frame().includes("…") && frame().includes("D)") && !frame().includes("E)") && frame().includes("(showing"),
  "AskPicker: long question truncated with '…', options windowed to A-D"
);

instC3.unmount();

// ---- Part C (cont.): embedded-option question cleanup ----
// The LLM sometimes embeds option lines ("A：先完成...") inside `question`
// while also passing them in `options`. cleanQuestion drops any question LINE
// whose content (after a label prefix) exactly matches an option value.
const DUP_Q =
  "请选择你倾向的方式：\nA：先完成当前知识点的练习并记录正确率\nB：切换到即梦工具专题开始新的学习路径";
const DUP_OPTS = {
  A: "先完成当前知识点的练习并记录正确率",
  B: "切换到即梦工具专题开始新的学习路径",
  C: "复习之前学过的工具矩阵内容",
};

baseFrames = frames.length;
const instDup = render(
  React.createElement(AskPicker, {
    question: DUP_Q,
    options: DUP_OPTS,
    selectedIndex: 0,
    onChangeIndex: () => {},
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => frames.length > baseFrames, "dup-question picker first frame");
await waitFor(() => frame().includes("A) 先完成"), "dup question: option row rendered");
assert(
  frame().includes("A) 先完成") && !frame().includes("A：先完成"),
  "AskPicker: embedded option line stripped from question (option row kept, no 'A：' duplicate)"
);
instDup.unmount();

// Legit prose whose content differs from every option value is always kept.
const LEGIT_Q = "A) 和 B) 哪个更好？";
const LEGIT_OPTS = { A: "甲方案", B: "乙方案" };

baseFrames = frames.length;
const instLegit = render(
  React.createElement(AskPicker, {
    question: LEGIT_Q,
    options: LEGIT_OPTS,
    selectedIndex: 0,
    onChangeIndex: () => {},
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => frames.length > baseFrames, "legit prose picker first frame");
await waitFor(() => frame().includes("A) 和 B) 哪个更好"), "legit prose question kept");
assert(
  frame().includes("A) 和 B) 哪个更好"),
  "AskPicker: legit prose 'A) 和 B) 哪个更好？' kept (content != any option value)"
);
instLegit.unmount();

// ---- Part C (cont.): over-budget selected option stays inside maxHeight ----
// The selected option wraps to 3 rows but optionsBudget = max(1, 13-1-11) = 1,
// so the option is capped to 1 row + "…" and the picker never exceeds
// maxHeight (pre-fix this rendered ~15 rows and overlapped the footer).
const OPTS_TALL = {
  A: "这个选项的文字特别长，会换行成多行显示，比如这里继续写很多内容直到超过预算行数",
  B: "短选项B",
  C: "短选项C",
};
const linesTallA = wrapToLines(`  A) ${OPTS_TALL.A}`, 36);
assert(linesTallA.length >= 3, `over-budget option A wraps to ${linesTallA.length} rows`);

baseFrames = frames.length;
const instTall = render(
  React.createElement(AskPicker, {
    question: "选择操作",
    options: OPTS_TALL,
    selectedIndex: 0,
    onChangeIndex: () => {},
    maxHeight: 13,
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => frames.length > baseFrames, "over-budget picker first frame");
await waitFor(() => frame().includes("…"), "over-budget option truncated marker");
const tallRows = strip(frame()).split("\n").filter((r) => r.trim() !== "").length;
assert(tallRows <= 13, `AskPicker: over-budget picker rows ${tallRows} <= maxHeight 13`);
assert(
  frame().includes("…") && !frame().includes(linesTallA[linesTallA.length - 1]),
  "AskPicker: over-budget option capped to 1 row + '…', last wrapped line not rendered"
);
assert(
  strip(frame()).includes("navigate"),
  "AskPicker: footer intact (not overlapped by the capped option)"
);
instTall.unmount();

// maxHeight=14 → optionsBudget = 2 → option capped to 2 rows + "…", still ≤ cap.
baseFrames = frames.length;
const instTall14 = render(
  React.createElement(AskPicker, {
    question: "选择操作",
    options: OPTS_TALL,
    selectedIndex: 0,
    onChangeIndex: () => {},
    maxHeight: 14,
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await waitFor(() => frames.length > baseFrames, "over-budget picker (14) first frame");
await waitFor(() => frame().includes("…"), "over-budget option truncated marker (14)");
const tallRows14 = strip(frame()).split("\n").filter((r) => r.trim() !== "").length;
assert(tallRows14 <= 14, `AskPicker: over-budget picker rows ${tallRows14} <= maxHeight 14`);
instTall14.unmount();

// ---- Part D: letter-aware grading (src/tools/mastery.js) ----
// Direct import works headless (better-sqlite3 loads fine). Exact-match
// assertions run everywhere; the semantic-mapping regression (prose
// expected_answer → option letter) needs Ollama and is guarded so the suite
// stays runnable with it down.
const { gradeAnswer } = await import("./dist/tools/mastery.js");

assert(
  await gradeAnswer("A", "A", "choice", { A: "x", B: "y" }) === true,
  "gradeAnswer: letter vs letter with options → true"
);
assert(
  await gradeAnswer("A", "免费、中文语义好、支持局部重绘扩图", "choice", {
    A: "免费、中文语义好、支持局部重绘扩图",
    B: "其他",
  }) === true,
  "gradeAnswer: letter maps to option text, exact match → true"
);
assert(
  await gradeAnswer("A", "免费 中文", "choice", { A: "免费中文" }) === true,
  "gradeAnswer: whitespace-insensitive exact match → true"
);
assert(
  await gradeAnswer("B: option b", "A", "choice", { A: "a", B: "b" }) === false,
  "gradeAnswer: letter B vs expected letter A → false"
);
assert(
  await gradeAnswer("A", "B", "choice", null) === false,
  "gradeAnswer: no options, legacy letter mismatch → false"
);
assert(
  await gradeAnswer("A", "free text", "short", null) === false,
  "gradeAnswer: no options, short without Ollama (semantic 0) → false"
);
assert(
  await gradeAnswer("A", "A", "choice", null) === true,
  "gradeAnswer: no options, legacy letter path intact — true"
);

// Regression (2026-08-07, real incident): mastery_quiz was called with
// question_type="choice" + options but expected_answer as PROSE
// ("K-means 属于无监督学习") instead of the option letter. The user picked the
// correct option B; the old code compared the long option sentence against the
// short expected phrase semantically (< 0.85) and marked it WRONG. gradeAnswer
// must map prose expected onto the option it matches (exact text first, then
// semantic argmax ≥ 0.6) and compare letters.
assert(
  await gradeAnswer("B", "选项B的完整原文", "choice", {
    A: "甲",
    B: "选项B的完整原文",
    C: "丙",
  }) === true,
  "gradeAnswer: prose expected exactly equals option B text → letter compare → true"
);

let ollamaUp = false;
try {
  const r = await fetch("http://127.0.0.1:11434/api/tags", {
    signal: AbortSignal.timeout(2000),
  });
  ollamaUp = r.ok;
} catch {
  /* down */
}
if (ollamaUp) {
  const KMEANS_OPTS = {
    A: "监督学习：目标是根据特征预测目标值",
    B: "无监督学习：将 n 个数据点分配到 K 个互斥的簇中，簇内相似度高、簇间相似度低",
    C: "强化学习：目标是根据奖励最大化",
    D: "监督学习：目标是把分类到已知标签类",
  };
  assert(
    await gradeAnswer("B", "K-means 属于无监督学习", "choice", KMEANS_OPTS) === true,
    "gradeAnswer: prose expected maps to option B (semantic argmax), pick B → true"
  );
  assert(
    await gradeAnswer("A", "K-means 属于无监督学习", "choice", KMEANS_OPTS) === false,
    "gradeAnswer: prose expected maps to B, wrong pick A → false"
  );
} else {
  console.log("SKIP  semantic-mapping regression (Ollama down)");
}

// Prose expected unrelated to every option: semantic mapping floor (0.6) is
// not reached, fallback semantic userText vs expected stays low → false.
// Deterministic with or without Ollama (0 when down).
assert(
  await gradeAnswer("B", "和任何选项都无关的乱写预期文本", "choice", {
    A: "甲",
    B: "乙",
    C: "丙",
  }) === false,
  "gradeAnswer: unrelated prose expected → no mapping, no fallback match → false"
);

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} FAILURES`);
console.error(`DIAG: asserts ran = ${assertCount}, failures = ${failures}`);
process.exit(failures === 0 ? 0 : 1);
