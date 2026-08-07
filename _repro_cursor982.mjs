// Frame-by-frame scan: find every cursor-suffix emission (cursorUp N +
// cursorTo M + ?25h) and correlate with the frame's content row count.
import { Readable } from "node:stream";
import React from "react";
import { Box, Text, render } from "ink";
import { TextInput } from "./dist/cli/tui/TextInput.js";
import { theme } from "./dist/cli/tui/theme.js";

const ROWS = 30;
const chunks = [];

const stdin = new Readable({ read() {} });
stdin.isTTY = true;
stdin.setRawMode = () => stdin;
stdin.setEncoding = () => {};
stdin.ref = () => {};
stdin.unref = () => {};
stdin.columns = 120;
stdin.rows = ROWS;

const stdout = new Readable({ read() {} });
stdout.columns = 80;
stdout.rows = ROWS;
stdout.isTTY = true;
stdout.write = (c) => {
  chunks.push(String(c));
  return true;
};
stdout.setEncoding = () => {};
stdout.unref = () => {};

const inputAreaHeight = 3;
const screenRow = ROWS - inputAreaHeight; // 27
const visibleHeight = ROWS - inputAreaHeight - 2; // 25

const msgRows = Array.from({ length: visibleHeight }, (_, i) =>
  React.createElement(Box, { key: i, height: 1, flexShrink: 0 }, React.createElement(Text, null, `msg-${String(i).padStart(2, "0")}`))
);

const inst = render(
  React.createElement(
    Box,
    { flexDirection: "column", height: ROWS },
    React.createElement(Box, { flexDirection: "column", flexGrow: 1, overflow: "hidden" }, ...msgRows),
    React.createElement(
      Box,
      { flexDirection: "column", flexShrink: 0 },
      React.createElement(
        Box,
        { flexDirection: "column", height: inputAreaHeight, flexShrink: 0, borderStyle: "single", borderTop: true, borderColor: theme.borderActive, paddingX: 1 },
        React.createElement(
          Box,
          { flexDirection: "row" },
          React.createElement(Text, null, "❯ "),
          React.createElement(TextInput, { parts: [{ kind: "text", text: "abc" }], focus: true, screenRow, screenColBase: 5, onChange: () => {}, onSubmit: () => {} })
        )
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
await new Promise((r) => setTimeout(r, 1500));
inst.unmount();

const out = chunks.join("");

// Frames are wrapped in ?2026h ... ?2026l (Synchronized Update Mode).
const frameRe = /\x1b\[\?2026h([\s\S]*?)\x1b\[\?2026l/g;
let m;
let idx = 0;
while ((m = frameRe.exec(out)) !== null) {
  const frame = m[1];
  const strip = frame.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b[()][0-9A-B]/g, "");
  const contentLines = strip.split("\n").filter((l) => l.trim() !== "").length;
  const cu = frame.match(/\x1b\[(\d+)A/);
  const ct = frame.match(/\x1b\[(\d+)G/);
  const show = frame.includes("\x1b[?25h");
  const first = strip.split("\n").find((l) => l.trim() !== "");
  console.log(
    `frame[${idx}] contentLines=${contentLines} cursorUp=${cu?.[1] ?? "-"} cursorTo=${ct?.[1] ?? "-"} show=${show} first=${JSON.stringify((first ?? "").slice(0, 30))}`
  );
  idx++;
}
console.log("total frames:", idx);
