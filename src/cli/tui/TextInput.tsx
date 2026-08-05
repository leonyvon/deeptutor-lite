import React from "react";
import { Box, Text, useInput } from "ink";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  mask?: string;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  focus = true,
  mask,
}: TextInputProps): React.ReactElement {
  useInput(
    (input, key) => {
      if (!focus) return;
      if (key.return) {
        onSubmit(value);
      } else if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
      } else if (key.ctrl && input === "c") {
        // Let parent handle Ctrl+C
      } else if (!key.ctrl && !key.meta && input.length > 0) {
        onChange(value + input);
      }
    },
    { isActive: focus }
  );

  const display = mask ? mask.repeat(value.length) : value;

  return (
    <Box>
      <Text color={value ? undefined : "gray"}>{display || placeholder || ""}</Text>
      {focus && <Text color="cyan">▎</Text>}
    </Box>
  );
}
