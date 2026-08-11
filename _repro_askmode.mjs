// Repro: ask-mode layout — PRECOMPUTED height allocation (no guessing).
// computeAskPickerLayout (shared with AskPicker) returns the picker's EXACT
// rendered height for the current question/options/width. The message
// history gets every remaining row; the picker takes only what it needs.
// Sum = content height → no black void, no overflow, whatever the content.
// Ask-mode content area = rows - 2 (input box is not rendered in ask mode).
process.env.FORCE_COLOR = "3";

const React = await import("react");
const { render, Box } = await import("ink");
const { Readable } = await import("stream");
const { MessageList } = await import("./dist/cli/tui/MessageList.js");
const { AskPicker, computeAskPickerLayout } = await import("./dist/cli/tui/AskPicker.js");

let failures = 0;
let assertCount = 0;
function assert(cond, label) {
  assertCount++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b[()][0-9A-B]/g, "");

const stdin = new Readable({ read() {} });
stdin.isTTY = true;
stdin.setRawMode = () => stdin;
stdin.setEncoding = () => {};
stdin.ref = () => {};
stdin.unref = () => {};
stdin.columns = 100;
stdin.rows = 40;

const chunks = [];
const frames = [];
const stdout = new Readable({ read() {} });
stdout.columns = 60;
stdout.rows = 30;
stdout.isTTY = true;
stdout.write = (c) => {
  const s = String(c);
  chunks.push(s);
  if (s.includes("\n") && s.length > 50) frames.push(s);
  return true;
};
stdout.setEncoding = () => {};
stdout.unref = () => {};

const waitFor = async (fn, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  console.log(`FAIL  timeout: ${label}`);
  failures++;
  return false;
};
const frame = () => frames[frames.length - 1] ?? "";

// App.tsx ask-mode math: rows=40 → content area = rows - 2 = 38 (input box not
// rendered in ask mode; only the 2-row status bar remains).
const ROWS = 40;
const contentHeight = ROWS - 2;

// Build 60-row history (totalLines >> content area).
const msgs = [];
for (let i = 0; i < 12; i++) {
  msgs.push({ type: "assistant", text: `第 ${i} 条消息内容:${"历史记录".repeat(30)}`, streaming: false, id: `m${i}` });
}
const { totalBufferLines } = await import("./dist/cli/tui/MessageList.js");
const totalLines = totalBufferLines(msgs, 60);
assert(totalLines > contentHeight, `history taller than content area (${totalLines} > ${contentHeight})`);

const contentWidth = Math.max(60 - 4, 10);

// ---- Scenario A: 3 short options → picker is SHORT, history gets most ----
const OPTS_SHORT = {
  A: "先答完当前的短答题，推进掌握进度",
  B: "改成出一道选择题（比如关于即梦或合规注意点的题目）",
  C: "其他操作",
};
const layoutA = computeAskPickerLayout("你更想要哪个", OPTS_SHORT, contentWidth, contentHeight, 0);
const msgA = contentHeight - layoutA.totalRows;
assert(layoutA.window.end - layoutA.window.start === 3, `A: all 3 options visible (no windowing), totalRows=${layoutA.totalRows}`);
assert(layoutA.totalRows <= contentHeight, `A: picker rows ${layoutA.totalRows} <= content ${contentHeight}`);
assert(msgA > layoutA.totalRows, `A: history gets the majority (${msgA} > ${layoutA.totalRows} rows) — no black void`);

