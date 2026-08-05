import React from "react";
import { Box, Text } from "ink";
import type { DeeptutorRuntime } from "../../agent/harness.js";

interface StatusBarProps {
  runtime: DeeptutorRuntime;
  sessionPath: string;
  isProcessing: boolean;
}

export function StatusBar({
  runtime,
  sessionPath,
  isProcessing,
}: StatusBarProps): React.ReactElement {
  const model = runtime.currentModel();
  const kb = runtime.config.kb.defaultKB;

  return (
    <Box
      height={1}
      flexShrink={0}
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor="black"
    >
      <Box flexDirection="row" gap={1}>
        <Text color="cyan">
          {isProcessing ? "⋯" : "✓"} {model.modelName}
        </Text>
        <Text dimColor>@ {model.providerName}</Text>
        <Text dimColor>| KB: {kb}</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{sessionPath}</Text>
        <Text color="gray">Ctrl+C exit</Text>
      </Box>
    </Box>
  );
}
