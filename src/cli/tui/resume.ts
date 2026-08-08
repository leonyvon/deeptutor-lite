/**
 * Resume support for unfinished interactive questions (ui_ask / mastery_quiz).
 *
 * When the user exits while a choice question is on screen, the assistant
 * message containing the toolCall was already persisted (message_end →
 * session.appendMessage), but the toolResult never was — ctx.ask's promise is
 * still pending. On session resume (/continue, /switch, --session) the context
 * would end with "assistant(toolCall) without toolResult", which LLM APIs
 * reject and which the history renderer hides (no text). This module detects
 * that state, lets the learner answer the same question again via the shared
 * AskPicker, writes the synthesized toolResult back into the session, and the
 * app then drives one more agent turn so the flow continues naturally.
 */
import type { SessionTreeEntry, MessageEntry } from "@earendil-works/pi-agent-core";
import type { ToolCall, Message } from "@earendil-works/pi-ai";

/** An unfinished interactive toolCall found at the tail of a session. */
export interface UnfinishedAsk {
  toolCallId: string;
  toolName: string;
  question: string;
  options: Record<string, string>;
  /** Raw validated tool arguments (question/options/expected_answer/topic…). */
  args: Record<string, unknown>;
}

const INTERACTIVE_TOOLS = new Set(["ui_ask", "mastery_quiz"]);

/**
 * Internal user message that drives the resumed agent turn AFTER the learner
 * answered the re-presented question. The toolResult is appended to the
 * session first; this prompt then makes the harness run one more turn so the
 * agent sees the valid assistant(toolCall) → toolResult pair and continues
 * the flow (e.g. calls mastery_grade) without the learner typing again.
 * history.ts filters this marker out of the displayed message list.
 */
export const RESUME_PROMPT_MARKER = "[deeptutor-resume] ";
export const RESUME_PROMPT_TEXT =
  RESUME_PROMPT_MARKER +
  "The learner answered the previously pending interactive question via the picker. " +
  "The answer is recorded in the tool result above. Continue the flow naturally " +
  "(call mastery_grade if the question was from the mastery path). Do NOT re-present the question.";

/** Whether a user-message text is the internal resume prompt (filter it out). */
export function isResumePromptMessage(text: string): boolean {
  return text.startsWith(RESUME_PROMPT_MARKER);
}

/**
 * Find the LAST unfinished interactive toolCall in a session branch: the final
 * message must be an assistant message whose last interactive toolCall has no
 * matching toolResult anywhere in the branch. Anything else (later user
 * messages, already-resolved calls, non-interactive tools) → null.
 */
export function findUnfinishedAskToolCall(
  entries: SessionTreeEntry[]
): UnfinishedAsk | null {
  // Last message entry of the branch.
  let lastMessage: MessageEntry | null = null;
  for (const entry of entries) {
    if (entry.type === "message") lastMessage = entry as MessageEntry;
  }
  if (!lastMessage || lastMessage.message.role !== "assistant") return null;

  // The last interactive toolCall inside that final assistant message.
  let toolCall: ToolCall | null = null;
  for (const c of lastMessage.message.content) {
    if (c.type === "toolCall" && INTERACTIVE_TOOLS.has(c.name)) {
      toolCall = c;
    }
  }
  if (!toolCall) return null;

  // Resolved anywhere in the branch?
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = (entry as MessageEntry).message;
    if (
      msg.role === "toolResult" &&
      "toolCallId" in msg &&
      msg.toolCallId === toolCall.id
    ) {
      return null;
    }
  }

  const args = (toolCall.arguments ?? {}) as Record<string, unknown>;
  const question = typeof args.question === "string" ? args.question : "";
  const optionsRaw = args.options;
  const options: Record<string, string> = {};
  if (optionsRaw && typeof optionsRaw === "object") {
    for (const [k, v] of Object.entries(optionsRaw as Record<string, unknown>)) {
      if (typeof v === "string") options[k] = v;
    }
  }
  if (!question || Object.keys(options).length === 0) return null;

  return {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    question,
    options,
    args,
  };
}

/**
 * Synthesize the toolResult message the original tool would have returned, so
 * the resumed agent turn sees the same contract (alreadyAnswered semantics for
 * mastery_quiz, cancelled semantics for ui_ask dismissals).
 */
export function buildResumedToolResult(
  unfinished: UnfinishedAsk,
  value: string | null
): Message {
  const answer =
    (value?.match(/^([A-Za-z])/) ?? [])[1]?.toUpperCase() ?? null;
  const kbName = typeof unfinished.args.kb_name === "string" ? unfinished.args.kb_name : "";
  const topic = typeof unfinished.args.topic === "string" ? unfinished.args.topic : "";
  const timestamp = Date.now();

  if (unfinished.toolName === "mastery_quiz") {
    return {
      role: "toolResult",
      toolCallId: unfinished.toolCallId,
      toolName: "mastery_quiz",
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: Boolean(value),
              alreadyAnswered: Boolean(value),
              topic,
              question: unfinished.question,
              options: unfinished.options,
              userAnswer: answer ?? "A",
              nextStep: `mastery_grade(kb_name="${kbName}", topic="${topic}", answer="${answer ?? "A"}")`,
              instruction: value
                ? "This question was already presented interactively and answered. Call mastery_grade with the answer above — do NOT present the question again."
                : "The learner dismissed the picker. Do not push the question again; continue the conversation naturally.",
            },
            null,
            2
          ),
        },
      ],
      details: { success: Boolean(value), userAnswer: answer ?? "A" },
      isError: false,
      timestamp,
    };
  }

  // ui_ask
  return {
    role: "toolResult",
    toolCallId: unfinished.toolCallId,
    toolName: "ui_ask",
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            question: unfinished.question,
            answer,
            selection: value,
            cancelled: !value,
            instruction: value
              ? "The learner chose an option. Continue based on it — do NOT re-ask the same question."
              : "The learner dismissed the picker. Do not push the question again; continue the conversation naturally.",
          },
          null,
          2
        ),
      },
    ],
    details: value
      ? { success: true, answer }
      : { success: false, cancelled: true },
    isError: false,
    timestamp,
  };
}
