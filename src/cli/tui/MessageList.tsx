import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { UIMessage } from "./types.js";
import { ToolCard } from "./ToolCard.js";

interface MessageListProps {
  messages: UIMessage[];
  scrollOffset: number;
  visibleHeight: number;
}

export function estimateMessageHeight(msg: UIMessage, termWidth: number): number {
  const width = Math.max(termWidth - 8, 20);
  let lines = 0;
  if (msg.type === "user") {
    lines = 1 + Math.ceil(msg.text.length / width);
  } else if (msg.type === "assistant") {
    lines = 1 + Math.ceil(msg.text.length / width) + (msg.streaming ? 1 : 0);
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
