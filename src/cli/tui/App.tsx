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
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Box, Text, useInput, useApp, useWindowSize } from "ink";
import { basename } from "node:path";
import type { DeeptutorRuntime } from "../../agent/harness.js";
import type { JsonlSessionRepo } from "@earendil-works/pi-agent-core";
import type { UIMessage, AppMode } from "./types.js";
import { MessageList, totalBufferLines, countDisplayLines } from "./MessageList.js";
import { CommandMenu } from "./CommandMenu.js";
import { TextInput } from "./TextInput.js";
import { StatusBar } from "./StatusBar.js";
import { ModelPicker } from "./ModelPicker.js";
import { BraveConfig } from "./BraveConfig.js";
import { SessionPicker } from "./SessionPicker.js";
import { AskPicker } from "./AskPicker.js";
import { subscribeAsk, getPendingAsk, resolveAsk } from "./ask.js";
import { sessionEntriesToMessages, loadSessionPreview } from "./history.js";
import { theme } from "./theme.js";
import { getHighlighter } from "./markdown.js";

let idCounter = 0;
function nextId(): string {
  return `msg-${++idCounter}`;
}

const COMMAND_DESCRIPTIONS: Record<string, string> = {
  "/model": "Switch model",
  "/brave": "Configure Brave search",
  "/new": "New session",
  "/list": "List sessions",
  "/continue": "Continue session",
  "/quiz": "Generate a quiz",
  "/research": "Run research agent",
  "/solve": "Solve step by step",
  "/visualize": "Create chart/plot",
  "/mastery": "Start mastery path",
  "/help": "Show help",
  "/quit": "Exit",
};

// Derived in insertion order (keeps existing SLASH_COMMANDS references working)
const SLASH_COMMANDS = Object.keys(COMMAND_DESCRIPTIONS);

// Spinner frames for the "thinking…" animation shown while processing
// (before the first streaming text_delta arrives).
const THINKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Input box grows with the wrapped input lines, but never beyond this height
// (prevents a very long paste from occupying the whole screen).
const MAX_INPUT_LINES = 8;

