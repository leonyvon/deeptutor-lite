import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { UIMessage } from "./types.js";
import { ToolCard } from "./ToolCard.js";

interface MessageListProps {
  messages: UIMessage[];
  scrollOffset: number;
  visibleHeight: number;
}

function estimateMessageHeight(msg: UIMessage, termWidth: number): number {
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
  // Build a window of visible messages based on estimated heights
  const { visibleMessages, startIndex, endIndex } = useMemo(() => {
    const termWidth = process.stdout.columns ?? 80;
    let consumed = 0;
    let start = 0;
    let end = 0;
    // Walk from the bottom (latest) upward by scrollOffset rows
    let remainingOffset = scrollOffset;
    for (let i = messages.length - 1; i >= 0; i--) {
      const h = estimateMessageHeight(messages[i], termWidth);
      if (remainingOffset > 0) {
        remainingOffset -= h;
        if (remainingOffset <= 0) {
          start = i;
          consumed = -remainingOffset;
        }
        continue;
      }
      if (consumed + h > visibleHeight) {
        end = i + 1;
        break;
      }
      consumed += h;
      start = i;
    }
    if (end === 0) end = messages.length;
    return {
      visibleMessages: messages.slice(start, end),
      startIndex: start,
      endIndex: end,
    };
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
