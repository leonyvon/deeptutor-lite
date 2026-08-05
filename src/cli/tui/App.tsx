/**
 * deeptutor full-screen TUI (ink).
 *
 * Layout: scrollable message history | input box | status bar.
 *
 * Integration note: DeeptutorRuntime accepts an optional `ask` parameter in its
 * constructor. To enable interactive quiz questions in the TUI, create the
 * runtime with `ask: inkAsk` exported from this module:
 *
 *   import { inkAsk } from "./cli/tui/ask.js";
 *   const runtime = new DeeptutorRuntime(config, session, inkAsk);
 */
import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp, useWindowSize } from "ink";
import type { DeeptutorRuntime } from "../../agent/harness.js";
import type { JsonlSessionRepo } from "@earendil-works/pi-agent-core";
import type { UIMessage, AppMode } from "./types.js";
import { MessageList } from "./MessageList.js";
import { TextInput } from "./TextInput.js";
import { StatusBar } from "./StatusBar.js";
import { ModelPicker } from "./ModelPicker.js";
import { BraveConfig } from "./BraveConfig.js";
import { SessionPicker } from "./SessionPicker.js";
import { AskPicker } from "./AskPicker.js";
import { subscribeAsk, getPendingAsk, resolveAsk } from "./ask.js";

let idCounter = 0;
function nextId(): string {
  return `msg-${++idCounter}`;
}

const SLASH_COMMANDS = [
  "/model",
  "/brave",
  "/new",
  "/list",
  "/switch",
  "/quiz",
  "/research",
  "/solve",
  "/visualize",
  "/mastery",
  "/help",
  "/quit",
];

export interface AppProps {
  runtime: DeeptutorRuntime;
  repo?: JsonlSessionRepo;
}

