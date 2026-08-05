/**
 * Shared types for the deeptutor TUI components.
 */
import type { JsonlSessionMetadata } from "@earendil-works/pi-agent-core";

export type UIMessage =
  | { type: "user"; text: string; id: string }
  | { type: "assistant"; text: string; streaming: boolean; id: string; isError?: boolean }
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
      step: "provider" | "apikey" | "model";
      providerId?: string;
      apiKeyValue: string;
      searchQuery: string;
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
      previews: Record<string, string>;
      selectedIndex: number;
    }
  | { type: "help" }
  | {
      type: "ask";
      question: string;
      options: Record<string, string>;
      selectedIndex: number;
    };
