import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Box, Text, useInput, useStdout, usePaste } from "ink";
import { theme } from "./theme.js";
import { displayWidth } from "./MessageList.js";

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

// ---------------------------------------------------------------------------
// Inline segment model (opencode-style): a paste block is an atomic, inline
// token inside the text flow (a filled rectangle), not a standalone row.
// ---------------------------------------------------------------------------

/** A run of plain text from one part, with its char-offset range. */
export interface SegText {
  kind: "text";
  text: string;
  pi: number;
  offStart: number;
  offEnd: number;
}
/** A paste-block placeholder rendered as a background-filled rectangle. */
export interface SegBlock {
  kind: "block";
  pi: number;
  id: string;
  label: string;
  /** displayWidth of `label` (before padding). */
  width: number;
}
export type Segment = SegText | SegBlock;

/** UI label for a paste block (keeps the line count). */
function blockLabel(lineCount: number): string {
  return `[已粘贴 ${lineCount} 行]`;
}

/** Rendered width of a segment in terminal columns (blocks include paddingX 1×2). */
function segWidth(seg: Segment): number {
  return seg.kind === "text" ? displayWidth(seg.text) : seg.width + 2;
}

/**
 * Pack parts into terminal lines of at most `width` columns — the single
 * source of truth for BOTH rendering and estimateInputLines (so the input-box
 * height never jitters). Text parts wrap char-by-char (CJK display width);
 * blocks are atomic tokens that fit on the current line or wrap to the next.
 * Text segments carry the part char-offset range so the {pi, off} caret maps
 * to an exact row/column; a block occupies one off unit ({0,1}).
 */
export function buildLines(parts: InputPart[], width: number): Segment[][] {
  const lines: Segment[][] = [];
  let cur: Segment[] = [];
  let curW = 0;

  const flush = () => {
    if (cur.length > 0) lines.push(cur);
    cur = [];
    curW = 0;
  };

  parts.forEach((p, pi) => {
    if (p.kind === "block") {
      let label = blockLabel(p.lines);
      // Ultra-narrow terminal fallback (real terminals are wider). The block
      // must fit its label + 2 padding columns on a fresh line.
      if (displayWidth(label) + 2 > width) label = `[${p.lines}]`;
      const seg: SegBlock = {
        kind: "block",
        pi,
        id: p.id,
        label,
        width: displayWidth(label),
      };
      const w = segWidth(seg); // rendered width incl. paddingX 1×2
      if (curW + w > width && cur.length > 0) flush();
      cur.push(seg);
      curW += w;
      return;
    }
    // text part
    if (p.text === "") {
      // Zero-width anchor so the caret can still sit on this (empty) part.
      cur.push({ kind: "text", text: "", pi, offStart: 0, offEnd: 0 });
      return;
    }
    let off = 0;
    let text = p.text;
    while (text.length > 0) {
      const avail = width - curW;
      if (avail <= 0) {
        flush();
        continue;
      }
      let head = "";
      let w = 0;
      for (const ch of text) {
        const cw = displayWidth(ch);
        if (w + cw > avail) break;
        head += ch;
        w += cw;
      }
      if (head === "") {
        // Single char wider than `avail` — force it onto a fresh line.
        flush();
        continue;
      }
      cur.push({ kind: "text", text: head, pi, offStart: off, offEnd: off + head.length });
      off += head.length;
      curW += w;
      text = text.slice(head.length);
      if (text.length > 0) flush();
    }
  });

  flush();
  return lines;
}

