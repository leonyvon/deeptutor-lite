import React from "react";
import { Box, Text } from "ink";
import type { DeeptutorRuntime } from "../../agent/harness.js";
import { theme } from "./theme.js";

interface StatusBarProps {
  runtime: DeeptutorRuntime;
  sessionPath: string;
  isProcessing: boolean;
  scrollInfo?: string;
}

export function StatusBar({
  runtime,
  sessionPath,
  isProcessing,
  scrollInfo,
}: StatusBarProps): React.ReactElement {
  const model = runtime.currentModel();
  const kb = runtime.config.kb.defaultKB;

  return (
    <Box
      height={1}
      flexShrink={0}
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={theme.panel}
    >
      <Box flexDirection="row" gap={1}>
        <Text color={theme.accent}>
          {isProcessing ? "⋯" : "✓"} {model.modelName}
        </Text>
        <Text color={theme.textMuted}>@ {model.providerName}</Text>
        <Text color={theme.textMuted}>| KB: {kb}</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        {scrollInfo && <Text color={theme.textMuted}>{scrollInfo}</Text>}
        <Text color={theme.textMuted}>{sessionPath}</Text>
        <Text color={theme.textMuted}>Ctrl+C exit</Text>
      </Box>
    </Box>
  );
}
