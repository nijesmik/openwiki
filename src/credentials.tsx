import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { openWikiEnvPath, saveOpenWikiEnv } from "./env.js";
import {
  getOpenWikiUpdateWorkflowStatus,
  openWikiWorkflowPath,
  writeOpenWikiUpdateWorkflow,
  type WorkflowStatus,
  type WorkflowWriteStatus,
} from "./github-action.js";

export type WorkflowSetupStatus = WorkflowWriteStatus | "skipped";

export type InitSetupResult = {
  savedOpenAIKey: boolean;
  savedLangSmithKey: boolean;
  workflow: {
    path: string;
    status: WorkflowSetupStatus;
  };
};

type InitSetupProps = {
  onComplete: (result: InitSetupResult) => void;
  onError: (message: string) => void;
};

type PromptStep = "openai" | "langsmith" | "workflow";
type WorkflowSetupState =
  | { status: "loading" }
  | { status: "ready"; workflowStatus: WorkflowStatus };

export function needsCredentialSetup(): boolean {
  return (
    !process.env.OPENAI_API_KEY || process.env.LANGSMITH_API_KEY === undefined
  );
}

export function InitSetup({ onComplete, onError }: InitSetupProps) {
  const [workflowSetupState, setWorkflowSetupState] =
    useState<WorkflowSetupState>({
      status: "loading",
    });
  const [step, setStep] = useState<PromptStep | null>(null);
  const [openAIKey, setOpenAIKey] = useState<string | null>(null);
  const [langSmithKey, setLangSmithKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    getOpenWikiUpdateWorkflowStatus()
      .then((workflowStatus) => {
        if (!isMounted) {
          return;
        }

        setWorkflowSetupState({
          status: "ready",
          workflowStatus,
        });

        const initialStep = getInitialStep(workflowStatus);

        if (initialStep === null) {
          onComplete({
            savedOpenAIKey: false,
            savedLangSmithKey: false,
            workflow: {
              path: openWikiWorkflowPath,
              status: "unchanged",
            },
          });
          return;
        }

        setStep(initialStep);
      })
      .catch((setupError: unknown) => {
        onError(
          setupError instanceof Error
            ? setupError.message
            : "Failed to inspect OpenWiki setup.",
        );
      });

    return () => {
      isMounted = false;
    };
  }, [onComplete, onError]);

  useInput((inputValue, key) => {
    if (isSaving || step === null) {
      return;
    }

    if (key.return) {
      void submit();
      return;
    }

    if (key.backspace || key.delete) {
      setInput((value) => value.slice(0, -1));
      return;
    }

    if (inputValue && !key.ctrl && !key.meta) {
      setInput((value) => value + inputValue);
    }
  });

  async function submit() {
    setError(null);

    if (step === "openai") {
      const trimmedInput = input.trim();

      if (trimmedInput.length === 0) {
        setError("OpenAI API key is required.");
        return;
      }

      setOpenAIKey(trimmedInput);
      setInput("");

      if (process.env.LANGSMITH_API_KEY === undefined) {
        setStep("langsmith");
        return;
      }

      if (isExistingWorkflowUnchanged(workflowSetupState)) {
        await completeSetup({
          nextOpenAIKey: trimmedInput,
          nextLangSmithKey: langSmithKey,
          workflowAction: "unchanged",
        });
        return;
      }

      setStep("workflow");
      return;
    }

    if (step === "langsmith") {
      const nextLangSmithKey = input.trim();

      setLangSmithKey(nextLangSmithKey);
      setInput("");

      if (isExistingWorkflowUnchanged(workflowSetupState)) {
        await completeSetup({
          nextOpenAIKey: openAIKey,
          nextLangSmithKey,
          workflowAction: "unchanged",
        });
        return;
      }

      setStep("workflow");
      return;
    }

    const shouldCreateWorkflow = parseWorkflowAnswer(input);

    if (shouldCreateWorkflow === null) {
      setError("Enter yes or no.");
      return;
    }

    await completeSetup({
      nextOpenAIKey: openAIKey,
      nextLangSmithKey: langSmithKey,
      workflowAction: shouldCreateWorkflow ? "create" : "skip",
    });
  }

  type CompleteSetupOptions = {
    nextOpenAIKey: string | null;
    nextLangSmithKey: string | null;
    workflowAction: "create" | "skip" | "unchanged";
  };

  async function completeSetup({
    nextOpenAIKey,
    nextLangSmithKey,
    workflowAction,
  }: CompleteSetupOptions) {
    setIsSaving(true);

    try {
      const updates: Record<string, string> = {};

      if (nextOpenAIKey !== null) {
        updates.OPENAI_API_KEY = nextOpenAIKey;
      }

      if (nextLangSmithKey !== null && nextLangSmithKey.length > 0) {
        updates.LANGSMITH_API_KEY = nextLangSmithKey;
        updates.LANGCHAIN_PROJECT = "openwiki";
        updates.LANGCHAIN_TRACING_V2 = "true";
      }

      if (Object.keys(updates).length > 0) {
        await saveOpenWikiEnv(updates);
      }

      const workflow =
        workflowAction === "create"
          ? await writeOpenWikiUpdateWorkflow()
          : {
              path: openWikiWorkflowPath,
              status:
                workflowAction === "unchanged"
                  ? ("unchanged" as const)
                  : ("skipped" as const),
            };

      onComplete({
        savedOpenAIKey: nextOpenAIKey !== null,
        savedLangSmithKey:
          nextLangSmithKey !== null && nextLangSmithKey.length > 0,
        workflow,
      });
    } catch (saveError) {
      onError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to complete OpenWiki init setup.",
      );
    }
  }

  const needsCredentialPrompt = needsCredentialSetup();
  const workflowStatus =
    workflowSetupState.status === "ready"
      ? workflowSetupState.workflowStatus
      : "missing";

  return (
    <Box flexDirection="column">
      <SetupHeader />

      <Box flexDirection="column" marginBottom={1}>
        <SetupStep
          label="OpenAI key"
          state={
            process.env.OPENAI_API_KEY
              ? "done"
              : step === "openai"
                ? "current"
                : "pending"
          }
          detail={
            process.env.OPENAI_API_KEY
              ? "available from environment"
              : `save to ${openWikiEnvPath}`
          }
        />
        <SetupStep
          label="LangSmith"
          state={
            process.env.LANGSMITH_API_KEY !== undefined
              ? "done"
              : step === "langsmith"
                ? "current"
                : "optional"
          }
          detail={
            process.env.LANGSMITH_API_KEY !== undefined
              ? "available from environment"
              : "optional tracing key"
          }
        />
        <SetupStep
          label="GitHub Action"
          state={
            workflowStatus === "unchanged"
              ? "done"
              : step === "workflow"
                ? "current"
                : "pending"
          }
          detail={openWikiWorkflowPath}
        />
      </Box>

      <SetupPanel title="Prompt">
        {step ? (
          <Prompt step={step} input={input} />
        ) : (
          <Text>Inspecting existing OpenWiki setup...</Text>
        )}
      </SetupPanel>

      {needsCredentialPrompt ? (
        <Text color="gray">Secrets are masked and saved only after setup.</Text>
      ) : null}

      {error ? (
        <SetupPanel title="Error">
          <Text color="red">{error}</Text>
        </SetupPanel>
      ) : null}
      {isSaving ? (
        <SetupPanel title="Saving">
          <Text>Writing OpenWiki setup...</Text>
        </SetupPanel>
      ) : null}
    </Box>
  );
}