/** Exact number of terminal rows the input occupies (blocks are inline). */
export function estimateInputLines(parts: InputPart[], width: number): number {
  return buildLines(parts, width).length;
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

  // ---- Rendering: build the segment line buffer (inline tokens) ----------
  const lines = useMemo(() => buildLines(parts, contentWidth), [
    parts,
    contentWidth,
  ]);

  // Caret {pi, off} -> render line index + column within that line. Text
  // segments map via their char-offset range; a block anchors at its left edge
  // (off 0) or right edge (off 1, after the label + padding).
  const caretLoc = useMemo(() => {
    for (let r = 0; r < lines.length; r++) {
      let col = 0;
      for (const seg of lines[r]) {
        if (seg.pi !== caret.pi) {
          col += segWidth(seg);
          continue;
        }
        if (seg.kind === "text") {
          if (caret.off <= seg.offEnd) {
            const inSeg = Math.max(0, caret.off - seg.offStart);
            return { row: r, col: col + displayWidth(seg.text.slice(0, inSeg)) };
          }
          col += segWidth(seg);
        } else {
          // block: off 0 = before, off 1 = after
          if (caret.off === 0) return { row: r, col };
          return { row: r, col: col + segWidth(seg) };
        }
      }
    }
    // Fallback: end of the last line.
    const last = lines[lines.length - 1];
    if (last) {
      const col = last.reduce((a, s) => a + segWidth(s), 0);
      return { row: lines.length - 1, col };
    }
    return { row: 0, col: 0 };
  }, [lines, caret]);

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

  // ↑/↓ move the caret between render lines. Within a line, the column maps
  // to the nearest char; block segments clamp to their boundaries (off 0/1),
  // never entering inside the placeholder.
  const moveLine = useCallback(
    (dir: -1 | 1) => {
      if (menuOpen) return;
      const targetRow = caretLoc.row + dir;
      if (targetRow < 0 || targetRow >= lines.length) return;
      const target = lines[targetRow];
      const col = caretLoc.col;
      let acc = 0;
      for (const seg of target) {
        const w = segWidth(seg);
        const inSeg = col < acc + w;
        if (seg.kind === "block") {
          if (inSeg) {
            const after = col >= acc + w / 2;
            setCaret({ pi: seg.pi, off: after ? 1 : 0 });
            return;
          }
        } else if (inSeg) {
          const local = Math.max(0, col - acc);
          let t = 0;
          let tw = 0;
          for (const ch of seg.text) {
            const cw = displayWidth(ch);
            if (tw + cw > local) break;
            tw += cw;
            t++;
          }
          setCaret({ pi: seg.pi, off: seg.offStart + t });
          return;
        }
        acc += w;
      }
      // col beyond the line content: end of the last segment.
      const last = target[target.length - 1];
      if (last) {
        setCaret({ pi: last.pi, off: last.kind === "text" ? last.offEnd : 1 });
      }
    },
    [lines, caretLoc, menuOpen]
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
    <Box flexDirection="column" flexShrink={0}>
      {lines.length === 0 ? (
        <Text color={theme.textMuted}>{placeholder ?? ""}</Text>
      ) : (
        lines.map((line, r) => (
          <Box key={r} flexDirection="row" flexShrink={0}>
            {line.map((seg) => {
              if (seg.kind === "block") {
                // Filled rectangle placeholder (opencode style): warning
                // background, dark text, one padding column each side. The
                // ✏️ caret clamps to the boundary (off 0 = left, off 1 = right).
                // The block is an atomic token: it must never be compressed or
                // wrap internally, so flexShrink={0} + wrap="truncate" (an
                // over-wide label truncates at the line end instead).
                const isCaretHere = r === caretLoc.row && seg.pi === caret.pi;
                const caretGlyph =
                  focus && (cursorOn ? (
                    <Text color={theme.accent}>✏️</Text>
                  ) : (
                    <Text>　</Text>
                  ));
                return (
                  <React.Fragment key={seg.id}>
                    {isCaretHere && caret.off === 0 && focus && caretGlyph}
                    <Box backgroundColor={theme.warning} paddingX={1} flexShrink={0}>
                      <Text color={theme.panel} bold wrap="truncate">
                        {seg.label}
                      </Text>
                    </Box>
                    {isCaretHere && caret.off === 1 && focus && caretGlyph}
                  </React.Fragment>
                );
              }
              // text segment
              const isCaretRow = r === caretLoc.row;
              const hasCaret =
                isCaretRow &&
                seg.pi === caret.pi &&
                caret.off >= seg.offStart &&
                caret.off <= seg.offEnd;
              // Masked fields (e.g. API keys) render bullets while the caret
              // and editing still operate on the real text (same char count).
              const displayText = mask ? mask.repeat(seg.text.length) : seg.text;
              const segKey = `${seg.pi}:${seg.offStart}`;
              if (hasCaret) {
                const local = caret.off - seg.offStart;
                if (!focus) {
                  return (
                    <Text key={segKey} wrap="truncate" color={shownText ? undefined : theme.textMuted}>
                      {displayText}
                    </Text>
                  );
                }
                const before = displayText.slice(0, local);
                const rest = displayText.slice(local);
                // Overlay caret (opencode block-cursor style): the ✏️ (or the
                // blink-off 　) REPLACES the next up-to-2 display columns of
                // text (1 CJK char = 2 cols, or 2 half-width chars) instead of
                // being inserted between chars — so the row width stays within
                // buildLines' budget and never pushes the block to a new line.
                // Only at the very end of a row (rest empty) is the glyph
                // appended, where an extra 2 cols is absorbed by the row's
                // slack or clipped by wrap="truncate".
                let cover = 0;
                let cw = 0;
                for (const ch of rest) {
                  const w = displayWidth(ch);
                  if (cw + w > 2) break;
                  cw += w;
                  cover++;
                }
                return (
                  <Text key={segKey} wrap="truncate" color={shownText ? undefined : theme.textMuted}>
                    {before}
                    {cursorOn ? (
                      <Text color={theme.accent}>✏️</Text>
                    ) : (
                      <Text>　</Text>
                    )}
                    {rest.slice(cover)}
                  </Text>
                );
              }
              return (
                <Text key={segKey} wrap="truncate" color={shownText ? undefined : theme.textMuted}>
                  {displayText}
                </Text>
              );
            })}
          </Box>
        ))
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
