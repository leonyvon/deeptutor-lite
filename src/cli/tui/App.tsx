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
import { spawn } from "node:child_process";
import { basename } from "node:path";
import type { DeeptutorRuntime } from "../../agent/harness.js";
import type { JsonlSessionRepo } from "@earendil-works/pi-agent-core";
import type { UIMessage, AppMode } from "./types.js";
import { MessageList, totalBufferLines, extractSelectionText } from "./MessageList.js";
import type { ScreenSelection } from "./MessageList.js";
import { parseSgrMouse } from "./mouse.js";
import { CommandMenu } from "./CommandMenu.js";
import { TextInput, flatPartsText, estimateInputLines, extractInputSelectionText } from "./TextInput.js";
import type { InputPart } from "./TextInput.js";
import { StatusBar } from "./StatusBar.js";
import { ModelPicker } from "./ModelPicker.js";
import { BraveConfig } from "./BraveConfig.js";
import { SessionPicker } from "./SessionPicker.js";
import { AskPicker } from "./AskPicker.js";
import { subscribeAsk, getPendingAsk, resolveAsk } from "./ask.js";
import { sessionEntriesToMessages, loadSessionPreview, buildRewindTargets } from "./history.js";
import { theme } from "./theme.js";
import { getHighlighter } from "./markdown.js";
import { RewindPicker } from "./RewindPicker.js";
import { isDoubleEsc, ESC_DOUBLE_WINDOW_MS } from "./esc.js";

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
  "/rewind": "Rewind to a previous turn",
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
  // Input content as a sequence of parts (text segments + multi-line paste
  // blocks as placeholders inside the input flow).
  const [input, setInput] = useState<InputPart[]>([]);
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

  // App-drawn text selection (SGR mouse mode). While the user drags, the
  // selection is highlighted by MessageList; on mouse-up the covered text is
  // copied to the clipboard and the selection is cleared.
  const [selection, setSelection] = useState<ScreenSelection | null>(null);
  const [mouseDown, setMouseDown] = useState(false);

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
  // lines + 1 bottom row). Width available to TextInput = term width - prompt
  // prefix (2) - paddingX 1×2 (2). estimateInputLines uses the exact same
  // segment packer as the renderer (paste blocks are inline tokens), so the
  // box height always matches the rendered row count.
  const inputLines = Math.max(
    1,
    estimateInputLines(input, Math.max(termWidth - 4, 10))
  );
  const inputAreaHeight = Math.min(MAX_INPUT_LINES, 2 + inputLines);

  // 1-based screen row of the input box's first CONTENT line (the box spans
  // inputAreaHeight rows directly above the 2-row status bar). Used both for
  // the hardware-cursor anchor and for input-area drag-selection.
  const inputContentTopRow = rows - inputAreaHeight;

  const visibleHeight = Math.max(rows - inputAreaHeight - 2, 5); // rows - input area - status(2 rows)

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
      } else {
        // resolveAsk cleared the pending ask (answer picked or ESC cancelled):
        // return to chat mode so the input box comes back.
        setMode({ type: "chat" });
      }
    });
    return unsub;
  }, []);

  // Scroll handling: only PgUp/PgDn scroll the message area; ↑/↓ belong to
  // the input box (caret movement across wrapped lines). The wheel still
  // scrolls via SGR mouse events (handled below). While the slash-command
  // palette is open, ↑/↓ belong to menu navigation (separate handler).
  useInput(
    (input, key) => {
      if (menuOpen) return;
      if (key.pageUp) {
        setScrollOffset((prev) => clampScroll(prev + Math.max(5, Math.floor(visibleHeight * 0.3))));
      } else if (key.pageDown) {
        setScrollOffset((prev) => clampScroll(prev - Math.max(5, Math.floor(visibleHeight * 0.3))));
      }
    },
    { isActive: mode.type === "chat" || mode.type === "ask" }
  );

  // Ctrl+C: clear the input box when it has content; exit only when empty
  // (and not inside a picker/menu).
  useInput((char, key) => {
    if (key.ctrl && char === "c") {
      if (mode.type === "chat" && input.length > 0) {
        setInput([]);
        setMenuVisible(false);
        setMenuIndex(0);
      } else {
        exit();
      }
    }
  });

  // Double-ESC interrupt: while a turn is running, pressing ESC twice within
  // ESC_DOUBLE_WINDOW_MS aborts the LLM (harness.abort() → agent_end → existing
  // event handler resets streaming/isProcessing). First ESC shows a hint.
  const lastEscRef = useRef<number | null>(null);
  const escHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRequestedRef = useRef(false);
  const [escHint, setEscHint] = useState(false);

  useEffect(() => {
    if (isProcessing) return;
    lastEscRef.current = null;
    abortRequestedRef.current = false;
    setEscHint(false);
    if (escHintTimerRef.current) {
      clearTimeout(escHintTimerRef.current);
      escHintTimerRef.current = null;
    }
  }, [isProcessing]);

  useInput(
    (_input, key) => {
      if (!key.escape) return;
      const now = Date.now();
      if (isDoubleEsc(lastEscRef.current, now)) {
        lastEscRef.current = null;
        if (abortRequestedRef.current) return;
        abortRequestedRef.current = true;
        setEscHint(false);
        runtime.harness
          ?.abort()
          .then(() => {
            setMessages((prev) => [
              ...prev,
              { type: "assistant", text: "⏹ 已中断回答", streaming: false, id: nextId() },
            ]);
          })
          .catch(() => {});
      } else {
        lastEscRef.current = now;
        setEscHint(true);
        if (escHintTimerRef.current) clearTimeout(escHintTimerRef.current);
        escHintTimerRef.current = setTimeout(() => setEscHint(false), 2000);
      }
    },
    // Gate to chat mode: while an AskPicker is up, ESC must only cancel the
    // picker (resolveAsk(null)), never trigger the turn-abort path.
    { isActive: isProcessing && mode.type === "chat" }
  );

  // SGR mouse events (enabled in index.ts with ?1000h?1002h?1006h). ink
  // passes the ESC-stripped sequence (e.g. "[<0;10;20M") as `input` with all
  // keys false. We draw our own text selection: press starts it, drag grows
  // it (highlighted by MessageList), release copies the covered text to the
  // clipboard. Wheel events (64/65) scroll the message area by one row —
  // with mouse tracking active the terminal no longer translates the wheel
  // into arrows (1007), so we handle it here.
  useInput(
    (rawInput) => {
      if (!rawInput.startsWith("[<")) return;
      const events = parseSgrMouse(rawInput);
      for (const ev of events) {
        if (ev.kind === "wheel") {
          if (ev.wheelDir) {
            setScrollOffset((prev) => clampScroll(prev + ev.wheelDir!));
          }
          continue;
        }
        if (ev.kind === "press" && ev.button === 0 && !ev.mods) {
          setMouseDown(true);
          setSelection({ startX: ev.x, startY: ev.y, endX: ev.x, endY: ev.y });
          continue;
        }
        if (ev.kind === "drag" && ev.button === 0) {
          if (mouseDown) {
            setSelection((prev) =>
              prev
                ? { ...prev, endX: ev.x, endY: ev.y }
                : { startX: ev.x, startY: ev.y, endX: ev.x, endY: ev.y }
            );
          }
          continue;
        }
        if (ev.kind === "release") {
          setMouseDown(false);
          if (selection) {
            // Both areas self-clamp to their own rows: the message buffer and
            // the input box. A selection spanning both joins with "\n"; a
            // selection entirely in one area leaves the other empty.
            const text = extractSelectionText(
              messages,
              termWidth,
              visibleHeight,
              scrollOffset,
              selection
            );
            const inputText = extractInputSelectionText(
              input,
              Math.max(termWidth - 4, 10),
              inputContentTopRow,
              5,
              selection
            );
            const combined = [text, inputText].filter(Boolean).join("\n");
            if (combined) {
              try {
                const clip = spawn("clip.exe", [], { stdio: ["pipe", "ignore", "ignore"] });
                clip.stdin.write(combined);
                clip.stdin.end();
              } catch {
                /* clipboard unavailable — selection still highlighted */
              }
            }
          }
          setSelection(null);
        }
      }
    },
    { isActive: mode.type === "chat" || mode.type === "ask" }
  );

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

  // Streaming-residue safety net: if processing ends without a proper
  // agent_end (interrupted/aborted event stream), the last assistant message
  // could stay marked streaming forever, leaving a trailing "▎" and keeping
  // the blink-era re-render machinery alive. Clear the flag on any
  // processing end so the cursor can never linger.
  useEffect(() => {
    if (isProcessing) return;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.type === "assistant" && last.streaming) {
        const next = [...prev];
        next[next.length - 1] = { ...last, streaming: false };
        return next;
      }
      return prev;
    });
  }, [isProcessing]);

  // Slash command dropdown palette state
  const menuOpen =
    mode.type === "chat" &&
    flatPartsText(input).trim().startsWith("/") &&
    menuVisible;

  const menuCommands = useMemo(() => {
    const q = flatPartsText(input).trim().toLowerCase();
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
          setInput([{ kind: "text", text: cmd.name }]);
          setMenuIndex(0);
          setMenuVisible(true);
        }
      } else if (key.escape) {
        if (flatPartsText(input).trim() === "/") {
          setInput([]);
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
      // `value` is already the merged full text (paste blocks included) that
      // TextInput produced via mergeParts.
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
      setInput([]);

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
  /rewind            Rewind to a previous turn
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

        if (cmd === "/rewind") {
          const session = runtime.session;
          const harness = runtime.harness;
          if (!session || !harness) {
            setMessages((prev) => [...prev, { type: "assistant", text: "No active session yet.", streaming: false, id: nextId() }]);
            return;
          }
          try {
            const entries = await session.getBranch();
            const targets = buildRewindTargets(entries);
            if (targets.length === 0) {
              setMessages((prev) => [...prev, { type: "assistant", text: "Nothing to rewind to yet.", streaming: false, id: nextId() }]);
              return;
            }
            setMode({ type: "rewind", targets, selectedIndex: targets.length - 1 });
          } catch (err: any) {
            setMessages((prev) => [...prev, { type: "assistant", text: `Error: ${err?.message ?? String(err)}`, streaming: false, id: nextId() }]);
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
            selection={selection}
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
          {escHint && (
            <Box marginTop={1} flexShrink={0}>
              <Text color={theme.textMuted}>再按 ESC 中断当前回答…</Text>
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
              maxHeight={rows - 2}
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
      ) : mode.type === "rewind" ? (
        <Box
          flexDirection="column"
          flexGrow={1}
          justifyContent="center"
          alignItems="center"
        >
          <RewindPicker
            targets={mode.targets}
            selectedIndex={mode.selectedIndex}
            onSelect={async (target) => {
              const session = runtime.session;
              const harness = runtime.harness;
              if (!session || !harness) { setMode({ type: "chat" }); return; }
              const idx = mode.targets.findIndex((t) => t.entryId === target.entryId);
              try {
                const result = await harness.navigateTree(target.entryId, { summarize: false });
                const entries = await session.getBranch();
                setMessages(sessionEntriesToMessages(entries));
                setScrollOffset(0);
                const roleLabel = target.role === "user" ? "你" : "AI";
                const notice = result.editorText !== undefined
                  ? `已回退到 #${idx + 1}（${roleLabel}），原文已恢复，可修改后重发`
                  : `已回退到 #${idx + 1}（${roleLabel}）`;
                setMessages((prev) => [...prev, { type: "assistant", text: notice, streaming: false, id: nextId() }]);
                if (result.editorText !== undefined) {
                  setInput([{ kind: "text", text: result.editorText }]);
                }
              } catch (err: any) {
                setMessages((prev) => [...prev, { type: "assistant", text: `Error: ${err?.message ?? String(err)}`, streaming: false, id: nextId() }]);
              }
              setMode({ type: "chat" });
            }}
            onCancel={() => setMode({ type: "chat" })}
            onChangeIndex={(i) => setMode((prev) => (prev.type === "rewind" ? { ...prev, selectedIndex: i } : prev))}
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
                parts={input}
                onChange={(parts) => {
                  setInput(parts);
                  setMenuIndex(0);
                  setMenuVisible(flatPartsText(parts).startsWith("/"));
                }}
                onSubmit={handleSubmit}
                placeholder={PLACEHOLDER_TEXT}
                focus={!isProcessing}
                blinkPaused={mouseDown}
                menuOpen={menuOpen}
                selection={selection}
                // Anchor the hardware cursor inside the input box so the
                // Windows Terminal IME composition window (pinyin pre-edit)
                // follows the caret instead of the last written row.
                // Row: the status bar occupies the bottom 2 rows; the input
                // box spans inputAreaHeight rows directly above it (top row
                // rows-inputAreaHeight-1), its first content row is +1.
                // The command menu sits above the input box inside the same
                // bottom-anchored container, so it does NOT shift the input
                // box rows — no menu offset here.
                // Col: paddingX(1) + "❯ " prefix. ❯ (U+276F) is an East
                // Asian Ambiguous char rendered WIDE (2 cols) by Windows
                // Terminal in a CJK locale — ink lays it out as 1 col, so the
                // real terminal columns differ from ink's. The self-drawn ▎
                // follows the text and ends up at the wide-char position, so
                // the hardware anchor must use terminal widths: 1 + 2 + 1 = 4
                // offset => content starts at 1-based column 5.
                screenRow={inputContentTopRow}
                screenColBase={5}
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
