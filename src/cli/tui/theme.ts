/**
 * Semantic color tokens for the deeptutor TUI (opencode default palette).
 *
 * Usage: import { theme } and pass tokens straight to ink component props —
 * `<Text color={theme.primary}>` / `<Box borderColor={theme.border}>`.
 * Never build ANSI escape sequences by hand.
 */
export const theme = {
  /** Message-area background — rarely painted; let the terminal show through. */
  bg: "#141414",
  /** Input box / panel / status strip background. */
  panel: "#1e1e1e",
  /** Primary body text. */
  text: "#eeeeee",
  /** Secondary text: timestamps, hints, provider/KB labels. */
  textMuted: "#808080",
  /** User messages, the input prompt, primary interactions. */
  primary: "#f5a742",
  /** Emphasis / focus highlights / list selection. */
  accent: "#9d7cd8",
  /** Focus borders (same hue as borderActive). */
  secondary: "#5c9cf5",
  /** Tool success / completed. */
  success: "#7fd88f",
  /** In-progress / running (e.g. tool activity). */
  warning: "#e5c07b",
  /** Errors / failures. */
  error: "#e06c75",
  /** Weak / neutral borders. */
  border: "#3c3c3c",
  /** Active / focused borders. */
  borderActive: "#5c9cf5",
  /** App-drawn text-selection background (mouse drag, mouse mode on). */
  selection: "#3d3d68",
  /** Markdown headings (primary accent). */
  markdownHeading: "#f5a742",
  /** Markdown code spans / code blocks (secondary blue). */
  markdownCode: "#5c9cf5",
  /** Markdown links (secondary blue). */
  markdownLink: "#5c9cf5",
  /** Markdown blockquote markers (muted gray). */
  markdownBlockQuote: "#808080",
  /** Markdown horizontal rules (border gray). */
  markdownHr: "#3c3c3c",
  /** Markdown LaTeX math ($$…$$ / $…$) — accent purple, italic-ish intent. */
  markdownMath: "#9d7cd8",
  /** Syntax highlighting palette (aligned with the UI tokens; currently the
   *  markdown renderer uses shiki's github-dark hex values directly, these
   *  tokens are reserved for a future scope→token mapping). */
  syntaxKeyword: "#9d7cd8",
  syntaxFunction: "#5c9cf5",
  syntaxString: "#7fd88f",
  syntaxNumber: "#e5c07b",
  syntaxType: "#56b6c2",
  syntaxComment: "#808080",
  syntaxOperator: "#f5a742",
  syntaxVariable: "#eeeeee",
  syntaxPunctuation: "#808080",
  syntaxTag: "#e06c75",
} as const;

export type Theme = typeof theme;

/**
 * Detect terminal background brightness. The opencode palette is dark-first,
 * so we default to "dark" and only switch on an explicit light-bg signal
 * (COLORFGBG is "<fg>;<bg>" where bg 7/15 mean a light background).
 */
export function themeMode(): "dark" | "light" {
  const cfbg = process.env.COLORFGBG;
  if (cfbg) {
    const bg = cfbg.split(";")[1];
    if (bg === "7" || bg === "15") return "light";
  }
  return "dark";
}
