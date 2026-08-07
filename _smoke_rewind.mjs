// Smoke test: /rewind feature — buildRewindTargets + isDoubleEsc (pure logic)
// and RewindPicker headless interaction (windowed list, ↑↓/enter/escape).
//
// IMPORTANT (harness lesson from _smoke_parts.mjs): RewindPicker is a CONTROLLED
// component — selection only advances when the parent echoes onChangeIndex back
// into the selectedIndex prop. A static prop never re-renders, so the state
// never moves. We use a Harness wrapper with useState, mirroring App.tsx. ink
// reads stdin in readable-stream mode and calls stdin.ref()/setRawMode() — the
// fake must be a real Readable with those methods.
import { Readable } from "node:stream";
import React from "react";
import { render } from "ink";
import { buildRewindTargets } from "./dist/cli/tui/history.js";
import { isDoubleEsc } from "./dist/cli/tui/esc.js";
import { RewindPicker } from "./dist/cli/tui/RewindPicker.js";

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

// ---- Part A: pure logic ----
// Fake SessionTreeEntry arrays in chronological order (root → leaf).
const mkMsg2 = (id, role, content) => ({
  id,
  parentId: "prev",
  timestamp: "2026-08-07T00:00:00.000Z",
  type: "message",
  message: { role, content },
});
const mkOther = (id, type, extra = {}) => ({
  id,
  parentId: "prev",
  timestamp: "2026-08-07T00:00:00.000Z",
  type,
  ...extra,
});

const entries = [
  mkMsg2("e1", "user", [{ type: "text", text: "第一问" }]),
  mkMsg2("e2", "assistant", [{ type: "text", text: "第一答" }]),
  mkMsg2("e3", "user", []), // empty content user → skipped
  mkMsg2("e4", "assistant", [{ type: "text", text: "" }]), // empty text assistant → skipped
  mkOther("e5", "model_change", { provider: "p", modelId: "m" }), // model_change → skipped
  mkMsg2("e6", "tool", [{ type: "text", text: "tool text" }]), // tool role → skipped
  mkMsg2("e7", "user", [{ type: "text", text: "第二问" }]),
  mkMsg2("e8", "assistant", [{ type: "text", text: "第二答" }]),
];

const targets = buildRewindTargets(entries);
assert(
  Array.isArray(targets) && targets.length === 4,
  `buildRewindTargets: only 4 non-empty user/assistant entries (got ${targets.length})`
);
assert(
  targets.map((t) => t.entryId).join(",") === "e1,e2,e7,e8",
  `buildRewindTargets: chronological order preserved (got ${targets.map((t) => t.entryId).join(",")})`
);
assert(
  targets.map((t) => t.role).join(",") === "user,assistant,user,assistant",
  `buildRewindTargets: roles match (got ${targets.map((t) => t.role).join(",")})`
);
assert(
  targets.map((t) => t.text).join("|") === "第一问|第一答|第二问|第二答",
  `buildRewindTargets: extracted texts match (got ${targets.map((t) => t.text).join("|")})`
);
assert(buildRewindTargets([]).length === 0, "buildRewindTargets: empty entries → []");

// isDoubleEsc windowing.
assert(isDoubleEsc(null, 1000) === false, "isDoubleEsc: null lastEscAt → false");
assert(
  isDoubleEsc(null, 5000) === false,
  "isDoubleEsc: single press (lastEscAt null) → false"
);
assert(
  isDoubleEsc(1000, 1200) === true,
  "isDoubleEsc: 200ms gap (≤ 400ms) → true"
);
assert(
  isDoubleEsc(1000, 1401) === false,
  "isDoubleEsc: 401ms gap (> 400ms) → false"
);
assert(
  isDoubleEsc(1000, 1400) === true,
  "isDoubleEsc: boundary exactly 400ms → true"
);

// ---- Part B: RewindPicker headless interaction ----
// fake stdin/stdout (exact recipe from _smoke_parts.mjs)
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

const outText = () =>
  chunks.join("").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b[()][0-9A-B]/g, "");

// 10 fake targets to also exercise windowing (WINDOW_SIZE = 8).
const longText =
  "这是一个非常长的用户消息，用于测试预览文本截断逻辑是否正常工作超过三十六个字符";
const fakeTargets = Array.from({ length: 10 }, (_, i) => ({
  entryId: `e${i + 1}`,
  role: i % 2 === 0 ? "user" : "assistant",
  text: i === 0 ? longText : `目标消息 ${i + 1}`,
}));

const indexLog = [];
const onSelectLog = [];
const onCancelLog = [];

// Controlled wrapper: echoes onChangeIndex back into selectedIndex (REQUIRED).
function Harness({ initialIndex = 0 }) {
  const [selectedIndex, setSelectedIndex] = React.useState(initialIndex);
  return React.createElement(RewindPicker, {
    targets: fakeTargets,
    selectedIndex,
    onSelect: (t) => { onSelectLog.push(t); },
    onCancel: () => { onCancelLog.push(1); },
    onChangeIndex: (i) => { setSelectedIndex(i); indexLog.push(i); },
  });
}

const inst = render(React.createElement(Harness, { initialIndex: 0 }), {
  stdin,
  stdout,
  exitOnCtrlC: false,
});

await delay(400); // mount

// Rendering sanity: title, role tags, windowing hint, footer hint.
const out1 = outText();
assert(out1.includes("Rewind to…"), "RewindPicker: title rendered");
assert(
  out1.includes("（你）") && out1.includes("（AI）"),
  "RewindPicker: role tags 你/AI rendered"
);
assert(
  out1.includes("(showing 8 of 10)"),
  "RewindPicker: windowing hint '(showing 8 of 10)' rendered"
);
assert(
  out1.includes("↑↓ navigate · enter rewind · esc cancel"),
  "RewindPicker: footer hint rendered"
);
assert(
  out1.includes("…"),
  "RewindPicker: long preview truncated with ellipsis"
);

// 1. down arrow → selection moves to index 1 (echoed by controlled wrapper)
send("\x1b[B");
await waitFor(() => indexLog.at(-1) === 1, "down arrow moves selection to 1");
assert(indexLog.at(-1) === 1, "down arrow: onChangeIndex(1) fired");

// 2. enter → onSelect with targets[1]
send("\r");
await waitFor(() => onSelectLog.length === 1, "enter selects target");
assert(
  onSelectLog.length === 1 && onSelectLog[0].entryId === fakeTargets[1].entryId,
  `enter: onSelect called with targets[1] (got ${onSelectLog[0]?.entryId ?? "none"})`
);

// 3. fresh instance, escape → onCancel
inst.unmount();
chunks.length = 0;
indexLog.length = 0;
onSelectLog.length = 0;
onCancelLog.length = 0;
const inst2 = render(React.createElement(Harness, { initialIndex: 0 }), {
  stdin,
  stdout,
  exitOnCtrlC: false,
});
await delay(400);
send("\x1b");
await waitFor(() => onCancelLog.length === 1, "escape cancels picker");
assert(onCancelLog.length === 1, "escape: onCancel fired");
assert(
  onSelectLog.length === 0 && indexLog.length === 0,
  "escape: no selection / no index change"
);

inst2.unmount();
console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} FAILURES`);
console.error(`DIAG: asserts ran = ${assertCount}, failures = ${failures}`);
process.exit(failures === 0 ? 0 : 1);
