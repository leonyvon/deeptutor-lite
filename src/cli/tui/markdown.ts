/**
 * Markdown renderer for assistant messages.
 *
 * Produces an exact row buffer compatible with MessageList's flat-buffer
 * architecture: every returned MdLine is guaranteed to have
 * displayWidth(plain text) <= `width`, and each MdSegment carries its own
 * style (theme token / bold / italic). This lets the row buffer render styled
 * fragments per terminal row without ever re-wrapping, keeping the scroll
 * window perfectly aligned. Never emits ANSI escape codes.
 */
import { Marked } from "marked";
import type { Token, Tokens } from "marked";
import { displayWidth } from "./MessageList.js";
import { theme } from "./theme.js";

export interface MdSegment {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface MdLine {
  segments: MdSegment[];
}

const marked = new Marked({ gfm: true });

// Per (width, text) cache so streaming updates only re-render the message
// that changed (same pattern as MessageList's wrapCache).
const cache = new Map<string, MdLine[]>();

interface Style {
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

interface StyledChar {
  ch: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

interface RenderCtx {
  width: number;
  out: MdLine[];
}

// ---------------------------------------------------------------------------
// Streaming helper: drop an unfinished trailing fence so a partially typed
// "```" (or "```lang") doesn't render as literal text and flip to a code
// block a frame later (flicker), and so a partial closing fence ("``") isn't
// shown as a stray line inside the code block.
// ---------------------------------------------------------------------------

/**
 * If `md` ends with an incomplete fence marker (1-3 backticks, optionally
 * followed by a language word), drop that trailing line:
 * - fewer than 3 backticks  -> not a valid fence at all (would be text);
 * - 3+ backticks            -> strip only when it is an unclosed opener
 *   (odd number of fence lines in the document). A properly closed trailing
 *   fence is left alone.
 */
export function trimPartialClosingFences(md: string): string {
  const trimmed = md.replace(/[ \t\r\n]+$/, "");
  const nl = trimmed.lastIndexOf("\n");
  const lastLine = nl === -1 ? trimmed : trimmed.slice(nl + 1);
  // Matches lines that are only backticks + an optional lang word. Complete
  // inline codespans like "`code`" contain a closing backtick on the same
  // line and do not match (backticks are excluded from the lang class).
  if (!/^`{1,3}[a-zA-Z0-9_-]*\s*$/.test(lastLine)) return md;

  const fenceCount = (trimmed.match(/^`{3,}[a-zA-Z0-9_-]*\s*$/gm) ?? []).length;
  // 1-2 backticks → not a valid fence (would render as literal text).
  const isPartial = !/^`{3,}/.test(lastLine);
  const isUnclosedOpener = /^`{3,}/.test(lastLine) && fenceCount % 2 === 1;
  if (isPartial || isUnclosedOpener) {
    return nl === -1 ? "" : trimmed.slice(0, nl + 1);
  }
  return md;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Render markdown into a width-bounded styled row buffer (cached). */
export function renderMarkdown(md: string, width: number): MdLine[] {
  const key = `${width}\u0000${md}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const lines = renderBlocks(md, width);
  cache.set(key, lines);
  return lines;
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

function renderBlocks(md: string, width: number): MdLine[] {
  const out: MdLine[] = [];
  const tokens = marked.lexer(trimPartialClosingFences(md));
  for (const t of tokens) {
    renderBlock(t, { width, out });
  }
  // Trim leading/trailing blank rows so a message never starts/ends with a
  // stray empty line (spacer rows between messages are added by the buffer).
  while (out.length > 0 && out[out.length - 1].segments.length === 0) out.pop();
  while (out.length > 0 && out[0].segments.length === 0) out.shift();
  if (out.length === 0) out.push({ segments: [] });
  return out;
}

function renderBlock(t: Token, ctx: RenderCtx): void {
  switch (t.type) {
    case "space":
      ctx.out.push({ segments: [] });
      break;
    case "heading":
      renderHeading(t as Tokens.Heading, ctx);
      break;
    case "paragraph":
      renderParagraph(t as Tokens.Paragraph, ctx);
      break;
    case "blockquote":
      renderBlockquote(t as Tokens.Blockquote, ctx);
      break;
    case "list":
      renderList(t as Tokens.List, ctx, 0);
      break;
    case "code":
      renderCode(t as Tokens.Code, ctx);
      break;
    case "hr":
      ctx.out.push({
        segments: [{ text: "─".repeat(ctx.width), color: theme.markdownHr }],
      });
      break;
    case "table":
      renderTable(t as Tokens.Table, ctx);
      break;
    case "html":
    case "tag":
    case "def":
      break; // raw HTML / link definitions render nothing
    default:
      // Unknown/generic token: fall back to its plain text.
      if ("text" in t && typeof t.text === "string") {
        const chars: StyledChar[] = [];
        pushText(t.text, {}, chars);
        emitWrapped(chars, ctx.width, undefined, undefined, ctx.out);
      }
      break;
  }
}

function renderHeading(h: Tokens.Heading, ctx: RenderCtx): void {
  // h1/h2 are bold; h3+ keep the heading color only.
  const base: Style = { color: theme.markdownHeading, bold: h.depth <= 2 };
  const chars: StyledChar[] = [];
  inlineToChars(h.tokens, base, chars);
  emitWrapped(chars, ctx.width, undefined, undefined, ctx.out);
}

function renderParagraph(p: Tokens.Paragraph, ctx: RenderCtx): void {
  const chars: StyledChar[] = [];
  inlineToChars(p.tokens, {}, chars);
  emitWrapped(chars, ctx.width, undefined, undefined, ctx.out);
}

function renderBlockquote(bq: Tokens.Blockquote, ctx: RenderCtx): void {
  const chars: StyledChar[] = [];
  const base: Style = { color: theme.markdownBlockQuote };
  for (const inner of bq.tokens) {
    switch (inner.type) {
      case "paragraph":
      case "text":
      case "strong":
      case "em":
      case "del":
      case "codespan":
      case "link":
      case "image":
      case "br":
        inlineToChars([inner], base, chars);
        break;
      case "space":
        chars.push({ ch: "\n" });
        break;
      default:
        if ("text" in inner && typeof inner.text === "string") {
          pushText(inner.text, base, chars);
          chars.push({ ch: "\n" });
        }
        break;
    }
  }
  const quote: MdSegment = { text: "│ ", color: theme.markdownBlockQuote };
  emitWrapped(chars, ctx.width, quote, quote, ctx.out);
}

function renderList(list: Tokens.List, ctx: RenderCtx, indentLevel: number): void {
  const baseIndent = "  ".repeat(indentLevel);
  const start = typeof list.start === "number" ? list.start : 1;
  list.items.forEach((item, i) => {
    const bullet = item.task
      ? `[${item.checked ? "x" : " "}] `
      : list.ordered
        ? `${start + i}. `
        : "• ";
    const prefix: MdSegment = { text: `${baseIndent}${bullet}` };
    const bulletW = displayWidth(bullet);
    const contIndent: MdSegment = {
      text: `${baseIndent}${" ".repeat(bulletW)}`,
    };

    let emittedFirst = false;
    for (const inner of item.tokens) {
      if (inner.type === "paragraph") {
        const chars: StyledChar[] = [];
        inlineToChars(inner.tokens ?? [], {}, chars);
        emitWrapped(chars, ctx.width, prefix, contIndent, ctx.out);
        emittedFirst = true;
      } else if (inner.type === "text") {
        const chars: StyledChar[] = [];
        inlineToChars([inner], {}, chars);
        emitWrapped(chars, ctx.width, prefix, contIndent, ctx.out);
        emittedFirst = true;
      } else if (inner.type === "list") {
        renderList(inner as Tokens.List, ctx, indentLevel + 1);
      } else if (inner.type === "blockquote") {
        const qchars: StyledChar[] = [];
        const qbase: Style = { color: theme.markdownBlockQuote };
        for (const q of inner.tokens ?? []) {
          if (q.type === "paragraph" || q.type === "text") {
            inlineToChars([q], qbase, qchars);
          } else if (q.type === "space") {
            qchars.push({ ch: "\n" });
          }
        }
        const qprefix: MdSegment = {
          text: `${contIndent.text}│ `,
          color: theme.markdownBlockQuote,
        };
        emitWrapped(qchars, ctx.width, qprefix, qprefix, ctx.out);
      } else if (inner.type === "code") {
        const chars: StyledChar[] = [];
        pushText(inner.text, { color: theme.markdownCode }, chars);
        emitWrapped(chars, ctx.width, contIndent, contIndent, ctx.out);
      } else if (inner.type === "space") {
        ctx.out.push({ segments: [] });
      } else if ("text" in inner && typeof inner.text === "string") {
        const chars: StyledChar[] = [];
        pushText(inner.text, {}, chars);
        emitWrapped(chars, ctx.width, prefix, contIndent, ctx.out);
        emittedFirst = true;
      }
    }
    if (!emittedFirst) {
      // Empty item: still show the bullet.
      ctx.out.push({ segments: [prefix] });
    }
  });
}

function renderCode(code: Tokens.Code, ctx: RenderCtx): void {
  const codeText = code.text.replace(/\n+$/, "");
  if (codeText === "") return; // empty fence — nothing to render yet
  const base: Style = { color: theme.markdownCode };
  const indent: MdSegment = { text: "  " };
  for (const ln of codeText.split("\n")) {
    const chars: StyledChar[] = [];
    pushText(ln, base, chars);
    emitWrapped(chars, ctx.width, indent, indent, ctx.out);
  }
}

function renderTable(table: Tokens.Table, ctx: RenderCtx): void {
  const allRows: Tokens.TableCell[][] = [table.header, ...table.rows];
  const n = table.header.length;
  if (n === 0) return;

  // Column width = max plain-text display width of the cells in that column.
  const colWidths: number[] = new Array(n).fill(0);
  for (const row of allRows) {
    for (let c = 0; c < n; c++) {
      const cell = row[c];
      if (cell) colWidths[c] = Math.max(colWidths[c], displayWidth(cell.text));
    }
  }
  const total = colWidths.reduce((a, b) => a + b, 0) + (n - 1) * 3; // " │ " gaps

  if (total > ctx.width) {
    // Too wide for the terminal: degrade to space-joined rows that wrap.
    for (const row of allRows) {
      const chars: StyledChar[] = [];
      row.forEach((cell, c) => {
        if (c > 0) pushText(" | ", {}, chars);
        inlineToChars(cell.tokens, {}, chars);
      });
      emitWrapped(chars, ctx.width, undefined, undefined, ctx.out);
    }
    return;
  }

  allRows.forEach((row, r) => {
    const segs: MdSegment[] = [];
    for (let c = 0; c < n; c++) {
      if (c > 0) segs.push({ text: " │ " });
      const cell = row[c] ?? { text: "", tokens: [], header: false, align: null };
      const contentW = displayWidth(cell.text);
      const pad = Math.max(0, colWidths[c] - contentW);
      const align = cell.align ?? table.align[c] ?? null;
      const leftPad =
        align === "right" ? pad : align === "center" ? Math.floor(pad / 2) : 0;
      const rightPad = pad - leftPad;
      const chars: StyledChar[] = [];
      if (leftPad > 0) pushText(" ".repeat(leftPad), {}, chars);
      inlineToChars(cell.tokens, {}, chars);
      if (rightPad > 0) pushText(" ".repeat(rightPad), {}, chars);
      segs.push(...charsToSegments(chars));
    }
    ctx.out.push({ segments: segs });
    // Separator row under the header.
    if (r === 0) {
      const sep: MdSegment[] = [];
      for (let c = 0; c < n; c++) {
        if (c > 0) sep.push({ text: "─┼─", color: theme.markdownHr });
        sep.push({ text: "─".repeat(colWidths[c]), color: theme.markdownHr });
      }
      ctx.out.push({ segments: sep });
    }
  });
}

// ---------------------------------------------------------------------------
// Inline rendering (token tree -> styled char stream)
// ---------------------------------------------------------------------------

function inlineToChars(tokens: Token[], base: Style, out: StyledChar[]): void {
  for (const t of tokens) {
    switch (t.type) {
      case "text":
        if (t.tokens && t.tokens.length > 0) {
          inlineToChars(t.tokens, base, out);
        } else {
          pushText(t.text, base, out);
        }
        break;
      case "escape":
        pushText(t.text, base, out);
        break;
      case "strong":
        inlineToChars(t.tokens ?? [], { ...base, bold: true }, out);
        break;
      case "em":
        inlineToChars(t.tokens ?? [], { ...base, italic: true }, out);
        break;
      case "del":
        // No strikethrough support in segments; render the text plainly.
        inlineToChars(t.tokens ?? [], base, out);
        break;
      case "codespan":
        pushText(t.text, { ...base, color: theme.markdownCode }, out);
        break;
      case "link":
        inlineToChars(t.tokens ?? [], { ...base, color: theme.markdownLink }, out);
        break;
      case "image":
        pushText(`![${t.text}]`, base, out);
        break;
      case "br":
        out.push({ ch: "\n" });
        break;
      case "checkbox":
        out.push({ ch: `[${t.checked ? "x" : " "}] ` });
        break;
      case "html":
      case "tag":
        break; // skip raw HTML fragments
      default:
        if ("text" in t && typeof t.text === "string") pushText(t.text, base, out);
        break;
    }
  }
}

function pushText(text: string, style: Style, out: StyledChar[]): void {
  for (const ch of text) {
    out.push({
      ch,
      ...(style.color ? { color: style.color } : {}),
      ...(style.bold ? { bold: true } : {}),
      ...(style.italic ? { italic: true } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// Wrapping + segment assembly
// ---------------------------------------------------------------------------

/**
 * Wrap a styled char stream into width-bounded rows. Splits on "\n" (hard
 * breaks) and breaks long runs char-by-char (CJK-safe — never word-based).
 * A single oversized segment is split across rows, keeping each half styled.
 */
function wrapStyledChars(chars: StyledChar[], width: number): StyledChar[][] {
  const lines: StyledChar[][] = [];
  let cur: StyledChar[] = [];
  let curW = 0;
  for (const c of chars) {
    if (c.ch === "\n") {
      lines.push(cur);
      cur = [];
      curW = 0;
      continue;
    }
    const w = displayWidth(c.ch);
    if (curW + w > width && cur.length > 0) {
      lines.push(cur);
      cur = [];
      curW = 0;
    }
    cur.push(c);
    curW += w;
  }
  lines.push(cur);
  return lines;
}

/** Coalesce a styled char line into contiguous styled segments. */
function charsToSegments(chars: StyledChar[]): MdSegment[] {
  const segs: MdSegment[] = [];
  for (const c of chars) {
    const last = segs[segs.length - 1];
    if (
      last &&
      last.color === c.color &&
      (last.bold ?? false) === (c.bold ?? false) &&
      (last.italic ?? false) === (c.italic ?? false)
    ) {
      last.text += c.ch;
    } else {
      segs.push({
        text: c.ch,
        ...(c.color ? { color: c.color } : {}),
        ...(c.bold ? { bold: true } : {}),
        ...(c.italic ? { italic: true } : {}),
      });
    }
  }
  return segs;
}

/**
 * Wrap `chars` and emit MdLines, optionally applying a first-line prefix
 * (bullet / quote marker) and a continuation prefix (indent).
 */
function emitWrapped(
  chars: StyledChar[],
  width: number,
  prefix: MdSegment | undefined,
  contPrefix: MdSegment | undefined,
  out: MdLine[]
): void {
  const prefixW = prefix ? displayWidth(prefix.text) : 0;
  const avail = Math.max(1, width - prefixW);
  const wrapped = wrapStyledChars(chars, avail);
  if (wrapped.length === 0) {
    out.push({ segments: prefix ? [prefix] : [] });
    return;
  }
  for (const [i, line] of wrapped.entries()) {
    const segs: MdSegment[] = [];
    if (prefix && i === 0) segs.push(prefix);
    else if (contPrefix) segs.push(contPrefix);
    else if (prefix) segs.push({ text: " ".repeat(prefixW) });
    segs.push(...charsToSegments(line));
    out.push({ segments: segs });
  }
}
