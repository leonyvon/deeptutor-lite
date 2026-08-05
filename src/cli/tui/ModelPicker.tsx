import React from "react";
import { Box, Text, useInput } from "ink";
import type { DeeptutorRuntime, ModelChoice } from "../../agent/harness.js";
import { TextInput } from "./TextInput.js";

interface ModelPickerProps {
  runtime: DeeptutorRuntime;
  selectedIndex: number;
  step: "provider" | "apikey" | "model";
  providerId?: string;
  apiKeyValue: string;
  onSelect: (choice: { providerId: string; modelId: string }) => void;
  onCancel: () => void;
  onChangeIndex: (index: number) => void;
  onChangeStep: (step: "provider" | "apikey" | "model", providerId?: string) => void;
  onChangeApiKeyValue: (value: string) => void;
  onSubmitApiKey: (value: string) => void;
}

const PROVIDERS = [
  { id: "opencode-go", name: "OpenCode Zen Go" },
  { id: "openai-compat", name: "OpenAI Compatible" },
];

export function ModelPicker({
  runtime,
  selectedIndex,
  step,
  providerId,
  apiKeyValue,
  onSelect,
  onCancel,
  onChangeIndex,
  onChangeStep,
  onChangeApiKeyValue,
  onSubmitApiKey,
}: ModelPickerProps): React.ReactElement {
  const choices: ModelChoice[] =
    step === "provider" || step === "apikey"
      ? []
      : runtime.listModelChoices().filter((c) => c.providerId === providerId);

  useInput(
    (input, key) => {
      if (key.upArrow) {
        onChangeIndex(Math.max(0, selectedIndex - 1));
      } else if (key.downArrow) {
        const max =
          step === "provider"
            ? PROVIDERS.length - 1
            : step === "apikey"
              ? 0
              : choices.length - 1;
        onChangeIndex(Math.min(max, selectedIndex + 1));
      } else if (key.return) {
        if (step === "provider") {
          const pid = PROVIDERS[selectedIndex].id;
          const auth = runtime.authStatus(pid);
          if (auth.needsKey && !auth.configured) {
            onChangeStep("apikey", pid);
            onChangeIndex(0);
          } else {
            onChangeStep("model", pid);
            onChangeIndex(0);
          }
        } else if (step === "model") {
          const choice = choices[selectedIndex];
          if (choice) onSelect({ providerId: choice.providerId, modelId: choice.modelId });
        }
      } else if (key.escape) {
        if (step === "apikey") {
          onChangeStep("provider");
          onChangeApiKeyValue("");
          onChangeIndex(0);
        } else if (step === "model") {
          onChangeStep("provider");
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

  const auth = providerId ? runtime.authStatus(providerId) : undefined;

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="single"
      borderColor="cyan"
      width={60}
    >
      <Text bold color="cyan">
        {step === "provider"
          ? "Select Provider"
          : step === "apikey"
            ? `Enter API Key — ${
                PROVIDERS.find((p) => p.id === providerId)?.name ?? providerId
              }`
            : "Select Model"}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {step === "provider" &&
          PROVIDERS.map((p, i) => {
            const a = runtime.authStatus(p.id);
            const authLabel = a.needsKey
              ? a.configured
                ? " ✓"
                : " (needs key)"
              : "";
            return (
              <Box key={i}>
                <Text color={i === selectedIndex ? "cyan" : undefined}>
                  {i === selectedIndex ? "> " : "  "}
                  {p.name}
                  <Text dimColor>{authLabel}</Text>
                </Text>
              </Box>
            );
          })}
        {step === "apikey" && providerId && (
          <Box flexDirection="column">
            <Text dimColor>
              {providerId === "opencode-go"
                ? "Enter OpenCode API key (saved to ~/.deeptutor/config.json)"
                : "Enter API key (saved to ~/.deeptutor/config.json)"}
            </Text>
            <Box marginTop={1}>
              <TextInput
                value={apiKeyValue}
                onChange={onChangeApiKeyValue}
                onSubmit={() => onSubmitApiKey(apiKeyValue)}
                placeholder="sk-... or leave empty to use OPENCODE_API_KEY"
                focus={true}
                mask="•"
              />
            </Box>
            {auth && (
              <Box marginTop={1}>
                <Text dimColor>
                  Current source: {auth.source}
                </Text>
              </Box>
            )}
          </Box>
        )}
        {step === "model" &&
          choices.map((c, i) => {
            const a = runtime.authStatus(c.providerId);
            const authLabel = a.needsKey
              ? a.configured
                ? " ✓"
                : " (needs key)"
              : "";
            return (
              <Box key={i}>
                <Text color={i === selectedIndex ? "cyan" : undefined}>
                  {i === selectedIndex ? "> " : "  "}
                  {`${c.modelName}${c.reasoning ? " (reasoning)" : ""}`}
                  <Text dimColor>{authLabel}</Text>
                </Text>
              </Box>
            );
          })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {step === "apikey"
            ? "enter submit · esc cancel"
            : "↑↓ navigate · enter select · esc cancel"}
        </Text>
      </Box>
    </Box>
  );
}
