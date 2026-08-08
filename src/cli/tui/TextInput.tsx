import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Box, Text, useInput, useStdout, usePaste, useCursor } from "ink";
import { theme } from "./theme.js";
import { displayWidth, normalizeSelection } from "./MessageList.js";
import type { ScreenSelection } from "./MessageList.js";

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
    let head = "";
    let headW = 0;
    for (const ch of p.text) {
      if (ch === "\n") {
        // HARD break: emit the pending head, then close the current line even
        // if empty (matches wrapToLines: a newline always terminates a row, so
        // "a\n" is two rows — "a" plus an empty row).
        if (head !== "") {
          cur.push({
            kind: "text",
            text: head,
            pi,
            offStart: off - head.length,
            offEnd: off,
          });
          curW += headW;
          head = "";
          headW = 0;
        }
        lines.push(cur);
        cur = [];
        curW = 0;
        off++; // "\n" consumes one char offset (caret can sit on either side)
        // Zero-width anchor on the new row so the caret can sit on an empty
        // line (e.g. a trailing newline); renders as nothing.
        cur.push({ kind: "text", text: "", pi, offStart: off, offEnd: off });
        continue;
      }
      const cw = displayWidth(ch);
      if (curW + headW + cw > width && (head !== "" || cur.length > 0)) {
        // SOFT width wrap: emit the head and close the line, then continue
        // on a fresh row with this char.
        if (head !== "") {
          cur.push({
            kind: "text",
            text: head,
            pi,
            offStart: off - head.length,
            offEnd: off,
          });
          curW += headW;
          head = "";
          headW = 0;
        }
        flush();
      }
      head += ch;
      headW += cw;
      off++;
    }
    if (head !== "") {
      cur.push({ kind: "text", text: head, pi, offStart: off - head.length, offEnd: off });
      curW += headW;
    }
  });

  flush();
  return lines;
}

/** Exact number of terminal rows the input occupies (blocks are inline). */
export function estimateInputLines(parts: InputPart[], width: number): number {
  return buildLines(parts, width).length;
}

/**
 * Group `text` chars into selected/unselected runs for the selection range
 * [start, end) of content columns, starting at `offset`. Mirror of
 * MessageList's applySelection grouping (selected runs get the selection
 * background while keeping the base color). Returns one <Text> node per run.
 */
function applyInputSelection(
  text: string,
  offset: number,
  range: { start: number; end: number } | null,
  color: string | undefined
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let group: { text: string; selected: boolean } | null = null;
  let col = offset;
  let key = 0;
  const flush = () => {
    if (!group) return;
    if (group.selected && range) {
      nodes.push(
        <React.Fragment key={key++}>
          <Text color={color} backgroundColor={theme.selection}>
            {group.text}
          </Text>
        </React.Fragment>
      );
    } else {
      nodes.push(
        <React.Fragment key={key++}>
          <Text color={color}>{group.text}</Text>
        </React.Fragment>
      );
    }
    group = null;
  };
  for (const ch of text) {
    const w = displayWidth(ch);
    const selected = range ? col >= range.start && col < range.end : false;
    if (!group || group.selected !== selected) {
      flush();
      group = { text: "", selected };
    }
    group.text += ch;
    col += w;
  }
  flush();
  return nodes;
}

/**
 * Extract the text covered by a screen-coordinate selection from the input
 * box. Rows outside the input's content rows contribute nothing; selected
 * rows are sliced by content columns and joined with "\n". Block segments
 * contribute their label chars; the 2 padding columns are never copied.
 *
 * viewTop/maxLines describe the rendered window (see TextInput's maxLines):
 * screen row y maps to buffer line viewTop + (y - screenRow); only the
 * windowed lines are visible on screen, so rows outside it yield nothing.
 */
