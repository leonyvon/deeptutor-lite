// Smoke test: resume of unfinished interactive questions (ui_ask / mastery_quiz).
//
// Scenario: the user exits while a choice question is on screen. The assistant
// message with the toolCall was persisted (message_end → appendMessage) but the
// toolResult never was. On /continue (or --session), findUnfinishedAskToolCall
// detects the dangling toolCall, restoreAsk re-pops the SAME AskPicker, and
// buildResumedToolResult synthesizes the toolResult so the next agent turn
// continues the flow (alreadyAnswered semantics for mastery_quiz).
//
// Import from dist (built). Pure-function tests + module-level ask.ts round
// trip — no ink rendering needed (restoreAsk/resolveAsk are module singletons).
import { findUnfinishedAskToolCall, buildResumedToolResult, RESUME_PROMPT_TEXT, RESUME_PROMPT_MARKER, isResumePromptMessage } from "./dist/cli/tui/resume.js";
import { restoreAsk, resolveAsk, getPendingAsk, subscribeAsk } from "./dist/cli/tui/ask.js";

let failures = 0;
let assertCount = 0;
function assert(cond, label) {
  assertCount++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

// ---- fixtures: session branch entries (pi-agent-core SessionTreeEntry) ----
const msgEntry = (message) => ({
  type: "message",
  id: `m-${Math.random().toString(36).slice(2, 8)}`,
  parentId: null,
  timestamp: new Date().toISOString(),
  message,
});

const assistantWithToolCall = (toolCall) =>
  msgEntry({
    role: "assistant",
    content: [{ type: "text", text: "以下是问题：" }, toolCall],
    timestamp: Date.now(),
  });

const toolCall = (id, name, args) => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});

const toolResult = (toolCallId, toolName, text) =>
  msgEntry({
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  });

const userMsg = (text) =>
  msgEntry({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });

const UI_ASK_ARGS = {
  question: "你想先学哪个主题？",
  options: { A: "先学 K-means", B: "先学回归", C: "先学分类" },
};
const MASTERY_ARGS = {
  kb_name: "ml",
  topic: "K-means",
  question: "K-means 属于哪种学习？",
  question_type: "choice",
  options: { A: "监督学习", B: "无监督学习", C: "强化学习" },
  expected_answer: "B",
};

// ---- 1. findUnfinishedAskToolCall: detection ----
assert(
  findUnfinishedAskToolCall([assistantWithToolCall(toolCall("tc1", "ui_ask", UI_ASK_ARGS))]) !== null,
  "detects dangling ui_ask toolCall at tail"
);
const found = findUnfinishedAskToolCall([
  userMsg("开始"),
  assistantWithToolCall(toolCall("tc1", "ui_ask", UI_ASK_ARGS)),
]);
assert(
  found !== null &&
    found.toolCallId === "tc1" &&
    found.toolName === "ui_ask" &&
    found.question === UI_ASK_ARGS.question &&
    found.options.B === "先学回归",
  "extracts toolCallId/question/options from dangling ui_ask"
);

// already answered → not unfinished
assert(
  findUnfinishedAskToolCall([
    assistantWithToolCall(toolCall("tc1", "ui_ask", UI_ASK_ARGS)),
    toolResult("tc1", "ui_ask", '{"answer":"B"}'),
  ]) === null,
  "resolved toolCall (has toolResult) → null"
);

// tail is a user message → not unfinished
assert(
  findUnfinishedAskToolCall([
    assistantWithToolCall(toolCall("tc1", "ui_ask", UI_ASK_ARGS)),
    userMsg("继续"),
  ]) === null,
  "tail user message → null"
);

// non-interactive tool at tail → null
assert(
  findUnfinishedAskToolCall([
    assistantWithToolCall(toolCall("tc1", "web_search", { query: "x" })),
  ]) === null,
  "non-interactive toolCall (web_search) → null"
);

// mastery_quiz with options is interactive
const foundMastery = findUnfinishedAskToolCall([
  assistantWithToolCall(toolCall("tc2", "mastery_quiz", MASTERY_ARGS)),
]);
assert(
  foundMastery !== null &&
    foundMastery.toolName === "mastery_quiz" &&
    foundMastery.args.kb_name === "ml" &&
    foundMastery.args.topic === "K-means",
  "detects dangling mastery_quiz (choice) toolCall, args preserved"
);