function SetupHeader() {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      marginBottom={1}
      paddingX={1}
    >
      <Text>
        <Text bold color="cyan">
          OpenWiki
        </Text>{" "}
        <Text color="gray">init setup</Text>
      </Text>
      <Text>Configure local credentials and scheduled updates.</Text>
    </Box>
  );
}

type SetupStepProps = {
  label: string;
  state: "current" | "done" | "optional" | "pending";
  detail: string;
};

function SetupStep({ label, state, detail }: SetupStepProps) {
  const color =
    state === "done"
      ? "green"
      : state === "current"
        ? "yellow"
        : state === "optional"
          ? "cyan"
          : "gray";

  return (
    <Text>
      <Text color={color}>[{state.toUpperCase()}]</Text>{" "}
      <Text bold>{label.padEnd(14)}</Text> <Text color="gray">{detail}</Text>
    </Text>
  );
}

type SetupPanelProps = {
  title: string;
  children: React.ReactNode;
};

function SetupPanel({ title, children }: SetupPanelProps) {
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      flexDirection="column"
      marginTop={1}
      paddingX={1}
    >
      <Text bold color="cyan">
        {title}
      </Text>
      {children}
    </Box>
  );
}

type PromptProps = {
  step: PromptStep;
  input: string;
};

function Prompt({ step, input }: PromptProps) {
  if (step === "openai") {
    return (
      <Text>
        <Text color="gray">$</Text> OPENAI_API_KEY={" "}
        <Text color="yellow">{mask(input)}</Text>
      </Text>
    );
  }

  if (step === "langsmith") {
    return (
      <Text>
        <Text color="gray">$</Text> LANGSMITH_API_KEY optional={" "}
        <Text color="yellow">{mask(input)}</Text>
      </Text>
    );
  }

  return (
    <Text>
      <Text color="gray">$</Text> Create update GitHub Action?{" "}
      <Text color="cyan">Y/n</Text> {input}
    </Text>
  );
}

function getInitialStep(workflowStatus: WorkflowStatus): PromptStep | null {
  if (!process.env.OPENAI_API_KEY) {
    return "openai";
  }

  if (process.env.LANGSMITH_API_KEY === undefined) {
    return "langsmith";
  }

  if (workflowStatus === "unchanged") {
    return null;
  }

  return "workflow";
}

function isExistingWorkflowUnchanged(
  workflowSetupState: WorkflowSetupState,
): boolean {
  return (
    workflowSetupState.status === "ready" &&
    workflowSetupState.workflowStatus === "unchanged"
  );
}

function parseWorkflowAnswer(value: string): boolean | null {
  const answer = value.trim().toLowerCase();

  if (answer.length === 0 || answer === "y" || answer === "yes") {
    return true;
  }

  if (answer === "n" || answer === "no") {
    return false;
  }

  return null;
}

function mask(value: string): string {
  if (value.length === 0) {
    return "";
  }

  return "*".repeat(value.length);
}
