import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Box, Text, useInput, useStdout, usePaste } from "ink";
import { theme } from "./theme.js";
import { displayWidth, wrapToLines } from "./MessageList.js";

/**
 * Input content model: the input box is a SEQUENCE of parts — plain text
 * segments and multi-line paste "blocks". Blocks are placeholders inside the
 * input flow (like pasted files in a chat composer): they sit between text
 * segments, the caret can move across them, Backspace deletes them, and any
 * number of them can appear anywhere in the input.
 */
export interface InputPartText {
  kind: "text";
  text: string;
}
export interface InputPartBlock {
  kind: "block";
  id: string;
  text: string;
  lines: number;
}
export type InputPart = InputPartText | InputPartBlock;

/**
 * Join all parts into the full submitted text: text parts concatenate
 * seamlessly; each block is separated from its neighbors by a single "\n"
 * (its own text may already contain multiple lines).
 */
export function mergeParts(parts: InputPart[]): string {
  let out = "";
  parts.forEach((p, i) => {
    if (p.kind === "text") {
      out += p.text;
      return;
    }
    // block: separate from the preceding text/block with a newline
    if (out.length > 0 && !out.endsWith("\n")) out += "\n";
    out += p.text;
    // separate from the following part (if any)
    if (i < parts.length - 1) out += "\n";
  });
  return out;
}

/** Flat text of a parts list (block content included, without separators). */
export function flatPartsText(parts: InputPart[]): string {
  return parts.map((p) => p.text).join("");
}

interface TextInputProps {
  parts: InputPart[];
  onChange: (parts: InputPart[]) => void;
  /** Called with the merged full text (blocks included). */
  onSubmit: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  mask?: string;
  /** Screen anchor for the hidden hardware cursor (IME positioning). */
  screenRow?: number;
  screenColBase?: number;
  /** Pause the caret blink while the user is drag-selecting (SGR mouse). */
  blinkPaused?: boolean;
  /** When a dropdown/menu is open, ↑/↓ belong to it, not the caret. */
  menuOpen?: boolean;
}

