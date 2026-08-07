import { Readable } from "node:stream";
import React from "react";
import { render, Box, Text } from "ink";
import { AskPicker } from "./dist/cli/tui/AskPicker.js";

function makeIO(cols, rows) {
  const stdin = new Readable({ read() {} });
  stdin.isTTY = true; stdin.setRawMode = () => stdin; stdin.setEncoding = () => {}; stdin.ref = () => {}; stdin.unref = () => {};
  stdin.columns = 120; stdin.rows = 30;
  const chunks = [];
  const stdout = new Readable({ read() {} });
  stdout.columns = cols; stdout.rows = rows; stdout.isTTY = true;
  stdout.write = (c) => { chunks.push(String(c)); return true; };
  stdout.setEncoding = () => {}; stdout.unref = () => {};
  return { stdin, stdout, chunks };
}

const dump = (label, chunks) => {
  const raw = chunks.join("");
  console.error(`=== ${label} ===`);
  for (const l of raw.split("\n")) {
    const text = l.replace(/\x1b\[[0-9;]*m/g, "");
    if (text.trim()) console.error(JSON.stringify(text.trimEnd()));
  }
};

const opts = {
  A: "先答完当前的短答题，推进掌握进度",
  B: "改成出一道选择题（比如关于即梦或合规注意点的题目）",
  C: "其他操作",
  D: "跳过这道题，直接进入下一知识点",
};

// Scene 1: picker alone, wide terminal (100 cols)
{
  const { stdin, stdout, chunks } = makeIO(100, 24);
  const inst = render(
    React.createElement(AskPicker, {
      question: "你更想要哪个？请选择一项操作",
      options: opts,
      selectedIndex: 0,
      onChangeIndex: () => {},
    }),
    { stdin, stdout, exitOnCtrlC: false }
  );
  await new Promise((r) => setTimeout(r, 500));
  dump("Scene1: picker alone @100cols", chunks);
  inst.unmount();
}

// Scene 2: picker inside the real app layout (flex-end + overflow hidden +
// MessageList above), narrow-ish terminal (rows=14)
{
  const { stdin, stdout, chunks } = makeIO(100, 14);
  const fakeMessages = [];
  for (let i = 0; i < 30; i++) fakeMessages.push(`line ${i} of a long conversation that scrolls`);
  const inst = render(
    React.createElement(Box, {
      flexDirection: "column",
      flexGrow: 1,
      justifyContent: "flex-end",
      overflow: "hidden",
      height: 12,
    }, [
      React.createElement(Box, { key: "ml", flexGrow: 1, flexDirection: "column", overflow: "hidden" },
        fakeMessages.map((m, i) => React.createElement(Text, { key: i }, m))),
      React.createElement(AskPicker, {
        key: "picker",
        question: "你更想要哪个？请选择一项操作",
        options: opts,
        selectedIndex: 0,
        onChangeIndex: () => {},
      }),
    ]),
    { stdin, stdout, exitOnCtrlC: false }
  );
  await new Promise((r) => setTimeout(r, 500));
  dump("Scene2: inside app layout (flex-end, height 12)", chunks);
  inst.unmount();
}
