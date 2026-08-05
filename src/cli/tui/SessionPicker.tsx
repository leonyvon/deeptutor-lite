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

function parseSessionTime(path: string): string | undefined {
  const base = basename(path);
  const m = base.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
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
          const rawPreview = previews[s.path];
          const hasPreview = rawPreview && rawPreview.trim().length > 0;
          const preview = hasPreview ? rawPreview : "（空会话）";
          const time = parseSessionTime(s.path);
          const isCurrent = s.path === currentPath;
          const mainText =
            preview.length > 36 ? preview.slice(0, 36) + "…" : preview;
          return (
            <Box key={s.path} flexDirection="row">
              <Text color={i === selectedIndex ? "green" : undefined}>
                {i === selectedIndex ? "> " : "  "}
                {isCurrent ? "▶ " : "  "}
                {mainText}
              </Text>
              {time && (
                <Text dimColor>
                  {" "}
                  {time}
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
