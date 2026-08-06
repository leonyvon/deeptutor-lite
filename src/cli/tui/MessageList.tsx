import React, { useMemo, useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { UIMessage } from "./types.js";
import { theme } from "./theme.js";
import { renderMarkdown } from "./markdown.js";
import type { MdSegment } from "./markdown.js";

interface MessageListProps {
  messages: UIMessage[];
  /** 0 = at newest (bottom); >0 = shifted up, in terminal ROWS. */
  scrollOffset: number;
  /** Rows available for the message area. */
  visibleHeight: number;
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
function buildBufferLines(messages: UIMessage[], width: number): BufferLine[] {
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

export function MessageList({
  messages,
  scrollOffset,
  visibleHeight,
}: MessageListProps): React.ReactElement {
  const termWidth = process.stdout.columns ?? 80;
  const contentWidth = Math.max(termWidth - 4, 20);

  // Streaming cursor blink: toggle every 500ms while any assistant message is
  // streaming, so the trailing "▎" flashes instead of staying lit.
  const hasStreaming = messages.some(
    (m) => m.type === "assistant" && m.streaming === true
  );
  const [cursorOn, setCursorOn] = useState(true);
  useEffect(() => {
    if (!hasStreaming) {
      setCursorOn(true);
      return;
    }
    const t = setInterval(() => setCursorOn((v) => !v), 500);
    return () => clearInterval(t);
  }, [hasStreaming]);

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

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {view.map((line) => {
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
              {segs.map((seg, si) => {
                // Blink the streaming cursor: hide the trailing "▎" half the time.
                let text = seg.text;
                if (
                  !cursorOn &&
                  si === segs.length - 1 &&
                  text.endsWith("▎")
                ) {
                  text = text.slice(0, -1);
                }
                return (
                  <Text
                    key={si}
                    color={seg.color}
                    bold={seg.bold}
                    italic={seg.italic}
                  >
                    {text}
                  </Text>
                );
              })}
            </Text>
          ) : line.style === "spacer" ? (
            <Text> </Text>
          ) : line.style === "user-label" ? (
            <Text bold color={theme.primary}>
              You
            </Text>
          ) : line.style === "tutor" ? (
            <Text bold color={theme.accent}>
              Tutor
            </Text>
          ) : line.style === "error" ? (
            <Text bold color={theme.error}>
              {line.text}
            </Text>
          ) : line.style === "tool-running" ? (
            <Text color={theme.warning} wrap="truncate">
              {line.text}
            </Text>
          ) : line.style === "tool-success" ? (
            <Text color={theme.success} wrap="truncate">
              {line.text}
            </Text>
          ) : line.style === "tool-error" ? (
            <Text color={theme.error} wrap="truncate">
              {line.text}
            </Text>
          ) : line.style === "user" ? (
            <Text color={theme.primary} wrap="truncate">
              {line.text}
            </Text>
          ) : line.style === "assistant-streaming" ? (
            <Text wrap="truncate">{line.text}</Text>
          ) : (
            <Text color={theme.text} wrap="truncate">
              {line.text}
            </Text>
          )}
        </Box>
        );
      })}
    </Box>
  );
}
