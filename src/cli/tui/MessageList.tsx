import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { UIMessage } from "./types.js";
import { ToolCard } from "./ToolCard.js";

interface MessageListProps {
  messages: UIMessage[];
  scrollOffset: number;
  visibleHeight: number;
}

/** True for East Asian wide/fullwidth/emoji code points (2 terminal columns). */
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals, kana, CJK ideographs, Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // fullwidth signs
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & pictographs
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK extension B–G
  );
}

/**
 * Terminal display width of a string: ASCII/Latin = 1 column, CJK
 * wide/fullwidth/emoji = 2 columns. Deliberately overestimates rare and
 * ambiguous wide-ish ranges (better to reserve one extra row than to
 * truncate content at the bottom of the view).
 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || cp === 0x7f) continue; // control chars render 0 columns
    w += isWideCodePoint(cp) ? 2 : 1;
  }
  return w;
}

/**
 * Number of terminal rows `text` occupies when wrapped at `width` columns.
 * Splits on newlines; every segment is at least one row. Empty string = 1 row.
 */
export function countDisplayLines(text: string, width: number): number {
  if (!text) return 1;
  let lines = 0;
  for (const seg of text.split("\n")) {
    lines += Math.max(1, Math.ceil(displayWidth(seg) / width));
  }
  return lines;
}

export function estimateMessageHeight(msg: UIMessage, termWidth: number): number {
  const width = Math.max(termWidth - 8, 20);
  let lines = 0;
  if (msg.type === "user") {
    lines = 1 + countDisplayLines(msg.text, width);
  } else if (msg.type === "assistant") {
    lines = 1 + countDisplayLines(msg.text, width) + (msg.streaming ? 1 : 0);
  } else if (msg.type === "tool") {
    lines = 2;
  }
  return lines + 1; // +1 for margin
}

export function MessageList({
  messages,
  scrollOffset,
  visibleHeight,
}: MessageListProps): React.ReactElement {
  // Build a window of visible messages based on estimated heights.
  // scrollOffset semantics: 0 = at the newest (bottom); >0 = shifted up.
  const { visibleMessages, startIndex } = useMemo(() => {
    if (messages.length === 0) {
      return { visibleMessages: [] as UIMessage[], startIndex: 0 };
    }
    const termWidth = process.stdout.columns ?? 80;
    const heights = messages.map((m) => estimateMessageHeight(m, termWidth));

    // 1) Base window: fill from the bottom (newest) upward until visibleHeight rows.
    let top = messages.length; // index of first visible message
    let filled = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (filled + heights[i] > visibleHeight) break;
      filled += heights[i];
      top = i;
    }
    // Even if the newest message alone is taller than the view, show it.
    if (top === messages.length) top = messages.length - 1;

    // 2) Apply scroll: move the window up by scrollOffset rows (by height).
    let remaining = scrollOffset;
    while (remaining > 0 && top > 0) {
      remaining -= heights[top - 1];
      top--;
    }

    // 3) Re-fill the window downward from the new top.
    let bottom = top;
    let used = 0;
    for (let i = top; i < messages.length; i++) {
      if (used + heights[i] > visibleHeight) break;
      used += heights[i];
      bottom = i + 1;
    }
    if (bottom <= top) bottom = top + 1; // at least one message

    return { visibleMessages: messages.slice(top, bottom), startIndex: top };
  }, [messages, scrollOffset, visibleHeight]);

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="flex-end" overflow="hidden">
      {visibleMessages.map((msg) => (
        <Box key={msg.id} flexShrink={0} marginY={msg.type === "tool" ? 0 : 1}>
          {msg.type === "user" && (
            <Box flexDirection="column">
              <Text bold color="cyan">
                You
              </Text>
              <Text>{msg.text}</Text>
            </Box>
          )}
          {msg.type === "assistant" && (
            <Box flexDirection="column">
              <Text bold color={msg.isError ? "red" : "white"}>
                {msg.isError ? "Error" : "Tutor"}
              </Text>
              <Text color={msg.isError ? "red" : msg.streaming ? undefined : "gray"}>
                {msg.text}
              </Text>
              {msg.streaming && <Text color="gray">▎</Text>}
            </Box>
          )}
          {msg.type === "tool" && (
            <ToolCard toolName={msg.toolName} args={msg.args} status={msg.status} />
          )}
        </Box>
      ))}
    </Box>
  );
}
