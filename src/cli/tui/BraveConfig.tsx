import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DeeptutorRuntime } from "../../agent/harness.js";

interface BraveConfigProps {
  runtime: DeeptutorRuntime;
  selectedIndex: number;
  onSave: () => void;
  onCancel: () => void;
  onChangeIndex: (index: number) => void;
}

const FIELDS = [
  { key: "apiKey", label: "API Key", secret: true },
  { key: "proxy", label: "Proxy URL", secret: false },
  { key: "maxResults", label: "Max Results", secret: false },
] as const;

export function BraveConfig({
  runtime,
  selectedIndex,
  onSave,
  onCancel,
  onChangeIndex,
}: BraveConfigProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const cfg = runtime.config.search;
  const values = {
    apiKey: cfg.apiKey ?? "",
    proxy: cfg.proxy ?? "",
    maxResults: String(cfg.maxResults ?? 5),
  };

  useInput((input, key) => {
    if (editing) {
      if (key.return) {
        const field = FIELDS[selectedIndex];
        const patch: { apiKey?: string; proxy?: string; maxResults?: number } =
          {};
        if (field.key === "apiKey") patch.apiKey = editValue;
        if (field.key === "proxy") patch.proxy = editValue;
        if (field.key === "maxResults")
          patch.maxResults = Number(editValue) || 5;
        runtime
          .updateSearch(patch)
          .then(() => {
            setEditing(false);
            setEditValue("");
            onSave();
          })
          .catch(() => {
            setEditing(false);
            onCancel();
          });
      } else if (key.escape) {
        setEditing(false);
        setEditValue("");
      } else if (key.backspace || key.delete) {
        setEditValue((v) => v.slice(0, -1));
      } else if (!key.ctrl && !key.meta && input.length > 0) {
        setEditValue((v) => v + input);
      }
      return;
    }

    if (key.upArrow) {
      onChangeIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      onChangeIndex(Math.min(FIELDS.length - 1, selectedIndex + 1));
    } else if (key.return) {
      const field = FIELDS[selectedIndex];
      setEditValue(values[field.key]);
      setEditing(true);
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="single"
      borderColor="yellow"
      width={60}
    >
      <Text bold color="yellow">
        Brave Search Configuration
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {FIELDS.map((field, i) => (
          <Box key={i}>
            <Text color={i === selectedIndex ? "yellow" : undefined}>
              {i === selectedIndex ? "> " : "  "}
              {field.label}:{" "}
              {editing && i === selectedIndex
                ? (field.secret
                    ? "•".repeat(editValue.length)
                    : editValue) + "▎"
                : field.secret
                  ? values[field.key]
                    ? "••••••"
                    : "(not set)"
                  : values[field.key] || "(not set)"}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {editing
            ? "enter save · esc cancel"
            : "↑↓ navigate · enter edit · esc finish"}
        </Text>
      </Box>
    </Box>
  );
}
