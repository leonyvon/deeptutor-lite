/**
 * Shared types for the deeptutor TUI components.
 */
import type { JsonlSessionMetadata } from "@earendil-works/pi-agent-core";

export type UIMessage =
  | { type: "user"; text: string; id: string }
  | { type: "assistant"; text: string; streaming: boolean; id: string }
  | {
      type: "tool";
      toolName: string;
      args: string;
      status: "running" | "success" | "error";
      id: string;
    };

export type AppMode =
  | { type: "chat" }
  | {
      type: "model";
      step: "provider" | "model";
      providerId?: string;
      selectedIndex: number;
    }
  | {
      type: "brave";
      selectedIndex: number;
      fields: { apiKey: string; proxy: string; maxResults: string };
    }
  | {
      type: "session";
      sessions: JsonlSessionMetadata[];
      selectedIndex: number;
    }
  | { type: "help" }
  | {
      type: "ask";
      question: string;
      options: Record<string, string>;
      selectedIndex: number;
    };
