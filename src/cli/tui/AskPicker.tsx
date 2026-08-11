import React, { useMemo } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { resolveAsk } from "./ask.js";
import { theme } from "./theme.js";
import { wrapToLines } from "./MessageList.js";

/** Question is context — truncate it before letting it steal option rows. */
export const QUESTION_CAP = 4;
/** Options always get at least this many rows when the terminal allows. */
export const MIN_OPTION_ROWS = 4;
/** Fixed chrome rows beyond question+options: margins 2 + borders 2 + padding
 *  2 + options marginTop 1 + footer marginTop 1 + footer 1 = 9, plus the
 *  windowed "(showing X of Y)" margin 1 + row 1 = 11 (windowed case). */
export const OVERHEAD = 11;
/** Chrome rows when the option window is NOT active (no "(showing" row). */
export const OVERHEAD_UNWINDOWED = OVERHEAD - 2;

/** LLM sloppiness guard: drop any question LINE whose content (after a label
 *  prefix) exactly matches an option value — data-driven, so legit prose like
 *  "A) 和 B) 哪个更好？" (content ≠ any option value) is always kept. */
export function cleanQuestionText(
  question: string,
  options: Record<string, string>
): string {
  const optionValues = new Set(
    Object.values(options).map((v) => v.trim().replace(/\s/g, ""))
  );
  return question
    .split("\n")
    .filter((line) => {
      const m = line.trim().match(/^[•·\-*]?\s*[A-Za-z0-9]\s*[):：.、]\s*(.+)$/);
      if (!m) return true;
      return !optionValues.has(m[1].trim().replace(/\s/g, ""));
    })
    .join("\n");
}

export interface AskPickerLayout {
  /** Question rows actually rendered (≤ QUESTION_CAP). */
  questionShown: number;
  /** Row budget for the option block (Infinity = uncapped). */
  optionsBudget: number;
  /** Windowed option slice [start, end). */
  window: { start: number; end: number };
  /** EXACT total rendered rows of the picker (chrome + question + options). */
  totalRows: number;
}

/**
 * Pure layout computation — the SINGLE source of truth for the picker's
 * height. Used by BOTH the component (rendering) and the App (to allocate the
 * remaining content-area rows to the message history), so the picker always
 * takes exactly what it needs and the history fills the rest.
 */
export function computeAskPickerLayout(
  question: string,
  options: Record<string, string>,
  contentWidth: number,
  maxHeight: number | undefined,
  selectedIndex: number
): AskPickerLayout {
  const entries = Object.entries(options);
  const cleanQuestion = cleanQuestionText(question, options);
  const questionRows = wrapToLines(cleanQuestion, contentWidth).length;

  // Question rows actually shown: capped by QUESTION_CAP, and never allowed to
  // eat the reserved MIN_OPTION_ROWS (computed against maxHeight). Undefined
  // maxHeight = uncapped (smoke tests render without it).
  const questionShown =
    maxHeight === undefined
      ? Math.min(questionRows, QUESTION_CAP)
      : Math.min(
          questionRows,
          Math.max(1, maxHeight - OVERHEAD - MIN_OPTION_ROWS),
          QUESTION_CAP
        );

  // Row budget for the OPTION block (selection always visible via the window).
  const optionsBudget =
    maxHeight === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(1, maxHeight - OVERHEAD - questionShown);

  // Row count per option. Always count with the "  " (2-space) prefix — same
  // width as "> ", so the count is identical whether selected or not.
  const optionRowCounts = entries.map(([label, text]) =>
    wrapToLines(`  ${label}) ${text}`, contentWidth).length
  );

  // Windowed option slice: start at the SELECTED option, extend backward while
  // rows fit, then forward while rows fit — the selection stays visible.
  let window: { start: number; end: number } = { start: 0, end: entries.length };
  let usedRows = optionRowCounts.reduce((a, b) => a + b, 0);
  if (entries.length > 0 && Number.isFinite(optionsBudget)) {
    let start = selectedIndex;
    let end = selectedIndex + 1;
    let used = optionRowCounts[selectedIndex] ?? 1;
    while (start > 0 && used + optionRowCounts[start - 1] <= optionsBudget) {
      start--;
      used += optionRowCounts[start];
    }
    while (end < entries.length && used + optionRowCounts[end] <= optionsBudget) {
      used += optionRowCounts[end];
      end++;
    }
    window = { start, end };
    usedRows = used;
  }
  const windowed = window.end - window.start < entries.length;
  // A selected option taller than the budget is capped at optionsBudget rows
  // during rendering — mirror that here so totalRows stays exact.
  const renderedOptionRows = Number.isFinite(optionsBudget)
    ? Math.min(usedRows, optionsBudget)
    : usedRows;

  const totalRows =
    (windowed ? OVERHEAD : OVERHEAD_UNWINDOWED) + questionShown + renderedOptionRows;

  return { questionShown, optionsBudget, window, totalRows };
}

