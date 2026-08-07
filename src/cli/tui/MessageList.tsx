import React, { useMemo, useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { UIMessage } from "./types.js";
import { theme } from "./theme.js";
import { renderMarkdown } from "./markdown.js";
import type { MdSegment } from "./markdown.js";

export interface ScreenSelection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface MessageListProps {
  messages: UIMessage[];
  /** 0 = at newest (bottom); >0 = shifted up, in terminal ROWS. */
  scrollOffset: number;
  /** Rows available for the message area. */
  visibleHeight: number;
  /** App-drawn selection in screen coords (1-based); rows highlighted. */
  selection?: ScreenSelection | null;
}

/** Content column (0-based) of screen column x: 2-col left padding. */
const PAD_COLS = 2;

/**
 * Normalize a screen selection with drag-DIRECTION awareness. Global
 * min/max of x/y is WRONG for reverse drags (bottom-right → top-left):
 * the top row must use the x of the row where the drag STARTED, and the
 * bottom row the x where it ENDED. Returns top/bottom row + their x.
 */
export function normalizeSelection(sel: ScreenSelection): {
  topY: number;
  bottomY: number;
  topX: number;
  bottomX: number;
} {
  const { startY, endY, startX, endX } = sel;
  const topY = Math.min(startY, endY);
  const bottomY = Math.max(startY, endY);
  const topX = startY <= endY ? startX : endX;
  const bottomX = startY <= endY ? endX : startX;
  return { topY, bottomY, topX, bottomX };
}

/** First visible buffer row, mirroring MessageList's window math exactly. */
function viewStartOf(
  linesLength: number,
  scrollOffset: number,
  visibleHeight: number
): number {
  const maxScroll = Math.max(0, linesLength - visibleHeight);
  const offset = Math.min(scrollOffset, maxScroll);
  return Math.max(0, linesLength - visibleHeight - offset);
}

/**
 * Flatten a buffer line into characters with cumulative display columns, so
 * selection ranges (in content columns) can be applied char-by-char.
 */
interface FlattenedChar {
  ch: string;
  seg: MdSegment;
}

function flattenLine(line: BufferLine): { chars: FlattenedChar[]; width: number } {
  const chars: FlattenedChar[] = [];
  let width = 0;
  const segs: MdSegment[] = line.segments ?? [{ text: line.text }];
  for (const seg of segs) {
    for (const ch of seg.text) {
      const w = displayWidth(ch);
      chars.push({ ch, seg });
      width += w;
    }
  }
  return { chars, width };
}

/**
 * Extract the text covered by a screen-coordinate selection from the message
 * row buffer. Rows are joined with "\n"; partial rows are sliced by content
 * columns. Used to copy the selection to the clipboard on mouse-up.
 */
export function extractSelectionText(
  messages: UIMessage[],
  termWidth: number,
  visibleHeight: number,
  scrollOffset: number,
  selection: ScreenSelection
): string {
  const contentWidth = Math.max(termWidth - 4, 20);
  const lines = buildBufferLines(messages, contentWidth);
  const viewStart = viewStartOf(lines.length, scrollOffset, visibleHeight);
  const { topY, bottomY, topX, bottomX } = normalizeSelection(selection);
  const out: string[] = [];
  for (let y = topY; y <= bottomY; y++) {
    if (y < 1 || y > visibleHeight) continue;
    const buf = viewStart + (y - 1);
    if (buf < 0 || buf >= lines.length) continue;
    const { chars } = flattenLine(lines[buf]);
    // Top row starts at the drag-start column; bottom row ends at the
    // drag-end column; middle rows are fully included. For a single row
    // both cuts apply on the same row.
    const colStart =
      y === topY ? Math.max(0, topX - 1 - PAD_COLS) : 0;
    const colEnd =
      y === bottomY
        ? Math.max(0, bottomX - 1 - PAD_COLS)
        : Number.POSITIVE_INFINITY;
    let text = "";
    let col = 0;
    for (const c of chars) {
      const w = displayWidth(c.ch);
      if (col + w > colEnd) break;
      if (col >= colStart) text += c.ch;
      col += w;
    }
    out.push(text);
  }
  return out.join("\n");
}

/** True for East Asian wide/fullwidth/emoji code points (2 terminal columns). */
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals, kana, CJK ideographs, Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // fullwidth signs
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & pictographs
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK extension B–G
  );
}

/**
 * Terminal display width of a string: ASCII/Latin = 1 column, CJK
 * wide/fullwidth/emoji = 2 columns. Deliberately overestimates rare and
 * ambiguous wide-ish ranges (better to reserve one extra row than to
 * truncate content at the bottom of the view).
 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || cp === 0x7f) continue; // control chars render 0 columns
    w += isWideCodePoint(cp) ? 2 : 1;
  }
  return w;
}

/**
 * Number of terminal rows `text` occupies when wrapped at `width` columns.
 * Splits on newlines; every segment is at least one row. Empty string = 1 row.
 */
