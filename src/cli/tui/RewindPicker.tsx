import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { RewindTarget } from "./types.js";
import { theme } from "./theme.js";

const WINDOW_SIZE = 8;

interface RewindPickerProps {
  targets: RewindTarget[];
  selectedIndex: number;
  onSelect: (target: RewindTarget) => void;
  onCancel: () => void;
  onChangeIndex: (index: number) => void;
}

function previewText(text: string): string {
  return text.length > 36 ? text.slice(0, 36) + "…" : text;
}

export function RewindPicker({
  targets,
  selectedIndex,
  onSelect,
  onCancel,
  onChangeIndex,
}: RewindPickerProps): React.ReactElement {
  // Windowed list: keep the selection visible, cap height at WINDOW_SIZE
  const windowStart = useMemo(() => {
    if (targets.length <= WINDOW_SIZE) return 0;
    return Math.max(0, Math.min(selectedIndex, targets.length - WINDOW_SIZE));
  }, [targets.length, selectedIndex]);

  const visibleTargets = useMemo(
    () => targets.slice(windowStart, windowStart + WINDOW_SIZE),
    [targets, windowStart]
  );

  useInput((_input, key) => {
    if (key.upArrow) {
      onChangeIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      onChangeIndex(Math.min(targets.length - 1, selectedIndex + 1));
    } else if (key.return) {
      onSelect(targets[selectedIndex]);
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="single"
      borderColor={theme.border}
      width={70}
    >
      <Text bold color={theme.accent}>
        Rewind to…
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visibleTargets.map((t, i) => {
          const globalIdx = windowStart + i;
          const selected = globalIdx === selectedIndex;
          const roleTag =
            t.role === "user" ? "（你）" : "（AI）";
          return (
            <Box key={t.entryId} flexDirection="row">
              <Text color={selected ? theme.accent : undefined}>
                {selected ? "> " : "  "}
                {globalIdx + 1}. {previewText(t.text)}
              </Text>
              <Text color={theme.textMuted}> {roleTag}</Text>
            </Box>
          );
        })}
        {targets.length > WINDOW_SIZE && (
          <Box marginTop={1}>
            <Text color={theme.textMuted}>
              (showing {visibleTargets.length} of {targets.length})
            </Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.textMuted}>
          ↑↓ navigate · enter rewind · esc cancel
        </Text>
      </Box>
    </Box>
  );
}
