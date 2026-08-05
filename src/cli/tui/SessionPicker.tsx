import React from "react";
import { Box, Text, useInput } from "ink";
import type { JsonlSessionMetadata } from "@earendil-works/pi-agent-core";

interface SessionPickerProps {
  sessions: JsonlSessionMetadata[];
  selectedIndex: number;
  currentPath: string;
  onSelect: (session: JsonlSessionMetadata) => void;
  onCancel: () => void;
  onChangeIndex: (index: number) => void;
}

export function SessionPicker({
  sessions,
  selectedIndex,
  currentPath,
  onSelect,
  onCancel,
  onChangeIndex,
}: SessionPickerProps): React.ReactElement {
  useInput((input, key) => {
    if (key.upArrow) {
      onChangeIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      onChangeIndex(Math.min(sessions.length - 1, selectedIndex + 1));
    } else if (key.return) {
      onSelect(sessions[selectedIndex]);
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="single"
      borderColor="green"
      width={60}
    >
      <Text bold color="green">
        Select Session
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {sessions.map((s, i) => (
          <Box key={s.path}>
            <Text color={i === selectedIndex ? "green" : undefined}>
              {i === selectedIndex ? "> " : "  "}
              {s.path === currentPath ? "▶ " : "  "}
              {s.path}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · enter select · esc cancel</Text>
      </Box>
    </Box>
  );
}