export function countDisplayLines(text: string, width: number): number {
  if (!text) return 1;
  let lines = 0;
  for (const seg of text.split("\n")) {
    lines += Math.max(1, Math.ceil(displayWidth(seg) / width));
  }
  return lines;
}

/**
 * Exact character-level wrap: splits `text` into terminal rows of at most
 * `width` columns, honouring CJK display width. Each returned line has
 * displayWidth(line) <= width, so rendering it on a fixed-width row never
 * wraps again — the rendered row count matches the buffer exactly.
 * Results are cached per (width, text) so streaming updates only re-wrap
 * the message that changed (same idea as pi-tui's component caches).
 */
const wrapCache = new Map<string, string[]>();

export function wrapToLines(text: string, width: number): string[] {
  const key = `${width}\u0000${text}`;
  const hit = wrapCache.get(key);
  if (hit) return hit;
  const lines: string[] = [];
  for (const seg of text.split("\n")) {
    if (seg === "") {
      lines.push("");
      continue;
    }
    let cur = "";
    let curW = 0;
    for (const ch of seg) {
      const w = displayWidth(ch);
      if (curW + w > width) {
        lines.push(cur);
        cur = ch;
        curW = w;
      } else {
        cur += ch;
        curW += w;
      }
    }
    lines.push(cur);
  }
  wrapCache.set(key, lines);
  return lines;
}

type LineStyle =
  | "user-label"
  | "user"
  | "tutor"
  | "assistant"
  | "assistant-streaming"
  | "error"
  | "tool-running"
  | "tool-success"
  | "tool-error"
  | "spacer";

interface BufferLine {
  key: string;
  style: LineStyle;
  text: string;
  /** Styled markdown fragments; when present they take precedence over `text`. */
  segments?: MdSegment[];
}

/**
 * Flatten the message list into a single precise row buffer (like pi-tui's
 * chat container): every message is wrapped to exact terminal rows, messages
 * are separated by one spacer row, and the streaming cursor is appended to
 * the last row. Height is always exact — no estimation anywhere.
 */

/**
 * Render markdown segments with an app-drawn selection applied. `range`
 * selects content columns [start, end) (0-based, display-width aware);
 * selected characters get the theme selection background while keeping
 * their original color/bold/italic styling. Adjacent chars in the same
 * state are grouped into single <Text> nodes.
 */
function applySelection(
  segments: MdSegment[],
  range: { start: number; end: number } | null
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let group: { seg: MdSegment; text: string; selected: boolean } | null = null;
  let col = 0;

  const flush = () => {
    if (!group) return;
    const { seg, text, selected } = group;
    if (selected && range) {
      nodes.push(
        <Text
          color={seg.color}
          bold={seg.bold}
          italic={seg.italic}
          backgroundColor={theme.selection}
        >
          {text}
        </Text>
      );
    } else {
      nodes.push(
        <Text color={seg.color} bold={seg.bold} italic={seg.italic}>
          {text}
        </Text>
      );
    }
    group = null;
  };

  for (const seg of segments) {
    for (const ch of seg.text) {
      const w = displayWidth(ch);
      const selected = range ? col >= range.start && col < range.end : false;
      if (!group || group.seg !== seg || group.selected !== selected) {
        flush();
        group = { seg, text: "", selected };
      }
      group.text += ch;
      col += w;
    }
  }
  flush();
  return nodes;
}function buildBufferLines(messages: UIMessage[], width: number): BufferLine[] {
  const out: BufferLine[] = [];
  messages.forEach((msg, mi) => {
    if (out.length > 0) {
      out.push({ key: `spacer-${mi}`, style: "spacer", text: "" });
    }
    if (msg.type === "user") {
      out.push({ key: `${mi}-lbl`, style: "user-label", text: "You" });
      for (const ln of wrapToLines(msg.text, width)) {
        out.push({ key: `${mi}-u-${out.length}`, style: "user", text: ln });
      }
    } else if (msg.type === "assistant") {
      const isErr = msg.isError === true;
      out.push({
        key: `${mi}-lbl`,
        style: isErr ? "error" : "tutor",
        text: isErr ? "Error" : "Tutor",
      });
      const bodyStyle: LineStyle = isErr
        ? "error"
        : msg.streaming
          ? "assistant-streaming"
          : "assistant";
      if (isErr) {
        // Errors stay plain text (no markdown interpretation).
        const body = wrapToLines(msg.text, width);
        if (msg.streaming && body.length > 0) body[body.length - 1] += "▎";
        for (const ln of body) {
          out.push({ key: `${mi}-a-${out.length}`, style: bodyStyle, text: ln });
        }
      } else {
        const mdLines = renderMarkdown(msg.text, width);
        for (const [li, line] of mdLines.entries()) {
          let segments = line.segments;
          if (msg.streaming && li === mdLines.length - 1) {
            // Streaming cursor: append to the last fragment of the last row.
            const lastSeg = segments[segments.length - 1];
            segments = lastSeg
              ? segments
                  .slice(0, -1)
                  .concat([{ ...lastSeg, text: lastSeg.text + "▎" }])
              : [{ text: "▎" }];
          }
          out.push({
            key: `${mi}-a-${out.length}`,
            style: bodyStyle,
            text: "",
            segments,
          });
        }
      }
    } else if (msg.type === "tool") {
      const icon =
        msg.status === "running" ? "⚙" : msg.status === "success" ? "✓" : "✖";
      const label =
        msg.status === "error"
          ? `${icon} ${msg.toolName} failed`
          : `${icon} ${msg.toolName}`;
      const text =
        msg.status === "running" && msg.args
          ? `${label} ${msg.args.slice(0, 120)}`
          : label;
      const style: LineStyle =
        msg.status === "running"
          ? "tool-running"
          : msg.status === "success"
            ? "tool-success"
            : "tool-error";
      for (const ln of wrapToLines(text, width)) {
        out.push({ key: `${mi}-t-${out.length}`, style, text: ln });
      }
    }
  });
  return out;
}

