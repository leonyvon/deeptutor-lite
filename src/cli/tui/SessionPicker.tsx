import React from "react";
import { Box, Text, useInput } from "ink";
import type { JsonlSessionMetadata } from "@earendil-works/pi-agent-core";
import { basename } from "node:path";

interface SessionPickerProps {
  sessions: JsonlSessionMetadata[];
  previews: Record<string, string>;
  selectedIndex: number;
  currentPath: string;
  onSelect: (session: JsonlSessionMetadata) => void;
  onCancel: () => void;
  onChangeIndex: (index: number) => void;
}

export function SessionPicker({
  sessions,
  previews,
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
      width={70}
    >
      <Text bold color="green">
        Select Session
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {sessions.map((s, i) => {
          const name = basename(s.path);
          const preview = previews[s.path] ?? "";
          const isCurrent = s.path === currentPath;
          return (
            <Box key={s.path} flexDirection="row">
              <Text color={i === selectedIndex ? "green" : undefined}>
                {i === selectedIndex ? "> " : "  "}
                {isCurrent ? "▶ " : "  "}
                {name}
              </Text>
              {preview && (
                <Text dimColor>
                  {" "}
                  {preview.length > 40 ? preview.slice(0, 40) + "…" : preview}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · enter select · esc cancel</Text>
      </Box>
    </Box>
  );
}
