import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useInput, useStdout, usePaste } from "ink";
import { theme } from "./theme.js";
import { displayWidth, wrapToLines } from "./MessageList.js";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  mask?: string;
  /**
   * Screen position (1-based row/col) of this input's first text column.
   * When provided and focused, the real terminal hardware cursor is moved
   * here and shown instead of the self-drawn ▎ — Windows Terminal then
   * anchors the IME composition window (pinyin pre-edit) to the input box.
   */
  screenRow?: number;
  screenColBase?: number;
  /** Pause the caret blink while the user is drag-selecting (SGR mouse). */
  blinkPaused?: boolean;
  /** When a dropdown/menu is open, ↑/↓ belong to it, not the caret. */
  menuOpen?: boolean;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  focus = true,
  mask,
  screenRow,
  screenColBase,
  blinkPaused = false,
  menuOpen = false,
}: TextInputProps): React.ReactElement {
  const { stdout } = useStdout();
  // Cursor position in characters within `value` (0..value.length).
  const [cursor, setCursor] = useState(value.length);
  // Blinking pencil caret. CRITICAL constraint: any periodic re-render writes
  // to the terminal and Windows Terminal CLEARS the mouse text selection on
  // every write — so a blink that runs forever makes drag-select impossible.
  // Solution: blink only while the user is actively typing; after
  // BLINK_IDLE_MS of inactivity the caret goes solid (✏️). Typing and
  // selecting never overlap, so both work.
  const BLINK_IDLE_MS = 10_000;
  const [blinking, setBlinking] = useState(true);
  const [cursorOn, setCursorOn] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinguishes internal edits (keep cursor) from external value changes
  // like Tab-completion (jump cursor to end).
  const internalEdit = useRef(false);

  // Restart blink on any input activity; stop blinking after idle timeout.
  const pokeBlink = useCallback(() => {
    setBlinking(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setBlinking(false), BLINK_IDLE_MS);
  }, []);

  useEffect(() => {
    if (!focus || blinkPaused) {
      setBlinking(false);
      setCursorOn(true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }
    pokeBlink();
    const t = setInterval(() => {
      setCursorOn((v) => !v);
    }, 500);
    return () => {
      clearInterval(t);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, blinkPaused]);

  useEffect(() => {
    if (internalEdit.current) {
      internalEdit.current = false;
      return;
    }
    setCursor(value.length);
  }, [value]);

  // Hardware-cursor anchoring: move the real terminal cursor to the input
  // box's text caret but keep it HIDDEN — the self-drawn ▎ is the visible
  // caret. Windows Terminal positions the IME composition window (pinyin
  // pre-edit) at the hardware cursor's location, so anchoring it here makes
  // the pinyin show inside the input box instead of at the last written row
  // (bottom right), while the visible caret stays pixel-accurate (flexbox).
  const display = mask ? mask.repeat(value.length) : value;
  const shown = display || placeholder || "";
  const contentWidth = Math.max((stdout.columns ?? 80) - 4, 10);

  useEffect(() => {
    if (screenRow === undefined) return;
    if (!focus) {
      stdout.write("\x1b[?25l");
      return;
    }
    const prefixLines = wrapToLines(shown.slice(0, cursor), contentWidth);
    const lineOffset = Math.max(0, prefixLines.length - 1);
    const colOffset = displayWidth(prefixLines[prefixLines.length - 1] ?? "");
    const row = screenRow + lineOffset;
    const col = (screenColBase ?? 1) + colOffset;
    stdout.write(`\x1b[${row};${col}H\x1b[?25l`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, focus, value, screenRow, screenColBase, cursorOn]);

  // Keep the hardware cursor hidden when this input unmounts (e.g. switching
  // to a picker mode) so it can't linger at the last written row.
  useEffect(() => {
    return () => {
      if (screenRow !== undefined) stdout.write("\x1b[?25l");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenRow]);

  // Paste handling via ink's official usePaste channel. CRITICAL: ink's
  // input-parser STRIPS the [200~/[201~ bracketed-paste markers and emits a
  // dedicated "paste" event; if no component listens (usePaste), ink falls
  // back to forwarding the raw pasted text (with \r newlines) into useInput
  // — which is why marker-scanning inside useInput never worked. usePaste
  // receives the whole pasted string on its own channel.
  usePaste(
    (text) => {
      // Windows Terminal normalizes pasted newlines to \r; restore \n for
      // display/editing consistency.
      const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (!clean) return;
      onChange(value.slice(0, cursor) + clean + value.slice(cursor));
      setCursor((c) => c + clean.length);
    },
    { isActive: focus }
  );

  // ↑/↓: move the caret across wrapped lines. When a menu/dropdown is open
  // the arrows belong to the menu (menuOpen), not the caret.
  const moveLine = useCallback(
    (dir: 1 | -1) => {
      if (menuOpen) return;
      const lines = wrapToLines(shown, contentWidth);
      if (lines.length <= 1) return;
      // Locate the caret's current line & column (display width).
      let lineIdx = 0;
      let acc = 0;
      for (let i = 0; i < lines.length; i++) {
        if (acc + lines[i].length > cursor) {
          lineIdx = i;
          break;
        }
        acc += lines[i].length;
      }
      const target = lineIdx + dir;
      if (target < 0 || target >= lines.length) return;
      const inLine = cursor - acc;
      const col = displayWidth(lines[lineIdx].slice(0, inLine));
      // Find the character in the target line closest to `col`.
      const targetStart = lines
        .slice(0, target)
        .reduce((s, l) => s + l.length, 0);
      let t = 0;
      let tw = 0;
      for (const ch of lines[target]) {
        const w = displayWidth(ch);
        if (tw + w > col) break;
        tw += w;
        t++;
      }
      setCursor(targetStart + t);
    },
    [shown, contentWidth, cursor, menuOpen]
  );

  useInput(
    (input, key) => {
      if (!focus) return;
      // SGR mouse sequences (ESC[<...M/m) arrive here as plain text after
      // ink strips the ESC; they belong to the App's mouse handler, never
      // to the input value.
      if (input.startsWith("[<")) return;

      internalEdit.current = true;

      // Shift+Enter inserts a newline; plain Enter submits. (Ink reports
      // Shift+Enter as key.return + key.shift on CSI-u terminals.)
      if (key.return && key.shift) {
        onChange(value.slice(0, cursor) + "\n" + value.slice(cursor));
        setCursor((c) => c + 1);
      } else if (key.return) {
        onSubmit(value);
      } else if (key.upArrow) {
        moveLine(-1);
      } else if (key.downArrow) {
        moveLine(1);
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

  // Render as a row buffer: pre-wrap the content with our CJK-aware
  // wrapToLines and render each row separately. CRITICAL: ink's Text
  // wrapping is word-level (splits on spaces) — a long CJK line without
  // spaces is treated as one giant word and NEVER wraps, overflowing the
  // input box. Our wrapToLines is character-level (display-width aware),
  // so estimated rows (App's countDisplayLines) and rendered rows match.
  const lines = wrapToLines(shown, contentWidth);
  // Locate the caret: walk rows accumulating char counts until we reach
  // `cursor` (character index into `shown`).
  let caretLine = lines.length - 1;
  let caretCol = lines[caretLine].length;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    if (acc + lines[i].length > cursor) {
      caretLine = i;
      caretCol = cursor - acc;
      break;
    }
    acc += lines[i].length;
  }

  return (
    <Box flexDirection="column">
      {lines.map((ln, i) => (
        <Text key={i} wrap="truncate" color={value ? undefined : theme.textMuted}>
          {i === caretLine ? (
            <>
              {ln.slice(0, caretCol)}
              {focus &&
                (cursorOn ? (
                  <Text color={theme.accent}>✏️</Text>
                ) : (
                  // Full-width space keeps the caret column width (2) stable
                  // so the text after it never shifts while blinking.
                  <Text>　</Text>
                ))}
              {ln.slice(caretCol)}
            </>
          ) : (
            ln
          )}
        </Text>
      ))}
    </Box>
  );
}
