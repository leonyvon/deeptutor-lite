import React, { useState, useEffect, useRef } from "react";
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
  // Cursor position in characters within `value` (0..value.length).
  const [cursor, setCursor] = useState(value.length);
  // Distinguishes internal edits (keep cursor) from external value changes
  // like Tab-completion (jump cursor to end).
  const internalEdit = useRef(false);

  useEffect(() => {
    if (internalEdit.current) {
      internalEdit.current = false;
      return;
    }
    setCursor(value.length);
  }, [value]);

  useInput(
    (input, key) => {
      if (!focus) return;
      internalEdit.current = true;

      if (key.return) {
        onSubmit(value);
      } else if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1));
      } else if (key.rightArrow) {
        setCursor((c) => Math.min(value.length, c + 1));
      } else if (key.home) {
        setCursor(0);
      } else if (key.end) {
        setCursor(value.length);
      } else if (key.backspace) {
        if (cursor > 0) {
          onChange(value.slice(0, cursor - 1) + value.slice(cursor));
          setCursor((c) => Math.max(0, c - 1));
        }
      } else if (key.delete) {
        if (cursor < value.length) {
          onChange(value.slice(0, cursor) + value.slice(cursor + 1));
        }
      } else if (key.ctrl && input === "c") {
        // Let parent handle Ctrl+C
      } else if (!key.ctrl && !key.meta && input.length > 0) {
        onChange(value.slice(0, cursor) + input + value.slice(cursor));
        setCursor((c) => c + input.length);
      }
    },
    { isActive: focus }
  );

  const display = mask ? mask.repeat(value.length) : value;
  const shown = display || placeholder || "";

  return (
    <Box>
      <Text color={value ? undefined : "gray"}>
        {shown.slice(0, cursor)}
        {focus && <Text color="cyan">▎</Text>}
        {shown.slice(cursor)}
      </Text>
    </Box>
  );
}
