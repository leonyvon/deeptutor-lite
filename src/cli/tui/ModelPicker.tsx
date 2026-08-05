import React from "react";
import { Box, Text, useInput } from "ink";
import type { DeeptutorRuntime, ModelChoice } from "../../agent/harness.js";

interface ModelPickerProps {
  runtime: DeeptutorRuntime;
  selectedIndex: number;
  step: "provider" | "model";
  providerId?: string;
  onSelect: (choice: { providerId: string; modelId: string }) => void;
  onCancel: () => void;
  onChangeIndex: (index: number) => void;
  onChangeStep: (step: "provider" | "model", providerId?: string) => void;
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
  onSelect,
  onCancel,
  onChangeIndex,
  onChangeStep,
}: ModelPickerProps): React.ReactElement {
  const choices: ModelChoice[] =
    step === "provider"
      ? []
      : runtime.listModelChoices().filter((c) => c.providerId === providerId);

  useInput((input, key) => {
    if (key.upArrow) {
      onChangeIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      const max =
        step === "provider" ? PROVIDERS.length - 1 : choices.length - 1;
      onChangeIndex(Math.min(max, selectedIndex + 1));
    } else if (key.return) {
      if (step === "provider") {
        onChangeStep("model", PROVIDERS[selectedIndex].id);
        onChangeIndex(0);
      } else {
        const choice = choices[selectedIndex];
        if (choice) onSelect({ providerId: choice.providerId, modelId: choice.modelId });
      }
    } else if (key.escape) {
      if (step === "model") {
        onChangeStep("provider");
        onChangeIndex(0);
      } else {
        onCancel();
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="single"
      borderColor="cyan"
      width={60}
    >
      <Text bold color="cyan">
        {step === "provider" ? "Select Provider" : "Select Model"}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {step === "provider"
          ? PROVIDERS.map((p, i) => (
              <Box key={i}>
                <Text color={i === selectedIndex ? "cyan" : undefined}>
                  {i === selectedIndex ? "> " : "  "}
                  {p.name}
                </Text>
              </Box>
            ))
          : choices.map((c, i) => (
              <Box key={i}>
                <Text color={i === selectedIndex ? "cyan" : undefined}>
                  {i === selectedIndex ? "> " : "  "}
                  {`${c.modelName}${c.reasoning ? " (reasoning)" : ""}`}
                </Text>
              </Box>
            ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · enter select · esc cancel</Text>
      </Box>
    </Box>
  );
}
