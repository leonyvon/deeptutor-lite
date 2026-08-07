// Smoke test: paste blocks as input-flow placeholders (parts model).
// Regression harness for TextInput: empty-input guards, mergeParts semantics,
// paste→block insertion, caret crossing blocks, backspace deleting blocks,
// insertText merging at block boundaries, submit = merged full text.
//
// IMPORTANT (harness lesson): TextInput is a CONTROLLED component — edits only
// accumulate when the parent echoes the emitted parts back into the parts prop
// (App.tsx does this via setInput). A static `parts={[]}` parent never
// re-renders, so the component state never advances. We use a Harness wrapper
// with useState to mirror the real App. Also, ink reads stdin in readable-
// stream mode (addListener('readable') + read()), NOT via 'data' events, and
// calls stdin.ref()/setRawMode() — the fake must be a real Readable with those.
import { Readable } from "node:stream";
import React from "react";
import { render } from "ink";
import { TextInput, mergeParts, flatPartsText } from "./dist/cli/tui/TextInput.js";

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

// ---- pure functions (no component needed) ----
const P = [
  { kind: "text", text: "解释" },
  { kind: "block", id: "b1", text: "a\nb", lines: 2 },
  { kind: "text", text: "是什么" },
  { kind: "block", id: "b2", text: "c", lines: 1 },
];
assert(mergeParts(P) === "解释\na\nb\n是什么\nc", "mergeParts: blocks newline-separated, order kept");
assert(flatPartsText(P) === "解释a\nb是什么c", "flatPartsText = raw text concat");
assert(mergeParts([]) === "", "mergeParts empty");
assert(
  mergeParts([{ kind: "text", text: "你好中" }, { kind: "text", text: "后" }]) === "你好中后",
  "mergeParts: adjacent text parts concatenate WITHOUT newline (regression)"
);
assert(
  mergeParts([{ kind: "text", text: "你好" }, { kind: "block", id: "x", text: "第一行\n第二行", lines: 2 }, { kind: "text", text: "后" }])
    === "你好\n第一行\n第二行\n后",
  "mergeParts: text/block/text with correct single newlines"
);
assert(mergeParts([{ kind: "block", id: "x", text: "a", lines: 1 }]) === "a", "mergeParts: lone block");

// ---- component: fake stdin/stdout ----
const stdin = new Readable({ read() {} });
stdin.isTTY = true;
stdin.setRawMode = () => stdin;
stdin.setEncoding = () => {};
stdin.ref = () => {};
stdin.unref = () => {};
stdin.columns = 120;
stdin.rows = 30;
const send = (s) => { stdin.push(s); };

const chunks = [];
const stdout = new Readable({ read() {} });
stdout.columns = 80;
stdout.rows = 24;
stdout.isTTY = true;
stdout.write = (c) => { chunks.push(String(c)); return true; };
stdout.setEncoding = () => {};
stdout.unref = () => {};

let submitted = null;
const onChangeLog = [];

// Controlled harness: echoes onChange parts back into the prop, like App.tsx.
function Harness() {
  const [parts, setParts] = React.useState([]);
  return React.createElement(TextInput, {
    parts,
    onChange: (p) => { setParts(p); onChangeLog.push(p); },
    onSubmit: (t) => { submitted = t; },
    focus: true,
    placeholder: "输入消息",
    screenRow: 22,
    screenColBase: 5,
  });
}

const inst = render(React.createElement(Harness), { stdin, stdout, exitOnCtrlC: false });
const outText = () => chunks.join("").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b[()][0-9A-B]/g, "");

await delay(400); // mount

// 1. typing into the EMPTY input (the crash regression)
send("你好");
await waitFor(() => onChangeLog.length > 0 && flatPartsText(onChangeLog.at(-1)) === "你好", "typing into empty input");
assert(flatPartsText(onChangeLog.at(-1)) === "你好", "typing into empty input creates first text part (crash regression)");

