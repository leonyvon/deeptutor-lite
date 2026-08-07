import React, { useMemo } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { resolveAsk } from "./ask.js";
import { theme } from "./theme.js";
import { wrapToLines } from "./MessageList.js";

/** Question is context — truncate it before letting it steal option rows. */
const QUESTION_CAP = 4;
/** Options always get at least this many rows when the terminal allows. */
const MIN_OPTION_ROWS = 4;
/** Fixed chrome rows beyond question+options: margins 2 + borders 2 + padding
 *  2 + options marginTop 1 + footer marginTop 1 + footer 1 + windowed
 *  "(showing X of Y)" margin 1 + row 1 = 11. Always reserved (windowed case);
 *  when unwindowed the picker is 2 rows shorter than the cap — harmless. */
const OVERHEAD = 11;

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

  // LLM sloppiness guard: sometimes the question text embeds the options
  // ("A：先完成...") while they are also passed in `options`. Drop any
  // question LINE whose content (after a label prefix) exactly matches an
  // option value — data-driven, so legit prose like "A) 和 B) 哪个更好？"
  // (content ≠ any option value) is always kept.
  const cleanQuestion = useMemo(() => {
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
  }, [question, options]);

  // Rows of the question (char-level CJK wrap).
  const questionRows = wrapToLines(cleanQuestion, contentWidth).length;

  // Question rows actually shown: capped by QUESTION_CAP, and never allowed to
  // eat the reserved MIN_OPTION_ROWS (computed against maxHeight). Undefined
  // maxHeight = uncapped (smoke tests render without it).
  const questionShown = useMemo(() => {
    if (maxHeight === undefined) return questionRows;
    const questionBudget = Math.max(1, maxHeight - OVERHEAD - MIN_OPTION_ROWS);
    return Math.min(questionRows, questionBudget);
  }, [questionRows, maxHeight]);

  // Row budget for the OPTION block (selection always visible via the window).
  const optionsBudget = useMemo(() => {
    if (maxHeight === undefined) return Number.POSITIVE_INFINITY;
    return Math.max(1, maxHeight - OVERHEAD - questionShown);
  }, [maxHeight, questionShown]);

  // Row count per option. Always count with the "  " (2-space) prefix — same
  // width as "> ", so the count is identical whether selected or not.
  const optionRowCounts = useMemo(
    () =>
      entries.map(([label, text]) =>
        wrapToLines(`  ${label}) ${text}`, contentWidth).length
      ),
    [entries, contentWidth]
  );

  // Windowed option slice: start at the SELECTED option, extend backward while
  // rows fit, then forward while rows fit — the selection stays visible.
  const window = useMemo(() => {
    const n = entries.length;
    if (n === 0) return { start: 0, end: 0 };
    if (!Number.isFinite(optionsBudget)) return { start: 0, end: n };
    let start = selectedIndex;
    let end = selectedIndex + 1;
    let used = optionRowCounts[selectedIndex] ?? 1;
    while (start > 0 && used + optionRowCounts[start - 1] <= optionsBudget) {
      start--;
      used += optionRowCounts[start];
    }
    while (end < n && used + optionRowCounts[end] <= optionsBudget) {
      used += optionRowCounts[end];
      end++;
    }
    return { start, end };
  }, [entries.length, optionRowCounts, selectedIndex, optionsBudget]);

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
