/**
 * Interactive choice prompt implementation for the TUI.
 *
 * Tools (e.g. mastery_quiz) call `ask(question, options)` via ToolContext.
 * The App component subscribes to pending asks and renders an AskPicker.
 *
 * Integration note: DeeptutorRuntime accepts an optional `ask` parameter in
 * its constructor. To enable interactive quiz questions, create the runtime
 * with `ask: inkAsk`:
 *
 *   import { inkAsk } from "./cli/tui/ask.js";
 *   const runtime = new DeeptutorRuntime(config, session, inkAsk);
 */

type AskRequest = {
  question: string;
  options: Record<string, string>;
  resolve: (value: string | null) => void;
};

let pendingAsk: AskRequest | null = null;
const listeners = new Set<() => void>();

export function subscribeAsk(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingAsk():
  | { question: string; options: Record<string, string> }
  | null {
  if (!pendingAsk) return null;
  return { question: pendingAsk.question, options: pendingAsk.options };
}

export function resolveAsk(value: string | null): void {
  pendingAsk?.resolve(value);
  pendingAsk = null;
  listeners.forEach((l) => l());
}

export function inkAsk(
  question: string,
  options: Record<string, string>
): Promise<string | null> {
  return new Promise((resolve) => {
    pendingAsk = { question, options, resolve };
    listeners.forEach((l) => l());
  });
}
