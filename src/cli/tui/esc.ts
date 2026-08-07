/** Double-ESC detection for interrupting a running LLM turn. */
export const ESC_DOUBLE_WINDOW_MS = 400;

export function isDoubleEsc(
  lastEscAt: number | null,
  now: number,
  windowMs: number = ESC_DOUBLE_WINDOW_MS
): boolean {
  return lastEscAt !== null && now - lastEscAt <= windowMs;
}
