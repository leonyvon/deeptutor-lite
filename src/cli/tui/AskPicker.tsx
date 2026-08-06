import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { resolveAsk } from "./ask.js";
import { theme } from "./theme.js";

const WINDOW_SIZE = 8;

interface AskPickerProps {
  question: string;
  options: Record<string, string>;
  selectedIndex: number;
  onChangeIndex: (index: number) => void;
}

export function AskPicker({
  question,
  options,
  selectedIndex,
  onChangeIndex,
}: AskPickerProps): React.ReactElement {
  const entries = Object.entries(options);

  // Windowed list: keep the selection visible, cap height at WINDOW_SIZE
  const windowStart = useMemo(() => {
    if (entries.length <= WINDOW_SIZE) return 0;
    return Math.max(0, Math.min(selectedIndex, entries.length - WINDOW_SIZE));
  }, [entries.length, selectedIndex]);

  const visibleEntries = useMemo(
    () => entries.slice(windowStart, windowStart + WINDOW_SIZE),
    [entries, windowStart]
  );

  useInput((input, key) => {
    if (key.upArrow) {
      onChangeIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      onChangeIndex(Math.min(entries.length - 1, selectedIndex + 1));
    } else if (key.return) {
      const [label, text] = entries[selectedIndex];
      resolveAsk(`${label}: ${text}`);
    } else if (key.escape) {
      resolveAsk(null);
    }
  });

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="single"
      borderColor={theme.border}
      marginY={1}
    >
      <Text bold color={theme.accent}>
        {question}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visibleEntries.map(([label, text], i) => {
          const globalIdx = windowStart + i;
          return (
            <Box key={label}>
              <Text color={globalIdx === selectedIndex ? theme.accent : undefined}>
                {globalIdx === selectedIndex ? "> " : "  "}
                {label}) {text}
              </Text>
            </Box>
          );
        })}
        {entries.length > WINDOW_SIZE && (
          <Box marginTop={1}>
            <Text color={theme.textMuted}>
              (showing {visibleEntries.length} of {entries.length})
            </Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.textMuted}>↑↓ navigate · enter select · esc cancel</Text>
      </Box>
    </Box>
  );
}
