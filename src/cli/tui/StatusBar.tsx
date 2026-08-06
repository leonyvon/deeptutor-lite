import React from "react";
import { Box, Text } from "ink";
import { basename } from "node:path";
import type { DeeptutorRuntime } from "../../agent/harness.js";
import { theme } from "./theme.js";

interface StatusBarProps {
  runtime: DeeptutorRuntime;
  sessionPath: string;
  isProcessing: boolean;
  scrollInfo?: string;
}

/**
 * Session file names look like `2026-08-05T13-32-35-764Z_019f.jsonl`
 * (UTC timestamp with `-` separators + random suffix, pi convention).
 * Render just the session name as local time: `08-05 21:32 · 019f`.
 */
function formatSessionName(p: string): string {
  if (!p) return "";
  const base = basename(p).replace(/\.jsonl$/i, "");
  const m = base.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:_(.*))?$/
  );
  if (!m) return base; // non-pi session name: show as-is
  const [, date, hh, mm, ss, ms, suffix] = m;
  const d = new Date(`${date}T${hh}:${mm}:${ss}.${ms}Z`);
  if (Number.isNaN(d.getTime())) return base;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}${
    suffix ? ` · ${suffix}` : ""
  }`;
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
        <Text bold color={theme.accent} backgroundColor={theme.panel}>
          [Tutor]
        </Text>
        <Text color={theme.textMuted}>@ {model.providerName}</Text>
        <Text color={theme.textMuted}>| KB: {kb}</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        <Text color={theme.text}>
          {isProcessing ? "⋯" : "✓"} {model.modelName}
        </Text>
        {scrollInfo && <Text color={theme.textMuted}>{scrollInfo}</Text>}
        {sessionPath && (
          <Text color={theme.textMuted}>{formatSessionName(sessionPath)}</Text>
        )}
        <Text color={theme.textMuted}>Ctrl+C exit</Text>
      </Box>
    </Box>
  );
}