/**
 * Total exact row count of the flattened message buffer for `messages`.
 * Used by the App to clamp scrollOffset to a per-row ceiling.
 */
export function totalBufferLines(messages: UIMessage[], termWidth: number): number {
  return buildBufferLines(messages, Math.max(termWidth - 4, 20)).length;
}

/**
 * Synthesize styled segments for a plain (non-markdown) buffer line so every
 * row type flows through the same selection machinery (applySelection).
 * Keeps the exact colors/boldness the plain <Text> branches used before, so
 * the drag-select highlight matches the message list's existing look.
 */
function lineToSegments(line: BufferLine): MdSegment[] {
  switch (line.style) {
    case "user-label":
      return [{ text: "You", color: theme.primary, bold: true }];
    case "tutor":
      return [{ text: "Tutor", color: theme.accent, bold: true }];
    case "user":
      return [{ text: line.text, color: theme.primary }];
    case "error":
      return [{ text: line.text, color: theme.error, bold: true }];
    case "tool-running":
      return [{ text: line.text, color: theme.warning }];
    case "tool-success":
      return [{ text: line.text, color: theme.success }];
    case "tool-error":
      return [{ text: line.text, color: theme.error }];
    case "assistant-streaming":
      return [{ text: line.text, color: undefined }];
    default:
      return [{ text: line.text, color: theme.text }];
  }
}

export function MessageList({
  messages,
  scrollOffset,
  visibleHeight,
  selection,
}: MessageListProps): React.ReactElement {
  const termWidth = process.stdout.columns ?? 80;
  const contentWidth = Math.max(termWidth - 4, 20);

  // NOTE: no blink timer here. A 500ms cursorOn toggle would trigger a full
  // ink re-render every half second while streaming, which in Windows
  // Terminal keeps clearing the mouse text selection — making it impossible
  // to drag-select. The trailing "▎" stays lit; re-renders happen only on
  // delta flushes (content changes), which is what we want.

  const lines = useMemo(
    () => buildBufferLines(messages, contentWidth),
    [messages, contentWidth]
  );

  // Window: rows [start, start+visibleHeight) of the flat buffer.
  // scrollOffset 0 = newest at bottom; scrolling up moves the window start
  // toward row 0 (oldest). Perfectly aligned rows — no partial-message jumps.
  const maxScroll = Math.max(0, lines.length - visibleHeight);
  const offset = Math.min(scrollOffset, maxScroll);
  const start = Math.max(0, lines.length - visibleHeight - offset);
  const view = lines.slice(start, start + visibleHeight);

  // Selection (screen coords, 1-based) normalized to content columns for
  // each visible row. Row content starts at column PAD_COLS+1 on screen.
  // Uses the same direction-aware normalization as extractSelectionText so
  // the highlight always matches what gets copied.
  const sel = useMemo(() => {
    if (!selection) return null;
    return normalizeSelection(selection);
  }, [selection]);

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {view.map((line, i) => {
        const screenY = i + 1;
        let selRange: { start: number; end: number } | null = null;
        if (sel && screenY >= sel.topY && screenY <= sel.bottomY) {
          selRange = {
            start: screenY === sel.topY ? Math.max(0, sel.topX - 1 - PAD_COLS) : 0,
            end: screenY === sel.bottomY ? Math.max(0, sel.bottomX - 1 - PAD_COLS) : Number.POSITIVE_INFINITY,
          };
        }
        const segs = line.segments;
        return (
        <Box
          key={line.key}
          height={1}
          flexShrink={0}
          width={termWidth}
          paddingX={2}
        >
          {segs ? (
            <Text wrap="truncate">
              {applySelection(segs, selRange).map((node, si) => (
                <React.Fragment key={si}>{node}</React.Fragment>
              ))}
            </Text>
          ) : line.style === "spacer" ? (
            <Text> </Text>
          ) : (
            <Text wrap="truncate">
              {applySelection(lineToSegments(line), selRange).map((node, si) => (
                <React.Fragment key={si}>{node}</React.Fragment>
              ))}
            </Text>
          )}
        </Box>
        );
      })}
    </Box>
  );
}
