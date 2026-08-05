import React from "react";
import { Box, Text } from "ink";
import type { UIMessage } from "./types.js";
import { ToolCard } from "./ToolCard.js";

interface MessageListProps {
  messages: UIMessage[];
}

export function MessageList({ messages }: MessageListProps): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="flex-end" overflow="hidden">
      {messages.map((msg) => (
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
              <Text bold color="white">
                Assistant
              </Text>
              <Text color={msg.streaming ? undefined : "gray"}>{msg.text}</Text>
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