export function App({ runtime, repo }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { rows } = useWindowSize();
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<AppMode>({ type: "chat" });
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionPath, setSessionPath] = useState("");

  // Load session path on mount / runtime change
  useEffect(() => {
    runtime.session
      .getMetadata()
      .then((m) => setSessionPath(m.path))
      .catch(() => {});
  }, [runtime]);

  // Subscribe to harness events for streaming UI updates
  useEffect(() => {
    const unsub = runtime.harness.subscribe((event) => {
      if (event.type === "message_update") {
        if (event.assistantMessageEvent.type === "text_delta") {
          const delta = event.assistantMessageEvent.delta;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.type === "assistant" && last.streaming) {
              const next = [...prev];
              next[next.length - 1] = { ...last, text: last.text + delta };
              return next;
            }
            return [
              ...prev,
              { type: "assistant", text: delta, streaming: true, id: nextId() },
            ];
          });
        }
      } else if (event.type === "tool_execution_start") {
        setMessages((prev) => [
          ...prev,
          {
            type: "tool",
            toolName: event.toolName,
            args: JSON.stringify(event.args ?? {}),
            status: "running",
            id: nextId(),
          },
        ]);
      } else if (event.type === "tool_execution_end") {
        setMessages((prev) => {
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            const m = prev[i];
            if (
              m.type === "tool" &&
              m.toolName === event.toolName &&
              m.status === "running"
            ) {
              idx = i;
              break;
            }
          }
          if (idx === -1) return prev;
          const next = [...prev];
          const msg = next[idx];
          if (msg.type === "tool") {
            next[idx] = { ...msg, status: event.isError ? "error" : "success" };
          }
          return next;
        });
      } else if (event.type === "agent_end") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.type === "assistant" && last.streaming) {
            const next = [...prev];
            next[next.length - 1] = { ...last, streaming: false };
            return next;
          }
          return prev;
        });
        setIsProcessing(false);
      }
    });
    return unsub;
  }, [runtime]);

  // Subscribe to interactive ask requests from tools
  useEffect(() => {
    const unsub = subscribeAsk(() => {
      const pending = getPendingAsk();
      if (pending) {
        setMode({
          type: "ask",
          question: pending.question,
          options: pending.options,
          selectedIndex: 0,
        });
      }
    });
    return unsub;
  }, []);

  // Global Ctrl+C exit
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
    }
  });

  const handleSubmit = useCallback(
    async (value: string) => {
      const line = value.trim();
      if (!line) return;
      setInput("");

      if (line.startsWith("/")) {
        const [cmd, ...rest] = line.split(/\s+/);
        const arg = rest.join(" ");

        if (cmd === "/quit" || cmd === "/exit") {
          exit();
          return;
        }

        if (cmd === "/help") {
          const helpText = `Commands:
  /quiz <topic>      Generate a quiz
  /research <topic>  Run research agent
  /solve <problem>   Solve step by step
  /visualize <data>  Create chart/plot
  /mastery           Start mastery path
  /model             Switch model
  /brave             Configure Brave search
  /new               New session
  /list              List sessions
  /switch            Switch session
  /help              Show help
  /quit              Exit`;
          setMessages((prev) => [
            ...prev,
            { type: "user", text: line, id: nextId() },
            { type: "assistant", text: helpText, streaming: false, id: nextId() },
          ]);
          return;
        }

        if (cmd === "/model") {
          setMode({ type: "model", step: "provider", selectedIndex: 0 });
          return;
        }

        if (cmd === "/brave") {
          setMode({
            type: "brave",
            selectedIndex: 0,
            fields: { apiKey: "", proxy: "", maxResults: "" },
          });
          return;
        }

        if (cmd === "/new") {
          if (!repo) {
            setMessages((prev) => [
              ...prev,
              {
                type: "assistant",
                text: "Error: no session repo available",
                streaming: false,
                id: nextId(),
              },
            ]);
            return;
          }
          try {
            const session = await repo.create({ cwd: process.cwd() });
            await runtime.setSession(session);
            const meta = await session.getMetadata();
            setSessionPath(meta.path);
            setMessages((prev) => [
              ...prev,
              {
                type: "assistant",
                text: `New session started: ${meta.path}`,
                streaming: false,
                id: nextId(),
              },
            ]);
          } catch (err: any) {
            setMessages((prev) => [
              ...prev,
              {
                type: "assistant",
                text: `Error: ${err?.message ?? String(err)}`,
                streaming: false,
                id: nextId(),
              },
            ]);
          }
          return;
        }

        if (cmd === "/list") {
          if (!repo) {
            setMessages((prev) => [
              ...prev,
              {
                type: "assistant",
                text: "Error: no session repo available",
                streaming: false,
                id: nextId(),
              },
            ]);
            return;
          }
          try {
            const sessions = await repo.list();
            if (sessions.length === 0) {
              setMessages((prev) => [
                ...prev,
                {
                  type: "assistant",
                  text: "No sessions yet.",
                  streaming: false,
                  id: nextId(),
                },
              ]);
              return;
            }
            let text = "Sessions:\n";
            for (const s of sessions) {
              const mark = s.path === sessionPath ? "▶ " : "  ";
              text += `${mark}${s.path}\n`;
            }
            setMessages((prev) => [
              ...prev,
              {
                type: "assistant",
                text: text.trimEnd(),
                streaming: false,
                id: nextId(),
              },
            ]);
          } catch (err: any) {
            setMessages((prev) => [
              ...prev,
              {
                type: "assistant",
                text: `Error: ${err?.message ?? String(err)}`,
                streaming: false,
                id: nextId(),
              },
            ]);
          }
          return;
        }

        if (cmd === "/switch") {
          if (!repo) {
            setMessages((prev) => [
              ...prev,
              {
                type: "assistant",
                text: "Error: no session repo available",
                streaming: false,
                id: nextId(),
              },
            ]);
            return;
          }
          try {
            const sessions = await repo.list();
            if (sessions.length === 0) {
              setMessages((prev) => [
                ...prev,
                {
                  type: "assistant",
                  text: "No sessions to switch to.",
                  streaming: false,
                  id: nextId(),
                },
              ]);
              return;
            }
            setMode({
              type: "session",
              sessions,
              selectedIndex: 0,
            });
          } catch (err: any) {
            setMessages((prev) => [
              ...prev,
              {
                type: "assistant",
                text: `Error: ${err?.message ?? String(err)}`,
                streaming: false,
                id: nextId(),
              },
            ]);
          }
          return;
        }

        const skillMap: Record<string, string> = {
          "/quiz": "deeptutor-quiz",
          "/research": "deeptutor-research",
          "/solve": "deeptutor-solve",
          "/visualize": "deeptutor-visualize",
          "/mastery": "deeptutor-mastery",
        };

        if (skillMap[cmd]) {
          const skill = skillMap[cmd];
          const instructions = arg ? `User instructions: ${arg}` : undefined;
          setMessages((prev) => [
            ...prev,
            { type: "user", text: line, id: nextId() },
          ]);
          setIsProcessing(true);
          try {
            await runtime.harness.skill(skill, instructions);
          } catch (err: any) {
            setMessages((prev) => [
              ...prev,
              {
                type: "assistant",
                text: `Error: ${err?.message ?? String(err)}`,
                streaming: false,
                id: nextId(),
              },
            ]);
            setIsProcessing(false);
          }
          return;
        }

        setMessages((prev) => [
          ...prev,
          {
            type: "assistant",
            text: `Unknown command: ${cmd} — try /help`,
            streaming: false,
            id: nextId(),
          },
        ]);
        return;
      }

      // Regular chat message
      setMessages((prev) => [
        ...prev,
        { type: "user", text: line, id: nextId() },
      ]);
      setIsProcessing(true);
      try {
        await runtime.harness.prompt(line);
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            type: "assistant",
            text: `Error: ${err?.message ?? String(err)}`,
            streaming: false,
            id: nextId(),
          },
        ]);
        setIsProcessing(false);
      }
    },
    [runtime, exit, repo, sessionPath]
  );

  const suggestions = input.startsWith("/")
    ? SLASH_COMMANDS.filter((c) => c.startsWith(input))
    : [];

  return (
    <Box flexDirection="column" height={rows}>
      {/* Main content area */}
      {mode.type === "chat" || mode.type === "ask" ? (
        <Box
          flexDirection="column"
          flexGrow={1}
          justifyContent="flex-end"
          overflow="hidden"
        >
          <MessageList messages={messages} />
          {mode.type === "ask" && (
            <AskPicker
              question={mode.question}
              options={mode.options}
              selectedIndex={mode.selectedIndex}
              onChangeIndex={(idx) =>
                setMode((prev) =>
                  prev.type === "ask"
                    ? { ...prev, selectedIndex: idx }
                    : prev
                )
              }
            />
          )}
        </Box>
      ) : mode.type === "model" ? (
        <Box
          flexDirection="column"
          flexGrow={1}
          justifyContent="center"
          alignItems="center"
        >
          <ModelPicker
            runtime={runtime}
            selectedIndex={mode.selectedIndex}
            step={mode.step}
            providerId={mode.providerId}
            onSelect={async ({ providerId, modelId }) => {
              try {
                await runtime.switchModel(providerId, modelId);
                setMessages((prev) => [
                  ...prev,
                  {
                    type: "assistant",
                    text: `Switched to ${modelId} @ ${providerId}`,
                    streaming: false,
                    id: nextId(),
                  },
                ]);
              } catch (err: any) {
                setMessages((prev) => [
                  ...prev,
                  {
                    type: "assistant",
                    text: `Error switching model: ${err?.message ?? String(err)}`,
                    streaming: false,
                    id: nextId(),
                  },
                ]);
              }
              setMode({ type: "chat" });
            }}
            onCancel={() => setMode({ type: "chat" })}
            onChangeIndex={(idx) =>
              setMode((prev) =>
                prev.type === "model"
                  ? { ...prev, selectedIndex: idx }
                  : prev
              )
            }
            onChangeStep={(step, providerId) =>
              setMode((prev) =>
                prev.type === "model"
                  ? { ...prev, step, providerId }
                  : prev
              )
            }
          />
        </Box>
      ) : mode.type === "brave" ? (
        <Box
          flexDirection="column"
          flexGrow={1}
          justifyContent="center"
          alignItems="center"
        >
          <BraveConfig
            runtime={runtime}
            selectedIndex={mode.selectedIndex}
            onSave={() => {
              setMessages((prev) => [
                ...prev,
                {
                  type: "assistant",
                  text: "Brave search configuration saved to ~/.deeptutor/config.json",
                  streaming: false,
                  id: nextId(),
                },
              ]);
              setMode({ type: "chat" });
            }}
            onCancel={() => setMode({ type: "chat" })}
            onChangeIndex={(idx) =>
              setMode((prev) =>
                prev.type === "brave"
                  ? { ...prev, selectedIndex: idx }
                  : prev
              )
            }
          />
        </Box>
      ) : mode.type === "session" ? (
        <Box
          flexDirection="column"
          flexGrow={1}
          justifyContent="center"
          alignItems="center"
        >
          <SessionPicker
            sessions={mode.sessions}
            selectedIndex={mode.selectedIndex}
            currentPath={sessionPath}
            onSelect={async (session) => {
              if (!repo) return;
              try {
                const opened = await repo.open(session);
                await runtime.setSession(opened);
                const meta = await opened.getMetadata();
                setSessionPath(meta.path);
                setMessages((prev) => [
                  ...prev,
                  {
                    type: "assistant",
                    text: `Switched to ${meta.path}`,
                    streaming: false,
                    id: nextId(),
                  },
                ]);
              } catch (err: any) {
                setMessages((prev) => [
                  ...prev,
                  {
                    type: "assistant",
                    text: `Error: ${err?.message ?? String(err)}`,
                    streaming: false,
                    id: nextId(),
                  },
                ]);
              }
              setMode({ type: "chat" });
            }}
            onCancel={() => setMode({ type: "chat" })}
            onChangeIndex={(idx) =>
              setMode((prev) =>
                prev.type === "session"
                  ? { ...prev, selectedIndex: idx }
                  : prev
              )
            }
          />
        </Box>
      ) : null}

      {/* Input area */}
      {mode.type === "chat" && (
        <Box
          flexDirection="column"
          height={3}
          flexShrink={0}
          borderStyle="single"
          borderTop
          borderColor="gray"
          paddingX={1}
        >
          <Box flexDirection="row">
            <Text color="cyan">{isProcessing ? "⋯ " : "> "}</Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="Ask about your knowledge base… (/help)"
              focus={!isProcessing}
            />
          </Box>
          {suggestions.length > 0 &&
            suggestions.length < SLASH_COMMANDS.length && (
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                {suggestions.map((s) => (
                  <Text key={s} dimColor>
                    {s}
                  </Text>
                ))}
              </Box>
            )}
        </Box>
      )}

      {/* Status bar */}
      <StatusBar
        runtime={runtime}
        sessionPath={sessionPath}
        isProcessing={isProcessing}
      />
    </Box>
  );
}
