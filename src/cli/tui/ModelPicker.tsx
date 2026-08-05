import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { DeeptutorRuntime, ModelChoice } from "../../agent/harness.js";
import { TextInput } from "./TextInput.js";

const OPENAI_COMPAT_ID = "openai-compat";
const WINDOW_SIZE = 10;

interface ModelPickerProps {
  runtime: DeeptutorRuntime;
  selectedIndex: number;
  step: "provider" | "apikey" | "model";
  providerId?: string;
  apiKeyValue: string;
  searchQuery: string;
  onSelect: (choice: { providerId: string; modelId: string }) => void;
  onCancel: () => void;
  onChangeIndex: (index: number) => void;
  onChangeStep: (step: "provider" | "apikey" | "model", providerId?: string) => void;
  onChangeApiKeyValue: (value: string) => void;
  onChangeSearchQuery: (value: string) => void;
  onSubmitApiKey: (value: string) => void;
}

export function ModelPicker({
  runtime,
  selectedIndex,
  step,
  providerId,
  apiKeyValue,
  searchQuery,
  onSelect,
  onCancel,
  onChangeIndex,
  onChangeStep,
  onChangeApiKeyValue,
  onChangeSearchQuery,
  onSubmitApiKey,
}: ModelPickerProps): React.ReactElement {
  // ---- Provider list (dynamic from runtime catalog) ----
  const providers = useMemo(() => {
    const builtIn = runtime.models
      .getProviders()
      .filter((p) => p.id !== OPENAI_COMPAT_ID)
      .map((p) => ({ id: p.id, name: p.name }));
    return [...builtIn, { id: OPENAI_COMPAT_ID, name: "OpenAI Compatible" }];
  }, [runtime]);

  // ---- Async auth state cache ----
  const [authState, setAuthState] = useState<
    Record<string, { needsKey: boolean; configured: boolean; source: string } | undefined>
  >({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const pids = providers.map((p) => p.id);
      const next: Record<string, { needsKey: boolean; configured: boolean; source: string }> = {};
      await Promise.all(
        pids.map(async (pid) => {
          try {
            const a = await runtime.authStatus(pid);
            next[pid] = a;
          } catch {
            next[pid] = { needsKey: false, configured: false, source: "error" };
          }
        })
      );
      if (!cancelled) setAuthState(next);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [runtime, providers]);

  // ---- Model choices + search filtering ----
  const allChoices = useMemo(() => {
    if (step !== "model" || !providerId) return [] as ModelChoice[];
    return runtime.listModelChoices().filter((c) => c.providerId === providerId);
  }, [runtime, step, providerId]);

  const filteredChoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allChoices;
    return allChoices.filter((c) =>
      `${c.providerId} ${c.modelId} ${c.modelName}`.toLowerCase().includes(q)
    );
  }, [allChoices, searchQuery]);

  // ---- Windowed list for model step ----
  const windowStart = useMemo(() => {
    if (filteredChoices.length <= WINDOW_SIZE) return 0;
    return Math.max(0, Math.min(selectedIndex, filteredChoices.length - WINDOW_SIZE));
  }, [filteredChoices.length, selectedIndex]);

  const visibleChoices = useMemo(
    () => filteredChoices.slice(windowStart, windowStart + WINDOW_SIZE),
    [filteredChoices, windowStart]
  );

  // ---- Keyboard handling ----
  useInput(
    (input, key) => {
      if (step === "apikey") return; // apikey has its own handlers
      if (key.upArrow) {
        onChangeIndex(Math.max(0, selectedIndex - 1));
      } else if (key.downArrow) {
        const max =
          step === "provider"
            ? providers.length - 1
            : filteredChoices.length - 1;
        onChangeIndex(Math.min(max, selectedIndex + 1));
      } else if (key.return) {
        if (step === "provider") {
          const pid = providers[selectedIndex].id;
          const auth = authState[pid];
          if (auth && auth.needsKey && !auth.configured) {
            onChangeStep("apikey", pid);
            onChangeIndex(0);
          } else {
            onChangeStep("model", pid);
            onChangeIndex(0);
          }
        } else if (step === "model") {
          const choice = filteredChoices[selectedIndex];
          if (choice) onSelect({ providerId: choice.providerId, modelId: choice.modelId });
        }
      } else if (key.escape) {
        if (step === "model" && searchQuery.trim()) {
          onChangeSearchQuery("");
          onChangeIndex(0);
        } else if (step === "model") {
          onChangeStep("provider");
          onChangeSearchQuery("");
          onChangeIndex(0);
        } else {
          onCancel();
        }
      }
    },
    { isActive: step !== "apikey" }
  );

  // Escape handler during apikey step
  useInput(
    (input, key) => {
      if (key.escape) {
        onChangeStep("provider");
        onChangeApiKeyValue("");
        onChangeIndex(0);
      }
    },
    { isActive: step === "apikey" }
  );

  const currentAuth = providerId ? authState[providerId] : undefined;

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="single"
      borderColor="cyan"
      width={70}
    >
      <Text bold color="cyan">
        {step === "provider"
          ? "Select Provider"
          : step === "apikey"
            ? `Enter API Key — ${
                providers.find((p) => p.id === providerId)?.name ?? providerId
              }`
            : `Select Model — ${
                providers.find((p) => p.id === providerId)?.name ?? providerId
              }`}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {/* ---- Provider list ---- */}
        {step === "provider" &&
          providers.map((p, i) => {
            const a = authState[p.id];
            const authLabel =
              a && a.needsKey ? (a.configured ? " ✓" : " (needs key)") : "";
            return (
              <Box key={p.id}>
                <Text color={i === selectedIndex ? "cyan" : undefined}>
                  {i === selectedIndex ? "> " : "  "}
                  {p.name}
                  <Text dimColor>{authLabel}</Text>
                </Text>
              </Box>
            );
          })}

        {/* ---- API key input ---- */}
        {step === "apikey" && providerId && (
          <Box flexDirection="column">
            <Text dimColor>
              Enter API key for {providers.find((p) => p.id === providerId)?.name ?? providerId}
            </Text>
            <Text dimColor>(saved to ~/.deeptutor/auth.json)</Text>
            <Box marginTop={1}>
              <TextInput
                value={apiKeyValue}
                onChange={onChangeApiKeyValue}
                onSubmit={() => onSubmitApiKey(apiKeyValue)}
                placeholder="sk-..."
                focus={true}
                mask="•"
              />
            </Box>
            {currentAuth && (
              <Box marginTop={1}>
                <Text dimColor>Current source: {currentAuth.source}</Text>
              </Box>
            )}
          </Box>
        )}

        {/* ---- Model list with search ---- */}
        {step === "model" && (
          <Box flexDirection="column">
            {/* Search box */}
            <Box marginBottom={1}>
              <Text dimColor>Search: </Text>
              <TextInput
                value={searchQuery}
                onChange={onChangeSearchQuery}
                onSubmit={() => {}}
                placeholder="filter models..."
                focus={true}
              />
            </Box>
            {/* Filtered list */}
            {visibleChoices.map((c, i) => {
              const globalIdx = windowStart + i;
              const a = authState[c.providerId];
              const authLabel =
                a && a.needsKey ? (a.configured ? " ✓" : " (needs key)") : "";
              return (
                <Box key={`${c.providerId}-${c.modelId}`}>
                  <Text color={globalIdx === selectedIndex ? "cyan" : undefined}>
                    {globalIdx === selectedIndex ? "> " : "  "}
                    {`${c.modelName}${c.reasoning ? " (reasoning)" : ""}`}
                    <Text dimColor>{authLabel}</Text>
                  </Text>
                </Box>
              );
            })}
            {/* Count indicator */}
            {filteredChoices.length > 0 && (
              <Box marginTop={1}>
                <Text dimColor>
                  (showing {visibleChoices.length} of {filteredChoices.length})
                </Text>
              </Box>
            )}
            {filteredChoices.length === 0 && (
              <Box marginTop={1}>
                <Text dimColor>(no matches)</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {step === "apikey"
            ? "enter submit · esc cancel"
            : step === "model"
              ? "↑↓ navigate · enter select · esc back/clear"
              : "↑↓ navigate · enter select · esc cancel"}
        </Text>
      </Box>
    </Box>
  );
}