// 2. multi-line paste → block inserted after text
send("\x1b[200~第一行\n第二行\n第三行\x1b[201~");
await waitFor(() => {
  const p = onChangeLog.at(-1);
  return p && p.length === 2 && p[1].kind === "block" && p[1].text === "第一行\n第二行\n第三行";
}, "paste inserts block");
let parts = onChangeLog.at(-1);
assert(
  parts.length === 2 && parts[0].kind === "text" && parts[1].kind === "block" && parts[1].text === "第一行\n第二行\n第三行",
  "multi-line paste inserts block part after caret text (no empty fragment)"
);
assert(mergeParts(parts) === "你好\n第一行\n第二行\n第三行", "submit text after paste: text\\nblock");

// 3. ← onto block (off 0), type → merges into preceding text part
send("\x1b[D");
await delay(60);
send("中");
await waitFor(() => {
  const p = onChangeLog.at(-1);
  return p && p.length === 2 && p[0].text === "你好中";
}, "typing before block merges into preceding text");
parts = onChangeLog.at(-1);
assert(
  parts.length === 2 && parts[0].text === "你好中" && parts[1].kind === "block",
  "insertText at block boundary merges into preceding text part (no fragment)"
);
assert(mergeParts(parts) === "你好中\n第一行\n第二行\n第三行", "merged text before block kept on one line");

// 4. → → across the block, type → new text part after block
send("\x1b[C");
await delay(60);
send("\x1b[C");
await delay(60);
send("后");
await waitFor(() => {
  const p = onChangeLog.at(-1);
  return p && p.length === 3 && p[0].text === "你好中" && p[1].kind === "block" && p[2].text === "后";
}, "typing after block");
parts = onChangeLog.at(-1);
assert(
  parts.length === 3 && parts[0].text === "你好中" && parts[1].kind === "block" && parts[2].text === "后",
  "caret crosses block to trailing text (3 parts: text/block/text)"
);

// 5. ← then Backspace deletes the whole block
send("\x1b[D");
await delay(60);
send("\x7f");
await waitFor(() => {
  const p = onChangeLog.at(-1);
  return p && p.length === 2 && p[0].text === "你好中" && p[1].text === "后";
}, "backspace deletes block");
parts = onChangeLog.at(-1);
assert(
  parts.length === 2 && parts[0].text === "你好中" && parts[1].text === "后",
  "backspace at block boundary deletes the block, text parts merge"
);
assert(mergeParts(parts) === "你好中后", "after block deletion mergeParts concatenates without newline");

// 6. second paste mid-stream (caret back at text end, insert between texts)
send("\x1b[D"); // caret to end of "你好中"
await delay(60);
send("\x1b[200~aa\nbb\x1b[201~");
await waitFor(() => {
  const p = onChangeLog.at(-1);
  return p && p.length === 3 && p[1].kind === "block" && p[1].text === "aa\nbb" && p[2].text === "后";
}, "second paste mid-stream");
parts = onChangeLog.at(-1);
assert(
  parts.length === 3 && parts[0].text === "你好中" && parts[1].kind === "block" && parts[1].text === "aa\nbb" && parts[2].text === "后",
  "second paste inserts block mid-stream (text/block/text)"
);

// 7. submit = merged full text
send("\r");
await waitFor(() => submitted !== null, "submit delivers merged text");
assert(submitted === "你好中\naa\nbb\n后", `submit delivers merged text (got: ${JSON.stringify(submitted)})`);

// 8. rendering sanity: inline filled-block placeholder visible in output
const out = outText();
assert(out.includes("已粘贴"), "block placeholder rendered inline (filled box, label [已粘贴 N 行])");

inst.unmount();
console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} FAILURES`);
console.error(`DIAG: asserts ran = ${assertCount}, failures = ${failures}`);
process.exit(failures === 0 ? 0 : 1);
