import { Readable } from "node:stream";
import React from "react";
import { render } from "ink";
import { App } from "./dist/cli/tui/App.js";
import { inkAsk } from "./dist/cli/tui/ask.js";

function makeIO(cols, rows) {
  const stdin = new Readable({ read() {} });
  stdin.isTTY = true; stdin.setRawMode = () => stdin; stdin.setEncoding = () => {}; stdin.ref = () => {}; stdin.unref = () => {};
  stdin.columns = cols; stdin.rows = rows;
  const chunks = [];
  const stdout = new Readable({ read() {} });
  stdout.columns = cols; stdout.rows = rows; stdout.isTTY = true;
  stdout.write = (c) => { chunks.push(String(c)); return true; };
  stdout.setEncoding = () => {}; stdout.unref = () => {};
  return { stdin, stdout, chunks };
}

const fakeRuntime = {
  session: null, harness: null,
  ensureSession: async () => { throw new Error("no repo"); },
  currentModel: () => ({ providerName: "test", modelName: "test", reasoning: false }),
  config: { kb: { defaultKB: "kb" }, model: {} },
};

const options = {
  A: "先完成当前知识点的练习并记录正确率",
  B: "切换到即梦工具专题开始新的学习路径",
  C: "复习之前学过的工具矩阵内容",
  D: "做一套综合测验检验整体掌握程度",
  E: "讲解一个我没理解透的知识点细节",
  F: "调整学习节奏，减少题目数量",
};

// Test 1: rows=16 (short terminal), long question
{
  const { stdin, stdout, chunks } = makeIO(120, 16);
  const inst = render(React.createElement(App, { runtime: fakeRuntime }), { stdin, stdout, exitOnCtrlC: false });
  await new Promise((r) => setTimeout(r, 500));
  chunks.length = 0;
  inkAsk("根据刚才学习的国内 AI 工具矩阵内容，接下来你希望如何继续推进学习进度？是继续完成当前知识点的练习，还是切换到新的工具专题，或者先复习一下之前掌握的内容？请选择你倾向的方式，我会据此安排接下来的学习节奏和题目类型。", options);
  await new Promise((r) => setTimeout(r, 600));
  console.error(`=== rows=16, long question ===`);
  for (const l of chunks.join("").split("\n")) {
    const t = l.replace(/\x1b\[[0-9;]*m/g, "");
    if (t.trim()) console.error(JSON.stringify(t.trimEnd()));
  }
  inst.unmount();
}

// Test 2: rows=24, press DOWN 5x and see windowing follow
{
  const { stdin, stdout, chunks } = makeIO(120, 24);
  const inst = render(React.createElement(App, { runtime: fakeRuntime }), { stdin, stdout, exitOnCtrlC: false });
  await new Promise((r) => setTimeout(r, 500));
  chunks.length = 0;
  inkAsk("请选择一项操作，我会根据你的选择继续", options);
  await new Promise((r) => setTimeout(r, 500));
  for (let i = 0; i < 5; i++) {
    chunks.length = 0;
    stdin.push("\x1b[B");
    await new Promise((r) => setTimeout(r, 300));
  }
  console.error(`=== rows=24 after 5x DOWN ===`);
  for (const l of chunks.join("").split("\n")) {
    const t = l.replace(/\x1b\[[0-9;]*m/g, "");
    if (t.trim()) console.error(JSON.stringify(t.trimEnd()));
  }
  inst.unmount();
}
