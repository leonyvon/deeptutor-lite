import React from "react";
import { Box, Text } from "ink";
import { theme } from "./theme.js";

export interface CommandMenuItem {
  name: string;
  desc: string;
}

interface CommandMenuProps {
  commands: CommandMenuItem[];
  selectedIndex: number;
  maxVisible?: number;
}

/**
 * Dropdown palette of slash commands, rendered above the input box.
 * Shows at most `maxVisible` rows; the window scrolls to keep the
 * selection visible.
 */
export function CommandMenu({
  commands,
  selectedIndex,
  maxVisible = 8,
}: CommandMenuProps): React.ReactElement {
  const total = commands.length;
  const visible = Math.min(total, maxVisible);
  const start =
    visible >= total
      ? 0
      : Math.min(Math.max(0, selectedIndex), total - visible);
  const rows = commands.slice(start, start + visible);

  return (
    <Box
      flexDirection="column"
      width={44}
      padding={1}
      borderStyle="single"
      borderColor={theme.borderActive}
      marginBottom={1}
      flexShrink={0}
    >
      {rows.map((cmd, i) => {
        const idx = start + i;
        const isSelected = idx === selectedIndex;
        return (
          <Box key={cmd.name} flexDirection="row">
            <Text color={isSelected ? theme.accent : undefined}>
              {isSelected ? "> " : "  "}
              {cmd.name}
            </Text>
            <Text color={theme.textMuted}> {cmd.desc}</Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color={theme.textMuted}>↑↓ · tab · enter · esc</Text>
      </Box>
    </Box>
  );
}
