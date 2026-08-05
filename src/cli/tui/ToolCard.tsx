import React from "react";
import { Box, Text } from "ink";

interface ToolCardProps {
  toolName: string;
  args: string;
  status: "running" | "success" | "error";
}

export function ToolCard({
  toolName,
  args,
  status,
}: ToolCardProps): React.ReactElement {
  const icon = status === "running" ? "⚙" : status === "success" ? "✓" : "✖";
  const color = status === "running" ? "yellow" : status === "success" ? "green" : "red";
  const label =
    status === "error" ? `${icon} ${toolName} failed` : `${icon} ${toolName}`;

  return (
    <Box marginY={1} paddingX={1} borderStyle="round" borderColor={color}>
      <Text color={color}>{label}</Text>
      {status === "running" && args && (
        <Text dimColor> {args.slice(0, 120)}</Text>
      )}
    </Box>
  );
}
