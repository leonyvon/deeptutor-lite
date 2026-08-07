// Repro: ui_ask option picker selection highlight with long (wrapping) options.
// Part 1: wrap-ansi color survival on wrapped lines.
// Part 2: headless AskPicker with 3 options (B wraps to 2 lines) — press ↓ and
// dump frames to see exactly what is highlighted per press.
import { Readable } from "node:stream";
import wrapAnsi from "wrap-ansi";
import React from "react";
import { render } from "ink";
import { AskPicker } from "./dist/cli/tui/AskPicker.js";

// ---- Part 1: does the accent color survive wrap-ansi? ----
const ACCENT = "\x1b[38;2;157;124;216m"; // theme.accent #9d7cd8
const RESET = "\x1b[39m";
const longText = "B) 改成出一道选择题（比如关于即梦或合规注意点的题目）";
const colored = ACCENT + "> " + longText + RESET;
const wrapped = wrapAnsi(colored, 20, { trim: false, hard: true });
const accentCount = (wrapped.match(/38;2;157;124;216/g) ?? []).length;
console.log(`Part1: colored string wrapped at width 20 -> accent code count = ${accentCount}`);
console.log("Part1 raw:", JSON.stringify(wrapped));
console.log("Part1 lines (strip ansi):");
for (const line of wrapped.split("\n")) {
  console.log("  [" + line.replace(/\x1b\[[0-9;]*m/g, "") + "]");
}

// ---- Part 2: AskPicker headless ----
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, label, timeout = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (cond()) return;
    await delay(20);
  }
  throw new Error(`TIMEOUT waiting for: ${label}`);
}

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
stdout.columns = 40; // narrow — forces option B to wrap
stdout.rows = 24;
stdout.isTTY = true;
stdout.write = (c) => {
  chunks.push(String(c));
  return true;
};
stdout.setEncoding = () => {};
stdout.unref = () => {};

const outRaw = () => chunks.join("");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

function Harness() {
  const [sel, setSel] = React.useState(0);
  React.useEffect(() => {
    globalThis.__sel = sel;
  });
  return React.createElement(AskPicker, {
    question: "你更想要哪个？",
    options: {
      A: "先答完当前的短答题，推进掌握进度",
      B: "改成出一道选择题（比如关于即梦或合规注意点的题目）",
      C: "其他操作",
    },
    selectedIndex: sel,
    onChangeIndex: setSel,
  });
}

const inst = render(React.createElement(Harness), {
  stdin,
  stdout,
  exitOnCtrlC: false,
});
await waitFor(() => outRaw().includes("你更想要哪个"), "picker rendered");
console.log("\nPart2: initial frame (selectedIndex=0):");
console.log(strip(outRaw()).split("\n").filter((l) => l.trim()).join(" | "));
console.log(`  accent occurrences: ${(outRaw().match(/38;2;157;124;216/g) ?? []).length}`);

const dump = (label) => {
  const raw = outRaw();
  const lines = raw.split("\n");
  console.log(`\nPart2: ${label} (selectedIndex=${globalThis.__sel}):`);
  for (const l of lines) {
    const hasAccent = l.includes("38;2;157;124;216");
    const text = strip(l);
    if (text.trim()) console.log(`  ${hasAccent ? "HIGHLIGHT:" : "          "}[${text}]`);
  }
  console.log(`  total accent occurrences: ${(raw.match(/38;2;157;124;216/g) ?? []).length}`);
};

// press down: A -> B
chunks.length = 0;
stdin.push("\x1b[B");
await waitFor(() => globalThis.__sel === 1, "selection moved to B (index 1)");
dump("after first DOWN (expect B highlighted)");

// press down: B -> C
chunks.length = 0;
stdin.push("\x1b[B");
await waitFor(() => globalThis.__sel === 2, "selection moved to C (index 2)");
dump("after second DOWN (expect C highlighted)");

// press down again: clamp at C
chunks.length = 0;
stdin.push("\x1b[B");
await waitFor(() => globalThis.__sel === 2, "selection clamped at C");
dump("after third DOWN (clamped at C)");

inst.unmount();
console.log("\nDONE");
