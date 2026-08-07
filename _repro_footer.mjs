import { Readable } from "node:stream";
import React from "react";
import { render } from "ink";
import { AskPicker } from "./dist/cli/tui/AskPicker.js";

const stdin = new Readable({ read() {} });
stdin.isTTY = true; stdin.setRawMode = () => stdin; stdin.setEncoding = () => {}; stdin.ref = () => {}; stdin.unref = () => {};
stdin.columns = 120; stdin.rows = 30;
const chunks = [];
const stdout = new Readable({ read() {} });
stdout.columns = 40; stdout.rows = 24; stdout.isTTY = true;
stdout.write = (c) => { chunks.push(String(c)); return true; };
stdout.setEncoding = () => {}; stdout.unref = () => {};

// A 3-row option at 36 content cols; maxHeight=14 -> budget = 14-1-11 = 2
const longOpt = "这个选项的文字特别长，会换行成多行显示，比如这里继续写很多内容直到超过预算行数";
const inst = render(
  React.createElement(AskPicker, {
    question: "选择操作",
    options: {
      A: longOpt,
      B: "短选项B",
      C: "短选项C",
    },
    selectedIndex: 0,
    onChangeIndex: () => {},
    maxHeight: 14,
  }),
  { stdin, stdout, exitOnCtrlC: false }
);
await new Promise((r) => setTimeout(r, 500));
let row = 0;
for (const l of chunks.join("").split("\n")) {
  const t = l.replace(/\x1b\[[0-9;]*m/g, "");
  if (t.trim()) { row++; console.error(`${String(row).padStart(2)}: ${JSON.stringify(t.trimEnd())}`); }
}
inst.unmount();