export function extractInputSelectionText(
  parts: InputPart[],
  width: number,
  screenRow: number,
  screenColBase: number,
  selection: ScreenSelection,
  viewTop = 0,
  maxLines = Number.POSITIVE_INFINITY
): string {
  const lines = buildLines(parts, width);
  const { topY, bottomY, topX, bottomX } = normalizeSelection(selection);
  const windowCount = Math.min(lines.length, maxLines);
  const lastRow = screenRow + windowCount - 1;
  const out: string[] = [];
  for (let y = topY; y <= bottomY; y++) {
    if (y < screenRow || y > lastRow) continue;
    const line = lines[viewTop + (y - screenRow)];
    if (!line) continue;
    const colStart = y === topY ? Math.max(0, topX - screenColBase) : 0;
    const colEnd =
      y === bottomY
        ? Math.max(0, bottomX - screenColBase)
        : Number.POSITIVE_INFINITY;
    let text = "";
    let col = 0;
    outer: for (const seg of line) {
      const chars = seg.kind === "text" ? seg.text : seg.label;
      for (const ch of chars) {
        const w = displayWidth(ch);
        if (col + w > colEnd) break outer;
        if (col >= colStart) text += ch;
        col += w;
      }
      if (seg.kind === "block") col += 2; // paddingX 1×2
    }
    out.push(text);
  }
  return out.join("\n");
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
  /** App-drawn selection in screen coords (1-based); highlighted inline. */
  selection?: ScreenSelection | null;
  /**
   * Max CONTENT lines rendered (windowed scroll): when the wrapped input
   * exceeds this, the box keeps this height and scrolls internally, always
   * keeping the caret line visible. Undefined = no cap (grow unbounded).
   */
  maxLines?: number;
  /**
   * Receives the current window's first buffer line index (0 when not
   * windowed). The parent uses it to map screen rows back to buffer lines
   * for selection extraction (extractInputSelectionText).
   */
  viewportRef?: React.MutableRefObject<number>;
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
  selection,
  maxLines,
  viewportRef,
}: TextInputProps): React.ReactElement {
  const { stdout } = useStdout();
  // ink's cursor API: publish the input caret position so ink accounts for it
  // in its redraw math and positions the (hidden) hardware cursor for IME.
  const { setCursorPosition } = useCursor();
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

  // Normalized selection (drag-direction aware); column math is input-box
  // specific (content col 0 = 1-based screen col screenColBase).
  const sel = useMemo(
    () => (selection ? normalizeSelection(selection) : null),
    [selection]
  );

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

  // Windowed rendering: when the wrapped input exceeds `maxLines` content
  // rows, only a window of maxLines rows is rendered and the box scrolls
  // internally, always keeping the caret row visible (caret row ends up at
  // the window's LAST line; scrolling up is done by moving the caret). The
  // first rendered row of the window is exposed via viewportRef so the
  // parent can map screen rows back to buffer lines (selection extraction).
  const viewTop = useMemo(() => {
    if (!maxLines || lines.length <= maxLines) return 0;
    return Math.max(0, Math.min(caretLoc.row - (maxLines - 1), lines.length - maxLines));
  }, [lines.length, maxLines, caretLoc.row]);

  useEffect(() => {
    if (viewportRef) viewportRef.current = viewTop;
  }, [viewTop, viewportRef]);

  // Rendered window: buffer rows [viewTop, viewTop + windowCount).
  const windowLines = useMemo(
    () => (maxLines && lines.length > maxLines ? lines.slice(viewTop, viewTop + maxLines) : lines),
    [lines, maxLines, viewTop]
  );

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

  const shownText = flatPartsText(parts) || placeholder || "";

  // Publish the input caret position to ink's cursor API (IME support): ink
  // tracks this position across frames and accounts for it in its redraw math
  // (no desync — unlike raw CUP escapes appended after writes). Coordinates
  // are 0-based relative to the ink output origin; screenRow/screenColBase
  // are 1-based screen coords, so subtract 1. index.ts re-hides the cursor
  // after every write (the ✏️ is our visible caret).
  //
  // ink #982 (vadimdemedes/ink, merged to master 2026-08-03, NOT in any
  // release; latest = 7.1.1): in fullscreen frames (no trailing newline —
  // this App ALWAYS renders one, root <Box height={rows}> in the alternate
  // screen), buildCursorSuffix computes moveUp = visibleLineCount - y while
  // the real cursor sits on the LAST line (visibleLineCount - 1), so the
  // emitted cursorUp is 1 too large and the hardware cursor lands one row
  // ABOVE the requested y — the IME composition window (pinyin pre-edit)
  // follows it one row too high. Compensation: publish y+1 (equivalent to
  // #982's bottomLine fix; valid only while the frame never ends in \n).
  // If ink ships a release with #982, revert y to `row - 1`.
  useEffect(() => {
    if (screenRow === undefined || !focus) {
      setCursorPosition(undefined);
      return;
    }
    const row = screenRow + caretLoc.row - viewTop;
    const col = (screenColBase ?? 1) + caretLoc.col;
    setCursorPosition({ x: col - 1, y: row });
  }, [caretLoc.row, caretLoc.col, focus, screenRow, screenColBase, setCursorPosition, viewTop]);

  // ---- Render -------------------------------------------------------------
  return (
    <Box flexDirection="column" flexShrink={0}>
      {lines.length === 0 ? (
        <Text color={theme.textMuted}>{placeholder ?? ""}</Text>
      ) : (
        windowLines.map((line, r) => {
          // Screen row of this content line (1-based): the input box's first
          // content row is `screenRow` (App passes rows - inputAreaHeight), so
          // window line 0 sits at screen row screenRow, line r at screenRow+r
          // (same convention as the hardware-cursor anchor `screenRow +
          // caretLoc.row - viewTop`).
          const bufRow = viewTop + r;
          const y = (screenRow ?? 0) + r;
          // Content col 0 sits at 1-based screen col screenColBase (App: 5),
          // so content col = x - screenColBase (input box has its own padding
          // math — do NOT reuse the message area's PAD_COLS).
          let selRange: { start: number; end: number } | null = null;
          if (sel && screenRow !== undefined && y >= sel.topY && y <= sel.bottomY) {
            selRange = {
              start:
                y === sel.topY
                  ? Math.max(0, sel.topX - (screenColBase ?? 1))
                  : 0,
              end:
                y === sel.bottomY
                  ? Math.max(0, sel.bottomX - (screenColBase ?? 1))
                  : Number.POSITIVE_INFINITY,
            };
          }
          let lineCol = 0;
          // height={1} guarantees every buildLines row (including empty rows
          // produced by hard newlines) occupies exactly one terminal line, so
          // the rendered height always matches estimateInputLines.
          return (
          <Box key={r} flexDirection="row" flexShrink={0} height={1}>
            {line.map((seg) => {
              const segStart = lineCol;
              lineCol += segWidth(seg);
              if (seg.kind === "block") {
                // Filled rectangle placeholder (opencode style): warning
                // background, dark text, one padding column each side. The
                // ✏️ caret clamps to the boundary (off 0 = left, off 1 = right).
                // The block is an atomic token: it must never be compressed or
                // wrap internally, so flexShrink={0} + wrap="truncate" (an
                // over-wide label truncates at the line end instead).
                const isCaretHere = bufRow === caretLoc.row && seg.pi === caret.pi;
                const caretGlyph =
                  focus && (cursorOn ? (
                    <Text color={theme.accent}>✏️</Text>
                  ) : (
                    <Text>　</Text>
                  ));
                // Whole-block highlight on any column overlap is the intended
                // approximation (the block is an atomic filled rectangle).
                const blockSelected =
                  selRange !== null &&
                  segStart < selRange.end &&
                  segStart + segWidth(seg) > selRange.start;
                return (
                  <React.Fragment key={seg.id}>
                    {isCaretHere && caret.off === 0 && focus && caretGlyph}
                    <Box
                      backgroundColor={blockSelected ? theme.selection : theme.warning}
                      paddingX={1}
                      flexShrink={0}
                    >
                      <Text color={theme.panel} bold wrap="truncate">
                        {seg.label}
                      </Text>
                    </Box>
                    {isCaretHere && caret.off === 1 && focus && caretGlyph}
                  </React.Fragment>
                );
              }
              // text segment
              const isCaretRow = bufRow === caretLoc.row;
              const hasCaret =
                isCaretRow &&
                seg.pi === caret.pi &&
                caret.off >= seg.offStart &&
                caret.off <= seg.offEnd;
              // Masked fields (e.g. API keys) render bullets while the caret
              // and editing still operate on the real text (same char count).
              const displayText = mask ? mask.repeat(seg.text.length) : seg.text;
              // Unique per line: includes offEnd so the zero-width anchor
              // (offStart == offEnd) never collides with the following segment.
              const segKey = `${seg.pi}:${seg.offStart}:${seg.offEnd}`;
              const inputColor = shownText ? undefined : theme.textMuted;
              if (hasCaret) {
                const local = caret.off - seg.offStart;
                if (!focus) {
                  return (
                    <Text key={segKey} wrap="truncate">
                      {applyInputSelection(displayText, segStart, selRange, inputColor)}
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
                // The glyph OVERLAYS the covered chars (no layout shift): text
                // after it starts at column width(before) + width(covered).
                return (
                  <Text key={segKey} wrap="truncate">
                    {applyInputSelection(before, segStart, selRange, inputColor)}
                    {cursorOn ? (
                      <Text color={theme.accent}>✏️</Text>
                    ) : (
                      <Text>　</Text>
                    )}
                    {applyInputSelection(
                      rest.slice(cover),
                      segStart + displayWidth(before) + cw,
                      selRange,
                      inputColor
                    )}
                  </Text>
                );
              }
              return (
                <Text key={segKey} wrap="truncate">
                  {applyInputSelection(displayText, segStart, selRange, inputColor)}
                </Text>
              );
            })}
          </Box>
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
