// Paste diagnostics: capture exactly what ink delivers for a multi-line paste.
// Run: node diag-paste.mjs   → paste multi-line text → Ctrl+C → check diag-paste.log
import React from "react";
import { render, useInput, useApp } from "ink";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";

const LOG = "diag-paste.log";
const log = (msg) => {
  try { appendFileSync(LOG, msg + "\n"); } catch {}
};

process.stdout.write("\x1b[?2004h"); // bracketed paste ON

function Diag() {
  const { exit } = useApp();
  useInput((input, key) => {
    const hex = Buffer.from(input, "utf8").toString("hex");
    const keyFlags = Object.entries(key)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(",");
    log(`INPUT=${JSON.stringify(input)} HEX=${hex} KEYS=${keyFlags || "-"}`);
    if (key.ctrl && input === "c") exit();
  });
  return React.createElement("text", null, "已启用 bracketed paste。请粘贴多行文本（可含中文），然后 Ctrl+C 退出。日志写入 diag-paste.log");
}

render(React.createElement(Diag));