interface AskPickerProps {
  question: string;
  options: Record<string, string>;
  selectedIndex: number;
  onChangeIndex: (index: number) => void;
  /** Cap on the picker's total rendered height (terminal rows). Undefined = no cap. */
  maxHeight?: number;
}

export function AskPicker({
  question,
  options,
  selectedIndex,
  onChangeIndex,
  maxHeight,
}: AskPickerProps): React.ReactElement {
  const entries = Object.entries(options);

  // Content width inside the bordered (2 cols) + padded (2 cols) picker box.
  const { stdout } = useStdout();
  const contentWidth = Math.max((stdout.columns ?? 80) - 4, 10);

  // Layout is computed ONCE here and drives rendering — identical math to the
  // App's height allocation (computeAskPickerLayout is shared).
  const layout = useMemo(
    () =>
      computeAskPickerLayout(question, options, contentWidth, maxHeight, selectedIndex),
    [question, options, contentWidth, maxHeight, selectedIndex]
  );
  const { questionShown, optionsBudget, window } = layout;
  const cleanQuestion = useMemo(
    () => cleanQuestionText(question, options),
    [question, options]
  );
  const questionRows = wrapToLines(cleanQuestion, contentWidth).length;
  const visibleEntries = useMemo(
    () => entries.slice(window.start, window.end),
    [entries, window]
  );

  useInput((input, key) => {
    if (key.upArrow) {
      onChangeIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      onChangeIndex(Math.min(entries.length - 1, selectedIndex + 1));
    } else if (key.return) {
      const [label, text] = entries[selectedIndex];
      resolveAsk(`${label}: ${text}`);
    } else if (key.escape) {
      resolveAsk(null);
    }
  });

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="single"
      borderColor={theme.border}
      marginY={1}
    >
      <Box flexDirection="column">
        {wrapToLines(cleanQuestion, contentWidth)
          .slice(0, questionShown)
          .map((ln, li) => (
            <Box key={li} height={1} flexShrink={0}>
              <Text bold color={theme.accent} wrap="truncate">
                {li === questionShown - 1 && questionRows > questionShown ? "…" : ln}
              </Text>
            </Box>
          ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visibleEntries.map(([label, text], i) => {
          const globalIdx = window.start + i;
          const selected = globalIdx === selectedIndex;
          const prefix = selected ? "> " : "  ";
          const optionLines = wrapToLines(`${prefix}${label}) ${text}`, contentWidth);
          // Cap each option's rendered rows at the option budget: a selected
          // option taller than the budget is still included by the window, so
          // without this cap it would push the picker past maxHeight and
          // overlap the footer/border. Truncated options end with "…".
          const capped = Number.isFinite(optionsBudget) && optionLines.length > optionsBudget
            ? optionLines.slice(0, optionsBudget)
            : optionLines;
          if (capped !== optionLines) capped[capped.length - 1] = "…";
          return (
            <Box key={`${globalIdx}-${label}`} flexDirection="column" flexShrink={0}>
              {capped.map((ln, li) => (
                <Box key={`${globalIdx}-${li}`} height={1} flexShrink={0}>
                  <Text wrap="truncate" color={selected ? theme.accent : undefined}>
                    {ln}
                  </Text>
                </Box>
              ))}
            </Box>
          );
        })}
        {window.end - window.start < entries.length && (
          <Box marginTop={1}>
            <Text color={theme.textMuted}>
              (showing {window.end - window.start} of {entries.length})
            </Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.textMuted} wrap="truncate">↑↓ navigate · enter select · esc cancel</Text>
      </Box>
    </Box>
  );
}