export function TextInput({
  parts,
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
  // Caret = (part index, offset within that part). For text parts the offset
  // is a char index; for block parts it is 0 (before the block) or 1 (after).
  const [caret, setCaret] = useState<{ pi: number; off: number }>(() =>
    lastCaret(parts)
  );
  // Blinking pencil caret (only while actively typing, see below).
  const BLINK_IDLE_MS = 10_000;
  const [blinking, setBlinking] = useState(true);
  const [cursorOn, setCursorOn] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinguishes internal edits (keep caret) from external parts changes.
  const internalEdit = useRef(false);

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
    const t = setInterval(() => setCursorOn((v) => !v), 500);
    return () => {
      clearInterval(t);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, blinkPaused]);

  // External parts change (e.g. clear after submit): jump caret to the end.
  useEffect(() => {
    if (internalEdit.current) {
      internalEdit.current = false;
      return;
    }
    setCaret(lastCaret(parts));
  }, [parts]);

  const contentWidth = Math.max((stdout.columns ?? 80) - 4, 10);

  // ---- Rendering: build the row buffer (text rows + block rows) ----------
  interface RenderRow {
    key: string;
    kind: "text" | "block";
    text: string; // text row content, or block label
    pi: number; // originating part index
    offStart: number; // text row: char offset of first char in part
    offEnd: number; // text row: char offset after last char
    blockId?: string;
  }
  const rows = useMemo<RenderRow[]>(() => {
    const out: RenderRow[] = [];
    parts.forEach((p, pi) => {
      if (p.kind === "text") {
        const wrapped = wrapToLines(p.text, contentWidth);
        let acc = 0;
        wrapped.forEach((ln, li) => {
          out.push({
            key: `t-${pi}-${li}`,
            kind: "text",
            text: ln,
            pi,
            offStart: acc,
            offEnd: acc + ln.length,
          });
          acc += ln.length;
        });
      } else {
        out.push({
          key: `b-${p.id}`,
          kind: "block",
          text: `pasted ~${p.lines} lines`,
          pi,
          offStart: 0,
          offEnd: 1,
          blockId: p.id,
        });
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, contentWidth]);

  // Caret -> render row index + column within that row.
  const caretLoc = useMemo(() => {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (row.pi !== caret.pi) continue;
      if (row.kind === "block") {
        if (caret.off === 0) return { row: r, col: 0 };
        // off === 1: after the block — on the next row's start, or this row
        // if it is the last one.
        if (r === rows.length - 1) return { row: r, col: displayWidth(row.text) };
        return { row: r + 1, col: 0 };
      }
      if (caret.off <= row.offEnd) {
        const inRow = Math.max(0, caret.off - row.offStart);
        return { row: r, col: displayWidth(row.text.slice(0, inRow)) };
      }
    }
    // Fallback: end of the last row.
    const last = rows[rows.length - 1];
    return last
      ? { row: rows.length - 1, col: displayWidth(last.text) }
      : { row: 0, col: 0 };
  }, [rows, caret]);

  // ---- Editing helpers -----------------------------------------------------
  const partLen = (p: InputPart): number => (p.kind === "text" ? p.text.length : 1);

  const insertText = useCallback(
    (ch: string) => {
      // Empty input: create the first text part instead of indexing undefined.
      if (parts.length === 0) {
        onChange([{ kind: "text", text: ch }]);
        setCaret({ pi: 0, off: ch.length });
        return;
      }
      const next = [...parts];
      const p = next[caret.pi];
      if (p.kind === "text") {
        next[caret.pi] = {
          kind: "text",
          text: p.text.slice(0, caret.off) + ch + p.text.slice(caret.off),
        };
        setCaret({ pi: caret.pi, off: caret.off + ch.length });
        onChange(next);
        return;
      }
      // Caret sits on a block part (off 0 = before, 1 = after). Prefer
      // merging into an adjacent text part over creating a fragment.
      if (caret.off === 0 && caret.pi > 0) {
        const prev = parts[caret.pi - 1];
        if (prev.kind === "text") {
          next[caret.pi - 1] = { kind: "text", text: prev.text + ch };
          setCaret({ pi: caret.pi - 1, off: prev.text.length + ch.length });
          onChange(next);
          return;
        }
      }
      if (caret.off === 1 && caret.pi < parts.length - 1) {
        const nxt = parts[caret.pi + 1];
        if (nxt.kind === "text") {
          next[caret.pi + 1] = { kind: "text", text: ch + nxt.text };
          setCaret({ pi: caret.pi + 1, off: ch.length });
          onChange(next);
          return;
        }
      }
      // No mergeable neighbor: create a new text part as before.
      const at = caret.pi + (caret.off === 1 ? 1 : 0);
      next.splice(at, 0, { kind: "text", text: ch });
      setCaret({ pi: at, off: ch.length });
      onChange(next);
    },
    [parts, caret, onChange]
  );

  const insertBlock = useCallback(
    (text: string, id: string) => {
      const lines = text.split("\n").length;
      const block: InputPartBlock = { kind: "block", id, text, lines };
      // Empty input: the block becomes the first (only) part.
      if (parts.length === 0) {
        onChange([block]);
        setCaret({ pi: 0, off: 1 });
        return;
      }
      const next = [...parts];
      const p = next[caret.pi];
      if (p.kind === "text") {
        const before = p.text.slice(0, caret.off);
        const after = p.text.slice(caret.off);
        // Skip empty text fragments around the block.
        const repl: InputPart[] = [];
        if (before) repl.push({ kind: "text", text: before });
        repl.push(block);
        if (after) repl.push({ kind: "text", text: after });
        next.splice(caret.pi, 1, ...repl);
        // Caret sits right after the new block. blockIndex accounts for a
        // skipped empty `before` fragment; {pi: blockIndex, off: 1} is safe
        // for lastCaret/backspace/moveCaret even when the block is the last
        // part (off=1 on a trailing block is the "after block" position).
        const blockIndex = caret.pi + (before ? 1 : 0);
        setCaret({ pi: blockIndex, off: 1 });
      } else {
        const at = caret.pi + (caret.off === 1 ? 1 : 0);
        next.splice(at, 0, block);
        setCaret({ pi: at, off: 1 });
      }
      onChange(next);
    },
    [parts, caret, onChange]
  );

  const backspace = useCallback(() => {
    if (parts.length === 0) return; // nothing to delete
    const p = parts[caret.pi];
    if (p.kind === "text" && caret.off > 0) {
      const next = [...parts];
      next[caret.pi] = {
        kind: "text",
        text: p.text.slice(0, caret.off - 1) + p.text.slice(caret.off),
      };
      setCaret({ pi: caret.pi, off: caret.off - 1 });
      onChange(next);
      return;
    }
    if (caret.off === 0 && caret.pi > 0) {
      const prev = parts[caret.pi - 1];
      if (prev.kind === "block") {
        // Delete the whole block before the caret.
        const next = parts.filter((_, i) => i !== caret.pi - 1);
        setCaret({ pi: caret.pi - 1, off: 0 });
        onChange(next);
        return;
      }
      if (prev.text.length > 0) {
        const next = [...parts];
        next[caret.pi - 1] = {
          kind: "text",
          text: prev.text.slice(0, -1),
        };
        setCaret({ pi: caret.pi - 1, off: prev.text.length - 1 });
        onChange(next);
      }
      return;
    }
    if (p.kind === "block" && caret.off === 1) {
      // Delete the block the caret sits right after.
      const next = parts.filter((_, i) => i !== caret.pi);
      setCaret({ pi: Math.max(0, caret.pi), off: 0 });
      onChange(next);
      return;
    }
    // Nothing to delete (start of input).
    if (p.kind === "block" && caret.off === 0 && caret.pi > 0) {
      // Delegate to the previous part handling above by nudging off to 1? No —
      // caret before a block with nothing before it is a no-op.
    }
  }, [parts, caret, onChange]);

  const deleteForward = useCallback(() => {
    if (parts.length === 0) return; // nothing to delete
    const p = parts[caret.pi];
    if (p.kind === "text" && caret.off < p.text.length) {
      const next = [...parts];
      next[caret.pi] = {
        kind: "text",
        text: p.text.slice(0, caret.off) + p.text.slice(caret.off + 1),
      };
      onChange(next);
      return;
    }
    if (caret.off === partLen(p) && caret.pi < parts.length - 1) {
      const nextP = parts[caret.pi + 1];
      if (nextP.kind === "block") {
        onChange(parts.filter((_, i) => i !== caret.pi + 1));
      } else if (nextP.text.length > 0) {
        const next = [...parts];
        next[caret.pi + 1] = { kind: "text", text: nextP.text.slice(1) };
        onChange(next);
      }
    }
  }, [parts, caret, onChange]);

  const moveCaret = useCallback(
    (dir: -1 | 1) => {
      if (parts.length === 0) return; // nothing to move within
      const p = parts[caret.pi];
      const maxOff = partLen(p);
      if (dir === -1) {
        if (caret.off > 0) {
          setCaret({ pi: caret.pi, off: caret.off - 1 });
        } else if (caret.pi > 0) {
          const prev = parts[caret.pi - 1];
          setCaret({ pi: caret.pi - 1, off: partLen(prev) });
        }
      } else {
        if (caret.off < maxOff) {
          setCaret({ pi: caret.pi, off: caret.off + 1 });
        } else if (caret.pi < parts.length - 1) {
          setCaret({ pi: caret.pi + 1, off: 0 });
        }
      }
    },
    [parts, caret]
  );

  // ↑/↓ move the caret between render rows (skipping over blocks as rows).
  const moveLine = useCallback(
    (dir: -1 | 1) => {
      if (menuOpen) return;
      const targetRow = caretLoc.row + dir;
      if (targetRow < 0 || targetRow >= rows.length) return;
      const target = rows[targetRow];
      const col = caretLoc.col;
      if (target.kind === "block") {
        setCaret({ pi: target.pi, off: 0 });
        return;
      }
      // Locate the char in the target text row closest to `col`.
      let t = 0;
      let tw = 0;
      for (const ch of target.text) {
        const w = displayWidth(ch);
        if (tw + w > col) break;
        tw += w;
        t++;
      }
      setCaret({ pi: target.pi, off: target.offStart + t });
    },
    [rows, caretLoc, menuOpen]
  );

  // ---- Input events --------------------------------------------------------
  usePaste(
    (text) => {
      const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (!clean) return;
      if (clean.includes("\n")) {
        insertBlock(clean, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      } else {
        insertText(clean);
      }
    },
    { isActive: focus }
  );

  useInput(
    (input, key) => {
      if (!focus) return;
      if (input.startsWith("[<")) return;
      internalEdit.current = true;

      if (key.return && key.ctrl) {
        insertText("\n");
      } else if (key.return) {
        onSubmit(mergeParts(parts));
      } else if (key.upArrow) {
        moveLine(-1);
      } else if (key.downArrow) {
        moveLine(1);
      } else if (key.leftArrow) {
        moveCaret(-1);
      } else if (key.rightArrow) {
        moveCaret(1);
      } else if (key.home) {
        setCaret({ pi: 0, off: 0 });
      } else if (key.end) {
        setCaret(lastCaret(parts));
      } else if (key.backspace) {
        backspace();
      } else if (key.delete) {
        deleteForward();
      } else if (key.ctrl && input === "c") {
        // Let parent handle Ctrl+C
      } else if (!key.ctrl && !key.meta && input.length > 0) {
        insertText(input);
      }
    },
    { isActive: focus }
  );

  // Hardware-cursor anchoring (hidden) for IME composition positioning.
  const shownText = flatPartsText(parts) || placeholder || "";
  useEffect(() => {
    if (screenRow === undefined) return;
    if (!focus) {
      stdout.write("\x1b[?25l");
      return;
    }
    const row = screenRow + caretLoc.row;
    const col = (screenColBase ?? 1) + caretLoc.col;
    stdout.write(`\x1b[${row};${col}H\x1b[?25l`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretLoc.row, caretLoc.col, focus, screenRow, screenColBase, cursorOn, parts]);

  useEffect(() => {
    return () => {
      if (screenRow !== undefined) stdout.write("\x1b[?25l");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenRow]);

  // ---- Render -------------------------------------------------------------
  return (
    <Box flexDirection="column">
      {rows.length === 0 ? (
        <Text color={theme.textMuted}>{placeholder ?? ""}</Text>
      ) : (
        rows.map((row, r) => {
          const isCaretRow = r === caretLoc.row;
          if (row.kind === "block") {
            return (
              <Box key={row.key} flexShrink={0} backgroundColor={theme.panel} paddingX={1}>
                <Text color={theme.accent} bold>
                  {isCaretRow && focus && cursorOn ? "▎" : ""}
                  {row.text}
                </Text>
              </Box>
            );
          }
          const caretCol = isCaretRow ? caretLoc.col : -1;
          // Column to char offset within the row.
          let ch = 0;
          let w = 0;
          let caretChar = row.text.length;
          for (let i = 0; i < row.text.length; i++) {
            const cw = displayWidth(row.text[i]);
            if (w === caretCol) {
              caretChar = ch;
              break;
            }
            if (w + cw > caretCol) {
              caretChar = ch;
              break;
            }
            w += cw;
            ch++;
          }
          if (caretCol < 0) caretChar = -1;
          // Masked fields (e.g. API keys) render bullets while the caret and
          // editing still operate on the real text (same char count per row).
          const displayText = mask ? mask.repeat(row.text.length) : row.text;
          return (
            <Text key={row.key} wrap="truncate" color={shownText ? undefined : theme.textMuted}>
              {caretChar >= 0 ? (
                <>
                  {displayText.slice(0, caretChar)}
                  {focus &&
                    (cursorOn ? (
                      <Text color={theme.accent}>✏️</Text>
                    ) : (
                      <Text>　</Text>
                    ))}
                  {displayText.slice(caretChar)}
                </>
              ) : (
                displayText
              )}
            </Text>
          );
        })
      )}
    </Box>
  );
}

/** Caret at the end of the input (last part end). */
function lastCaret(parts: InputPart[]): { pi: number; off: number } {
  if (parts.length === 0) return { pi: 0, off: 0 };
  const p = parts[parts.length - 1];
  return { pi: parts.length - 1, off: p.kind === "text" ? p.text.length : 1 };
}
