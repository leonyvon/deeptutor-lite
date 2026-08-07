/**
 * Convert session tree entries to UI messages for the TUI message list.
 */
import type { SessionTreeEntry, MessageEntry, Session } from "@earendil-works/pi-agent-core";
import type { JsonlSessionMetadata } from "@earendil-works/pi-agent-core";
import type { UIMessage, RewindTarget } from "./types.js";

let historyIdCounter = 0;
function nextHistoryId(): string {
  return `hist-${++historyIdCounter}`;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: string; text?: string } =>
      typeof c === "object" && c !== null && "type" in c
    )
    .map((c) => (c.type === "text" ? c.text ?? "" : ""))
    .join("");
}

export function sessionEntriesToMessages(entries: SessionTreeEntry[]): UIMessage[] {
  const out: UIMessage[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = (entry as MessageEntry).message;
    if (msg.role === "user") {
      const text = extractText(msg.content);
      if (text) {
        out.push({ type: "user", text, id: nextHistoryId() });
      }
    } else if (msg.role === "assistant") {
      const text = extractText(msg.content);
      if (text) {
        const isError =
          "stopReason" in msg && msg.stopReason === "error";
        out.push({
          type: "assistant",
          text,
          streaming: false,
          id: nextHistoryId(),
          isError: isError || undefined,
        });
      }
    }
    // tool/tool_result 角色跳过（已有 tool_execution_start/end 卡片）
  }
  return out;
}

/** Load the last user message preview (first 40 chars) from a session. */
export async function loadSessionPreview(
  session: Session<JsonlSessionMetadata>
): Promise<string> {
  try {
    const entries = await session.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type === "message" && "message" in entry) {
        const msg = (entry as MessageEntry).message;
        if (msg.role === "user") {
          const text = extractText(msg.content);
          if (text) return text.slice(0, 40);
        }
      }
    }
  } catch {
    // ignore
  }
  return "";
}

/**
 * Build rewind targets from session tree entries (already in chronological
 * order, root → leaf). Only user/assistant messages with non-empty extracted
 * text become targets; everything else is skipped.
 */
export function buildRewindTargets(entries: SessionTreeEntry[]): RewindTarget[] {
  const out: RewindTarget[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = (entry as MessageEntry).message;
    if (msg.role === "user") {
      const text = extractText(msg.content);
      if (text) out.push({ entryId: entry.id, role: "user", text });
    } else if (msg.role === "assistant") {
      const text = extractText(msg.content);
      if (text) out.push({ entryId: entry.id, role: "assistant", text });
    }
  }
  return out;
}