// ---- Scenario B: 6 LONG options → picker takes what it needs, history keeps rest ----
const OPTS_LONG = {
  A: "先完成当前知识点的练习并记录正确率然后进入下一个模块继续学习",
  B: "切换到即梦工具专题开始新的学习路径并复习之前学过的内容要点",
  C: "回顾这个知识点相关的所有历史错题并重新作答一遍巩固记忆",
  D: "查看本主题的学习进度统计与掌握度评估报告生成学习建议",
  E: "直接进行一轮包含多个知识点的综合测验检验整体掌握情况",
  F: "结束本次学习会话总结今天的学习成果与明天的复习计划",
};
const layoutB = computeAskPickerLayout("请选择你倾向的方式", OPTS_LONG, contentWidth, contentHeight, 0);
const msgB = contentHeight - layoutB.totalRows;
assert(layoutB.totalRows + msgB === contentHeight, `B: sum = content height (${layoutB.totalRows}+${msgB}=${contentHeight})`);
assert(layoutB.totalRows <= contentHeight, `B: picker rows ${layoutB.totalRows} <= content ${contentHeight}`);
assert(msgB >= 3, `B: history keeps >= 3 context rows (got ${msgB})`);
assert(layoutB.window.end - layoutB.window.start >= 3, `B: at least 3 options visible (not "showing 1 of N")`);

// ---- Scenario C: extremely long single option → windowing caps, still fits ----
const OPTS_HUGE = {
  A: "请先完成当前知识点的全部练习题目并逐一记录正确率然后根据结果生成针对性的复习计划最后进入下一模块".repeat(3),
  B: "其他操作",
};
const layoutC = computeAskPickerLayout("选择", OPTS_HUGE, contentWidth, contentHeight, 0);
const msgC = contentHeight - layoutC.totalRows;
assert(layoutC.totalRows + msgC === contentHeight, `C: sum = content height (${layoutC.totalRows}+${msgC}=${contentHeight})`);
assert(layoutC.totalRows <= contentHeight, `C: picker rows ${layoutC.totalRows} <= content ${contentHeight}`);

// ---- Render check: real component in the same layout, rows fit ----
function Harness() {
  const [sel, setSel] = React.useState(0);
  const layout = computeAskPickerLayout("你更想要哪个", OPTS_SHORT, contentWidth, contentHeight, sel);
  const msgH = contentHeight - layout.totalRows;
  return React.createElement(
    Box,
    { flexDirection: "column", height: contentHeight },
    React.createElement(
      Box,
      { flexDirection: "column", flexGrow: 1, justifyContent: "flex-end", overflow: "hidden" },
      React.createElement(
        Box,
        { height: msgH, flexShrink: 0 },
        React.createElement(MessageList, { messages: msgs, scrollOffset: 0, visibleHeight: msgH })
      ),
      React.createElement(AskPicker, {
        question: "你更想要哪个",
        options: OPTS_SHORT,
        selectedIndex: sel,
        onChangeIndex: (i) => setSel(i),
        maxHeight: contentHeight,
      })
    )
  );
}

const inst = render(React.createElement(Harness), { stdin, stdout, exitOnCtrlC: false });
await waitFor(() => frames.length >= 1, "initial frame");
await waitFor(() => frame().includes("navigate"), "picker footer visible");

const rows = strip(frame()).split("\n");
const nonEmpty = rows.filter((r) => r.trim() !== "");
const historyRows = nonEmpty.filter((r) => r.includes("第 ") || r.includes("历史记录"));
assert(nonEmpty.length <= contentHeight, `render: total rows ${nonEmpty.length} <= content height ${contentHeight}`);
assert(historyRows.length >= 5, `render: history visible ${historyRows.length} rows (not erased)`);
assert(frame().includes("你更想要哪个") && frame().includes("A)") && frame().includes("navigate"), "render: picker complete (question+options+footer)");
const navIdx = rows.findIndex((r) => r.includes("navigate"));
assert(navIdx !== -1 && navIdx < contentHeight, `render: footer row ${navIdx} inside content area`);

// Down-press still works and the picker re-renders within budget.
inst.unmount();
console.log(`\n${failures === 0 ? "ALL REPRO CHECKS PASSED" : "REPRO FAILED"} — asserts ran = ${assertCount}, failures = ${failures}`);
process.exit(failures === 0 ? 0 : 1);
