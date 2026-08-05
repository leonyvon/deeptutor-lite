/**
 * Terminal output rendering: streaming assistant text (chalk), tool call
 * cards, and turn separators. Subscribes to harness events.
 */
import chalk from "chalk";
import type { AgentHarnessEvent } from "@earendil-works/pi-agent-core";

/** Colors used across the CLI. */
export const colors = {
  user: chalk.cyan.bold,
  assistant: chalk.reset,
  tool: chalk.magenta,
  toolOk: chalk.dim.green,
  toolErr: chalk.red,
  header: chalk.bold,
  dim: chalk.dim,
  accent: chalk.cyan,
};

/** Render one harness event; returns true if it produced visible output. */
export function renderEvent(event: AgentHarnessEvent): boolean {
  switch (event.type) {
    case "message_update": {
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
        return true;
      }
      return false;
    }
    case "tool_execution_start": {
      const args = JSON.stringify(event.args ?? {});
      process.stdout.write(
        `\n${colors.tool("⚙ " + event.toolName)} ${colors.dim(args.slice(0, 160))}\n`
      );
      return true;
    }
    case "tool_execution_end": {
      if (event.isError) {
        process.stdout.write(`${colors.toolErr(`✖ ${event.toolName} failed`)}\n`);
      } else {
        process.stdout.write(`${colors.toolOk(`✓ ${event.toolName}`)}\n`);
      }
      return true;
    }
    case "agent_end": {
      process.stdout.write("\n");
      return true;
    }
    default:
      return false;
  }
}

/** Render a user message line. */
export function renderUserLine(text: string): void {
  const firstLine = text.split("\n")[0].slice(0, 100);
  process.stdout.write(`${colors.user("You:")} ${firstLine}\n`);
}

/** Render a simple info line (dim). */
export function info(text: string): void {
  process.stdout.write(`${colors.dim(text)}\n`);
}

/** Render an error line (red). */
export function error(text: string): void {
  process.stdout.write(`${colors.toolErr("Error:")} ${text}\n`);
}
