import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import type { ToolContext } from "../types.ts";

/**
 * Interactive multiple-choice question: pops the TUI option picker via
 * ctx.ask. Use for ANY question with discrete options — including
 * conversational A/B choices — so the learner picks from a real menu
 * instead of typing a letter.
 */

/**
 * Generic identity wrapper so the tool's `execute` `params` is inferred from
 * its `parameters` schema (same pattern as the other tool modules).
 */
function tool<TParams extends TSchema, TDetails = unknown>(
  t: AgentHarnessTool<ToolContext, TParams, TDetails>
): AgentHarnessTool<ToolContext, TParams, TDetails> {
  return t;
}

export function createAskUserTool(): AgentHarnessTool<ToolContext> {
  return tool({
    name: "ui_ask",
    label: "Ask Multiple Choice (Interactive)",
    description:
      "Present a multiple-choice question to the learner INTERACTIVELY: the TUI pops an option picker and captures their choice. "
      + "Use this whenever you give the learner discrete options (A/B/C...), including conversational choices — do NOT print options as plain text. "
      + "Returns the learner's selection letter (e.g. 'A') or cancelled=true when they dismissed the picker. "
      + "Do NOT use this tool for mastery path quiz questions — use mastery_quiz with question_type=\"choice\" and options there (it pops the same picker and records the answer for grading). "
      + "The question must contain ONLY the question text — never embed the options or their labels (e.g. \"A) ...\") in it; every option goes exclusively into the options parameter.",
    parameters: Type.Object({
      question: Type.String({ description: "The question text" }),
      options: Type.Record(Type.String(), Type.String(), {
        description: "Label → option text, e.g. {A: 'Option A', B: 'Option B'}",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const entries = Object.entries(params.options);
      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "options must not be empty" }, null, 2) }],
          details: { success: false },
        };
      }
      if (ctx.ask) {
        try {
          const result = await ctx.ask(params.question, params.options);
          if (result) {
            const answer = (result.match(/^([A-Za-z])/) ?? [])[1]?.toUpperCase() ?? null;
            return {
              content: [{ type: "text", text: JSON.stringify({
                question: params.question,
                answer,
                selection: result,
                cancelled: false,
                instruction: "The learner chose an option. Continue based on it — do NOT re-ask the same question.",
              }, null, 2) }],
              details: { success: true, answer },
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify({
              cancelled: true,
              instruction: "The learner dismissed the picker. Do not push the question again; continue the conversation naturally.",
            }, null, 2) }],
            details: { success: false, cancelled: true },
          };
        } catch {
          // ask failed — fall through to text mode
        }
      }
      // Headless / no ctx.ask: text fallback (same format as mastery_quiz).
      const lines: string[] = [params.question, ""];
      for (const [label, text] of entries) lines.push(`${label}) ${text}`);
      lines.push("", "*Type your answer (A/B/C) — the agent will read it from your reply.*");
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { success: true, interactive: false },
      };
    },
  });
}