// assistant with text but NO toolCall → null
assert(
  findUnfinishedAskToolCall([assistantWithToolCall(null).message
    ? msgEntry({ role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: Date.now() })
    : null]) === null,
  "assistant without toolCall → null"
);

// ---- 2. buildResumedToolResult: ui_ask ----
const rUi = buildResumedToolResult(
  { toolCallId: "tc1", toolName: "ui_ask", question: UI_ASK_ARGS.question, options: UI_ASK_ARGS.options, args: UI_ASK_ARGS },
  "B: 先学回归"
);
const rUiContent = JSON.parse(rUi.content[0].text);
assert(
  rUi.role === "toolResult" &&
    rUi.toolCallId === "tc1" &&
    rUiContent.answer === "B" &&
    rUiContent.cancelled === false &&
    rUiContent.selection === "B: 先学回归" &&
    rUi.details.success === true,
  "ui_ask resume: answer letter extracted, cancelled=false"
);

const rUiCancel = buildResumedToolResult(
  { toolCallId: "tc1", toolName: "ui_ask", question: UI_ASK_ARGS.question, options: UI_ASK_ARGS.options, args: UI_ASK_ARGS },
  null
);
const rUiCancelContent = JSON.parse(rUiCancel.content[0].text);
assert(
  rUiCancelContent.cancelled === true &&
    rUiCancelContent.answer === null &&
    rUiCancel.details.cancelled === true,
  "ui_ask resume: ESC dismissal → cancelled=true"
);

// ---- 3. buildResumedToolResult: mastery_quiz ----
const rM = buildResumedToolResult(
  { toolCallId: "tc2", toolName: "mastery_quiz", question: MASTERY_ARGS.question, options: MASTERY_ARGS.options, args: MASTERY_ARGS },
  "B: 无监督学习"
);
const rMContent = JSON.parse(rM.content[0].text);
assert(
  rMContent.alreadyAnswered === true &&
    rMContent.userAnswer === "B" &&
    rMContent.nextStep.includes("mastery_grade") &&
    rMContent.nextStep.includes('topic="K-means"') &&
    rMContent.nextStep.includes('answer="B"') &&
    rM.details.success === true,
  "mastery_quiz resume: alreadyAnswered + nextStep mastery_grade(topic, answer)"
);

// ---- 4. restoreAsk round trip (module-level, same as App wiring) ----
let resumedValue = null;
const seen = [];
const unsub = subscribeAsk(() => {
  const p = getPendingAsk();
  seen.push(p ? p.question : null);
});
restoreAsk(UI_ASK_ARGS.question, UI_ASK_ARGS.options, (v) => { resumedValue = v; });
assert(
  getPendingAsk() !== null &&
    getPendingAsk().question === UI_ASK_ARGS.question &&
    Object.keys(getPendingAsk().options).length === 3 &&
    seen.at(-1) === UI_ASK_ARGS.question,
  "restoreAsk sets pendingAsk + notifies listeners (AskPicker pops)"
);
resolveAsk("C: 先学分类");
assert(
  resumedValue === "C: 先学分类" &&
    getPendingAsk() === null &&
    seen.at(-1) === null,
  "resolveAsk → onResolve receives choice, pending cleared (back to chat)"
);
unsub();

// ---- 5. internal resume prompt (drives the resumed agent turn) ----
assert(
  typeof RESUME_PROMPT_TEXT === "string" &&
    RESUME_PROMPT_TEXT.startsWith(RESUME_PROMPT_MARKER) &&
    RESUME_PROMPT_TEXT.includes("mastery_grade") &&
    RESUME_PROMPT_TEXT.includes("Do NOT re-present"),
  "RESUME_PROMPT_TEXT exists, marked, instructs continue (mastery_grade path)"
);
assert(
  isResumePromptMessage(RESUME_PROMPT_TEXT) &&
    !isResumePromptMessage("普通用户消息") &&
    !isResumePromptMessage(""),
  "isResumePromptMessage filters internal resume prompt only"
);

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} FAILURES`);
console.error(`DIAG: asserts ran = ${assertCount}, failures = ${failures}`);
process.exit(failures === 0 ? 0 : 1);
