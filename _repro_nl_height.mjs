// Repro: input rows with a "\n" inside a text part — rendered height must
// match estimateInputLines (hard newline = real row) and the block label must
// never be split. Mirrors the App input-area structure.
import { Readable } from "node:stream";
import React from "react";
import { render, Box, Text } from "ink";
import { TextInput, estimateInputLines } from "./dist/cli/tui/TextInput.js";
import { theme } from "./dist/cli/tui/theme.js";

const parts = [
  { kind: "text", text: "啊啊啊\n啊啊啊" },
  { kind: "block", id: "b1", text: "1\n2\n3\n4\n5", lines: 5 },
];

const stdin = new Readable({ read() {} });
stdin.isTTY = true;
stdin.setRawMode = () => stdin;
stdin.setEncoding = () => {};
stdin.ref = () => {};
stdin.unref = () => {};
stdin.columns = 120;
stdin.rows = 30;

function InputArea({ cols }) {
  const width = Math.max(cols - 4, 10);
  const est = estimateInputLines(parts, width);
  return React.createElement(Box, { flexDirection: "column", flexShrink: 0 },
    React.createElement(Box, {
      flexDirection: "column",
      height: 2 + est,
      flexShrink: 0,
      borderStyle: "single",
      borderTop: true,
      borderColor: theme.borderActive,
      backgroundColor: theme.panel,
      paddingX: 1,
    },
      React.createElement(Box, { flexDirection: "row" },
        React.createElement(Text, { color: theme.primary }, "❯ "),
        React.createElement(TextInput, { parts, onChange: () => {}, onSubmit: () => {}, focus: true })
      )
    )
  );
}

async function run(cols) {
  const chunks = [];
  const stdout = new Readable({ read() {} });
  stdout.columns = cols;
  stdout.rows = 24;
  stdout.isTTY = true;
  stdout.write = (c) => { chunks.push(String(c)); return true; };
  stdout.setEncoding = () => {};
  stdout.unref = () => {};
  const inst = render(React.createElement(InputArea, { cols }), { stdin, stdout, exitOnCtrlC: false });
  await new Promise((r) => setTimeout(r, 250));
  inst.unmount();
  const out = chunks.join("").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b[()][0-9A-B]/g, "");
  const nonEmpty = out.split("\n").filter((l) => l.trim().length > 0);
  const est = estimateInputLines(parts, Math.max(cols - 4, 10));
  // Target: top border + est content rows + bottom border = 2 + est nonEmpty.
  const ok = nonEmpty.length <= 2 + est;
  const fragment = nonEmpty.some((l) => {
    const t = l.trim();
    return t === "行]" || t === "]" || t.startsWith("行]");
  });
  console.log(`cols=${cols} est=${est} nonEmptyRenderRows=${nonEmpty.length} ${ok && !fragment ? "OK" : "MISMATCH!"}`);
  console.log("  lines:", nonEmpty.map((l) => JSON.stringify(l.trim())).join(" | "));
}

await run(80);
await run(40);
await run(30);