const PLACEHOLDER_TEXT = "Ask about your knowledge base… (/help)";

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
  const [scrollOffset, setScrollOffset] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuVisible, setMenuVisible] = useState(false);
  const [thinkingTick, setThinkingTick] = useState(0);
  // Triggers a re-render once the async shiki highlighter is ready so code
  // blocks upgrade from the plain markdownCode color to syntax colors.
  const [, setHighlighterReady] = useState(false);

  // Streaming delta batching: accumulate text_delta events and flush them at
  // most every STREAM_FLUSH_MS, coalescing several tokens per setState. This
  // is the ink-side equivalent of pi's render throttling — without it, every
  // token triggers a full React reconciler pass (visible on long replies).
  const STREAM_FLUSH_MS = 30;
  const deltaBufRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushDeltaBuffer = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const buffered = deltaBufRef.current;
    deltaBufRef.current = "";
    if (!buffered) return;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.type === "assistant" && last.streaming) {
        const next = [...prev];
        next[next.length - 1] = { ...last, text: last.text + buffered };
        return next;
      }
      return [
        ...prev,
        { type: "assistant", text: buffered, streaming: true, id: nextId() },
      ];
    });
  }, []);

  // Kick off async shiki initialization; when ready, re-render so code blocks
  // gain syntax colors (failure degrades silently to plain color).
  useEffect(() => {
    getHighlighter()
      .then(() => setHighlighterReady(true))
      .catch(() => {});
  }, []);

  const queueDeltaFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(flushDeltaBuffer, STREAM_FLUSH_MS);
  }, [flushDeltaBuffer]);

  const termWidth = process.stdout.columns ?? 80;

  // Input box height grows with the wrapped input (1 top border + content
  // lines + 1 bottom row). Width available to TextInput = term width - "> "
  // prefix (2) - paddingX 1×2 (2).
  const inputLines = Math.max(
    1,
    countDisplayLines(input || PLACEHOLDER_TEXT, Math.max(termWidth - 4, 10))
  );
  const inputAreaHeight = Math.min(MAX_INPUT_LINES, 2 + inputLines);

  const visibleHeight = Math.max(rows - inputAreaHeight - 1, 5); // rows - input area - status(1)

  // Total exact rows of the flattened message buffer and the clamp ceiling
  // for scrollOffset (per terminal row, matching pi's row-granular scroll).
  const totalLines = useMemo(
    () => totalBufferLines(messages, termWidth),
    [messages, termWidth]
  );

  const maxScroll = Math.max(0, totalLines - visibleHeight);

  const clampScroll = useCallback(
    (v: number) => Math.max(0, Math.min(v, maxScroll)),
    [maxScroll]
  );

  // Load session path on mount / runtime change
  useEffect(() => {
    if (!runtime.session) return;
    runtime.session
      .getMetadata()
      .then((m) => setSessionPath(m.path))
      .catch(() => {});
  }, [runtime.session]);

  // Subscribe to harness events for streaming UI updates.
  // Depends on runtime.harness: setSession/ensureSession replace the harness
  // instance, and a stale subscription would freeze isProcessing forever
  // (events from the new harness would never reach the UI).
  useEffect(() => {
    const harness = runtime.harness;
    if (!harness) return;
    const unsub = harness.subscribe((event) => {
      if (event.type === "message_update") {
        if (event.assistantMessageEvent.type === "text_delta") {
          // Batch tokens into the delta buffer; flush on a timer so we don't
          // run a React render pass per token (see STREAM_FLUSH_MS above).
          deltaBufRef.current += event.assistantMessageEvent.delta;
          queueDeltaFlush();
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
      } else if (event.type === "message_end") {
        // Flush any remaining buffered deltas before finalizing the message.
        flushDeltaBuffer();
        const msg = event.message;
        if ("stopReason" in msg && msg.stopReason === "error") {
          const errorText =
            "errorMessage" in msg && typeof msg.errorMessage === "string"
              ? msg.errorMessage
              : "Unknown error";
          setMessages((prev) => [
            ...prev,
            {
              type: "assistant",
              text: `⚠ 模型调用失败: ${errorText}`,
              streaming: false,
              isError: true,
              id: nextId(),
            },
          ]);
          setIsProcessing(false);
        }
      } else if (event.type === "agent_end") {
        // Flush remaining deltas so the last assistant message is complete
        // before we clear its streaming flag.
        flushDeltaBuffer();
        setMessages((prev) => {
          let next = [...prev];
          const last = next[next.length - 1];
          if (last && last.type === "assistant" && last.streaming) {
            next[next.length - 1] = { ...last, streaming: false };
          }
          const lastMsg = event.messages[event.messages.length - 1];
          if (
            lastMsg &&
            "stopReason" in lastMsg &&
            lastMsg.stopReason === "error"
          ) {
            const lastUi = next[next.length - 1];
            if (!lastUi || lastUi.type !== "assistant" || !lastUi.isError) {
              const errorText =
                "errorMessage" in lastMsg &&
                typeof lastMsg.errorMessage === "string"
                  ? lastMsg.errorMessage
                  : "Unknown error";
              next.push({
                type: "assistant",
                text: `⚠ 模型调用失败: ${errorText}`,
                streaming: false,
                isError: true,
                id: nextId(),
              });
            }
          }
          return next;
        });
        setIsProcessing(false);
      }
    });
    return () => {
      unsub();
      // Drop any pending batching timer so it can't fire after unmount.
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [runtime.harness, flushDeltaBuffer, queueDeltaFlush]);

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

  // Scroll handling: ↑/↓ and PgUp/PgDn when in chat mode and not processing.
  // We deliberately do NOT enable SGR mouse tracking (xterm 1000/1006): that
  // would steal mouse events from the terminal and break click-drag text
  // selection. Instead we enable Alternate Scroll (xterm 1007) — the terminal
  // then translates the wheel into ↑/↓ arrow keys for us while leaving mouse
  // selection to the terminal itself (pi/opencode do the same).
  // Scroll offset is per terminal row (the message area is a flat row buffer,
  // exactly like pi's chat container) — so the wheel scrolls 1 row at a time,
  // never whole messages.
  useInput(
    (input, key) => {
      // While the slash-command palette is open, ↑/↓ belong to menu navigation.
      if (menuOpen) return;
      if (key.pageUp) {
        setScrollOffset((prev) => clampScroll(prev + Math.max(5, Math.floor(visibleHeight * 0.3))));
      } else if (key.pageDown) {
        setScrollOffset((prev) => clampScroll(prev - Math.max(5, Math.floor(visibleHeight * 0.3))));
      } else if (key.upArrow) {
        setScrollOffset((prev) => clampScroll(prev + 1));
      } else if (key.downArrow) {
        setScrollOffset((prev) => clampScroll(prev - 1));
      }
    },
    { isActive: mode.type === "chat" && !isProcessing }
  );

  // Global Ctrl+C exit
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
    }
  });

  // Auto-follow: when new messages arrive and user is at bottom, stay at bottom
  useEffect(() => {
    if (scrollOffset === 0) return;
    // If user has scrolled up, we don't auto-scroll on new messages.
    // But if the latest message is an error or agent_end, we might want to show it.
    // For now, keep it simple: only auto-follow when at bottom.
  }, [messages, scrollOffset]);

  // True while the harness is emitting a streaming assistant response.
  const lastMsg = messages[messages.length - 1];
  const streamingInProgress =
    !!lastMsg && lastMsg.type === "assistant" && lastMsg.streaming === true;

  // "thinking…" spinner while processing but before streaming output starts
  // (model reasoning phase can take several seconds).
  useEffect(() => {
    if (isProcessing && !streamingInProgress) {
      const t = setInterval(() => setThinkingTick((v) => v + 1), 100);
      return () => clearInterval(t);
    }
  }, [isProcessing, streamingInProgress]);

  // Slash command dropdown palette state
  const menuOpen =
    mode.type === "chat" && input.trim().startsWith("/") && menuVisible;

  const menuCommands = useMemo(() => {
    const q = input.trim().toLowerCase();
    return SLASH_COMMANDS.filter((c) =>
      c.toLowerCase().startsWith(q)
    ).map((name) => ({ name, desc: COMMAND_DESCRIPTIONS[name] ?? "" }));
  }, [input]);

  // Keep highlight in bounds when the filtered list shrinks (e.g. Tab completion)
  useEffect(() => {
    if (menuCommands.length === 0) {
      setMenuIndex(0);
      return;
    }
    if (menuIndex >= menuCommands.length) {
      setMenuIndex(menuCommands.length - 1);
    }
  }, [menuCommands.length, menuIndex]);

  // Menu keyboard: ↑/↓ move highlight, Tab complete, Esc close.
  // Enter is handled inside handleSubmit (TextInput fires onSubmit).
  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setMenuIndex((prev) =>
          menuCommands.length === 0 ? prev : Math.max(0, prev - 1)
        );
      } else if (key.downArrow) {
        setMenuIndex((prev) =>
          menuCommands.length === 0
            ? prev
            : Math.min(menuCommands.length - 1, prev + 1)
        );
      } else if (key.tab) {
        const cmd = menuCommands[menuIndex];
        if (cmd) {
          setInput(cmd.name);
          setMenuIndex(0);
          setMenuVisible(true);
        }
      } else if (key.escape) {
        if (input.trim() === "/") {
          setInput("");
        }
        setMenuVisible(false);
      }
    },
    { isActive: menuOpen }
  );

  // Lazy session creation: the first user message (or skill run) creates the
  // session if none exists. Returns false on failure (error message pushed).
  const ensureSessionReady = useCallback(async (): Promise<boolean> => {
    if (runtime.session) return true;
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
      return false;
    }
    try {
      const s = await runtime.ensureSession(repo);
      const meta = await s.getMetadata();
      setSessionPath(meta.path);
      return true;
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
      return false;
    }
  }, [runtime, repo]);

  const handleSubmit = useCallback(
    async (value: string) => {
      let line = value.trim();
      // Menu open + valid highlight → run the highlighted command instead of
      // the raw input (opencode palette behavior).
      if (
        menuOpen &&
        menuCommands.length > 0 &&
        menuIndex >= 0 &&
        menuIndex < menuCommands.length
      ) {
        line = menuCommands[menuIndex].name;
      }
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
  /continue          Continue session
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
          setMode({ type: "model", step: "provider", apiKeyValue: "", searchQuery: "", selectedIndex: 0 });
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
            setMessages([]);
            setScrollOffset(0);
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
            // Load previews for all sessions
            const previews: Record<string, string> = {};
            await Promise.all(
              sessions.map(async (m) => {
                try {
                  const s = await repo.open(m);
                  previews[m.path] = await loadSessionPreview(s);
                } catch {
                  previews[m.path] = "";
                }
              })
            );
            let text = "Sessions:\n";
            for (const s of sessions) {
              const rawPreview = previews[s.path];
              const hasPreview = rawPreview && rawPreview.trim().length > 0;
              const preview = hasPreview ? rawPreview : "（空会话）";
              const mainText = preview.length > 36 ? preview.slice(0, 36) + "…" : preview;
              const base = basename(s.path);
              const timeMatch = base.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
              const time = timeMatch ? `${timeMatch[2]}-${timeMatch[3]} ${timeMatch[4]}:${timeMatch[5]}` : "";
              const mark = s.path === sessionPath ? "▶ " : "  ";
              text += `${mark}${mainText}${time ? " " + time : ""}\n`;
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

        if (cmd === "/continue" || cmd === "/switch") {
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
            const previews: Record<string, string> = {};
            await Promise.all(
              sessions.map(async (m) => {
                try {
                  const s = await repo.open(m);
                  previews[m.path] = await loadSessionPreview(s);
                } catch {
                  previews[m.path] = "";
                }
              })
            );
            setMode({
              type: "session",
              sessions,
              previews,
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
          const ready = await ensureSessionReady();
          if (!ready) return;
          const harness = runtime.harness;
          if (!harness) return;
          setMessages((prev) => [
            ...prev,
            { type: "user", text: line, id: nextId() },
          ]);
          setIsProcessing(true);
          try {
            await harness.skill(skill, instructions);
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
      const ready = await ensureSessionReady();
      if (!ready) return;
      const harness = runtime.harness;
      if (!harness) return;
      setMessages((prev) => [
        ...prev,
        { type: "user", text: line, id: nextId() },
      ]);
      setIsProcessing(true);
      try {
        await harness.prompt(line);
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
    [runtime, exit, repo, sessionPath, menuOpen, menuCommands, menuIndex, ensureSessionReady]
  );

  // Scroll info text for status bar
  const scrollInfo = useMemo(() => {
    if (messages.length === 0) return undefined;
    if (scrollOffset === 0) return undefined;
    return `▲ scrolled`;
  }, [messages.length, scrollOffset]);

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
          <MessageList
            messages={messages}
            scrollOffset={scrollOffset}
            visibleHeight={visibleHeight}
          />
          {mode.type === "chat" &&
            isProcessing &&
            !streamingInProgress && (
              <Box marginTop={1} flexShrink={0}>
                <Text color={theme.textMuted}>
                  {THINKING_FRAMES[thinkingTick % THINKING_FRAMES.length]}{" "}
                  thinking…
                </Text>
              </Box>
            )}
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
            apiKeyValue={mode.apiKeyValue}
            searchQuery={mode.searchQuery}
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
                  ? { ...prev, step, providerId, searchQuery: step === "provider" || step === "model" ? "" : prev.searchQuery }
                  : prev
              )
            }
            onChangeApiKeyValue={(value) =>
              setMode((prev) =>
                prev.type === "model"
                  ? { ...prev, apiKeyValue: value }
                  : prev
              )
            }
            onChangeSearchQuery={(value) =>
              setMode((prev) =>
                prev.type === "model"
                  ? { ...prev, searchQuery: value, selectedIndex: 0 }
                  : prev
              )
            }
            onSubmitApiKey={async (value) => {
              const pid = mode.providerId;
              if (!pid) return;
              try {
                await runtime.setApiKey(pid, value);
                setMode((prev) =>
                  prev.type === "model"
                    ? { ...prev, step: "model", apiKeyValue: "", searchQuery: "" }
                    : prev
                );
              } catch (err: any) {
                setMessages((prev) => [
                  ...prev,
                  {
                    type: "assistant",
                    text: `Error saving API key: ${err?.message ?? String(err)}`,
                    streaming: false,
                    id: nextId(),
                  },
                ]);
                setMode({ type: "chat" });
              }
            }}
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
            previews={mode.previews}
            selectedIndex={mode.selectedIndex}
            currentPath={sessionPath}
            onSelect={async (session) => {
              if (!repo) return;
              try {
                const opened = await repo.open(session);
                await runtime.setSession(opened);
                const meta = await opened.getMetadata();
                setSessionPath(meta.path);
                // Load history messages
                const entries = await opened.getEntries();
                const history = sessionEntriesToMessages(entries);
                setMessages(history);
                setScrollOffset(0);
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
        <Box flexDirection="column" flexShrink={0}>
          {menuOpen && menuCommands.length > 0 && (
            <CommandMenu commands={menuCommands} selectedIndex={menuIndex} />
          )}
          <Box
            flexDirection="column"
            height={inputAreaHeight}
            flexShrink={0}
            borderStyle="single"
            borderTop
            borderColor={theme.borderActive}
            backgroundColor={theme.panel}
            paddingX={1}
          >
            <Box flexDirection="row">
              <Text color={theme.primary}>{isProcessing ? "⋯ " : "❯ "}</Text>
              <TextInput
                value={input}
                onChange={(v) => {
                  setInput(v);
                  setMenuIndex(0);
                  setMenuVisible(v.startsWith("/"));
                }}
                onSubmit={handleSubmit}
                placeholder={PLACEHOLDER_TEXT}
                focus={!isProcessing}
              />
            </Box>
          </Box>
        </Box>
      )}

      {/* Status bar */}
      <StatusBar
        runtime={runtime}
        sessionPath={sessionPath}
        isProcessing={isProcessing}
        scrollInfo={scrollInfo}
      />
    </Box>
  );
}
