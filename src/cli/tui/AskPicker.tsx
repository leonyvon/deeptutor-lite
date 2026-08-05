import React from "react";
import { Box, Text, useInput } from "ink";
import { resolveAsk } from "./ask.js";

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
      borderColor="blue"
      marginY={1}
    >
      <Text bold color="blue">
        {question}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {entries.map(([label, text], i) => (
          <Box key={label}>
            <Text color={i === selectedIndex ? "blue" : undefined}>
              {i === selectedIndex ? "> " : "  "}
              {label}) {text}
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
