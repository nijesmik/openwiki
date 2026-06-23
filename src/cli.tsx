#!/usr/bin/env node
import React, { useEffect, useRef, useState } from "react";
import { Box, render, Text, useApp } from "ink";
import {
  helpContent,
  isDevelopmentMode,
  parseCommand,
  type CliCommand,
  type HelpRow,
} from "./commands.js";
import { InitSetup, type InitSetupResult } from "./credentials.js";
import {
  getCredentialDiagnostics,
  loadOpenWikiEnv,
  type CredentialDiagnostic,
} from "./env.js";
import { runOpenWikiAgent } from "./agent/index.js";
import {
  type OpenWikiRunEvent,
  type OpenWikiRunResult,
} from "./agent/types.js";

type RunState =
  | { status: "idle" }
  | { status: "init-setup-saved"; result: InitSetupResult }
  | {
      status: "running";
      command: "init" | "update";
      log: RunLogItem[];
      credentialDiagnostics?: CredentialDiagnostic[];
    }
  | {
      status: "success";
      result: OpenWikiRunResult;
      log: RunLogItem[];
      credentialDiagnostics?: CredentialDiagnostic[];
    }
  | {
      status: "error";
      message: string;
      credentialDiagnostics?: CredentialDiagnostic[];
      errorDiagnostics?: ErrorDiagnostic[];
    };

type RunLogItem = {
  id: number;
  type: OpenWikiRunEvent["type"];
  content: string;
};

type ErrorDiagnostic = {
  label: string;
  value: string;
};

type AppProps = {
  command: CliCommand;
};

function App({ command }: AppProps) {
  const app = useApp();
  const nextLogId = useRef(1);
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const shouldRunInteractiveInitSetup =
    command.kind === "init" &&
    !command.dryRun &&
    process.stdin.isTTY &&
    runState.status === "idle";

  useEffect(() => {
    if (command.kind === "help" || command.kind === "error") {
      process.exitCode = command.exitCode;
      app.exit();
      return;
    }

    if (command.dryRun) {
      process.exitCode = 0;
      app.exit();
      return;
    }

    if (shouldRunInteractiveInitSetup) {
      return;
    }

    let isMounted = true;

    setRunState({
      status: "running",
      command: command.kind,
      log: [],
    });

    if (shouldShowCredentialDiagnostics()) {
      void getCredentialDiagnostics()
        .catch(() => undefined)
        .then((credentialDiagnostics) => {
          if (!isMounted || !credentialDiagnostics) {
            return;
          }

          setRunState((currentState) =>
            currentState.status === "running"
              ? {
                  ...currentState,
                  credentialDiagnostics,
                }
              : currentState,
          );
        });
    }

    runOpenWikiAgent(command.kind, process.cwd(), {
      debug: isDebugMode(),
      onEvent: (event) => {
        if (!isMounted) {
          return;
        }

        setRunState((currentState) =>
          appendRunEvent(currentState, event, nextLogId),
        );
      },
    })
      .then((result) => {
        if (!isMounted) {
          return;
        }

        setRunState((currentState) => ({
          status: "success",
          result,
          log: currentState.status === "running" ? currentState.log : [],
          credentialDiagnostics:
            currentState.status === "running"
              ? currentState.credentialDiagnostics
              : undefined,
        }));
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        const errorDiagnostics = getErrorDiagnostics(error);
        const message = getErrorMessage(error);

        void getCredentialDiagnostics()
          .catch(() => undefined)
          .then((credentialDiagnostics) => {
            if (!isMounted) {
              return;
            }

            setRunState({
              status: "error",
              message,
              credentialDiagnostics,
              errorDiagnostics,
            });
          });
      });

    return () => {
      isMounted = false;
    };
  }, [app, command, shouldRunInteractiveInitSetup]);

  useEffect(() => {
    if (runState.status === "success") {
      process.exitCode = 0;
      app.exit();
      return;
    }

    if (runState.status === "error") {
      process.exitCode = 1;
      app.exit();
    }
  }, [app, runState.status]);

  if (command.kind === "help") {
    return <HelpView />;
  }

  if (command.kind === "error") {
    return (
      <Box flexDirection="column">
        <Header subtitle="Command failed" />
        <StatusLine tone="error" label="Error" value={command.message} />
        <HelpView />
      </Box>
    );
  }

  if (command.dryRun) {
    return <DryRunView command={command.kind} />;
  }

  if (shouldRunInteractiveInitSetup) {
    return (
      <InitSetup
        onComplete={(result) => {
          setRunState({ status: "init-setup-saved", result });
        }}
        onError={(message) => {
          setRunState({ status: "error", message });
        }}
      />
    );
  }

  if (runState.status === "init-setup-saved") {
    return (
      <Box flexDirection="column">
        <Header subtitle="Initialization setup" />
        {runState.result.savedOpenAIKey || runState.result.savedLangSmithKey ? (
          <StatusLine tone="success" label="Credentials" value="saved" />
        ) : null}
        <StatusLine
          tone={
            runState.result.workflow.status === "skipped" ? "muted" : "success"
          }
          label="Workflow"
          value={formatWorkflowSetup(runState.result)}
        />
        <StatusLine tone="active" label="Next" value="starting openwiki init" />
      </Box>
    );
  }

  if (runState.status === "running") {
    return (
      <RunView
        command={runState.command}
        credentialDiagnostics={runState.credentialDiagnostics}
        log={runState.log}
      />
    );
  }

  if (runState.status === "success") {
    return (
      <Box flexDirection="column">
        <RunView
          command={runState.result.command}
          credentialDiagnostics={runState.credentialDiagnostics}
          log={runState.log}
          done
        />
        <StatusLine
          tone="success"
          label="Complete"
          value={`openwiki ${runState.result.command} with ${runState.result.model}`}
        />
        <StatusLine tone="muted" label="Output" value="openwiki/" />
      </Box>
    );
  }

  if (runState.status === "error") {
    return (
      <Box flexDirection="column">
        <Header subtitle="Run failed" />
        <StatusLine tone="error" label="Error" value={runState.message} />
        {runState.credentialDiagnostics ? (
          <CredentialDiagnosticsPanel
            diagnostics={runState.credentialDiagnostics}
          />
        ) : null}
        {runState.errorDiagnostics && runState.errorDiagnostics.length > 0 ? (
          <ErrorDiagnosticsPanel diagnostics={runState.errorDiagnostics} />
        ) : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header subtitle="Starting" />
    </Box>
  );
}

function formatWorkflowSetup(result: InitSetupResult): string {
  if (result.workflow.status === "created") {
    return `GitHub Action created: ${result.workflow.path}`;
  }

  if (result.workflow.status === "unchanged") {
    return `GitHub Action already exists: ${result.workflow.path}`;
  }

  return "GitHub Action creation skipped.";
}

function HelpView() {
  return (
    <Box flexDirection="column">
      <Header subtitle={helpContent.description} />

      <Panel title="Usage">
        {helpContent.usage.map((line) => (
          <Text key={line}> {line}</Text>
        ))}
      </Panel>

      <Panel title="Commands">
        <Rows rows={helpContent.commands} />
      </Panel>

      {isDevelopmentMode() ? (
        <Panel title="Development Options">
          <Rows rows={helpContent.developmentOptions} />
        </Panel>
      ) : null}

      <Panel title="Examples">
        {helpContent.examples.map((line) => (
          <Text key={line}> {line}</Text>
        ))}
        {isDevelopmentMode()
          ? helpContent.developmentExamples.map((line) => (
              <Text key={line}> {line}</Text>
            ))
          : null}
      </Panel>
    </Box>
  );
}

function DryRunView({ command }: { command: "init" | "update" }) {
  return (
    <Box flexDirection="column">
      <Header subtitle="Development dry run" />
      <Panel title="Execution Plan">
        <StatusLine
          tone="active"
          label="Command"
          value={`openwiki ${command}`}
        />
        <StatusLine
          tone="muted"
          label="Credentials"
          value="not read or requested"
        />
        <StatusLine tone="muted" label="Agent" value="not invoked" />
        <StatusLine tone="muted" label="Writes" value="no files or metadata" />
        <StatusLine tone="muted" label="Output" value="openwiki/" />
      </Panel>
    </Box>
  );
}

function CredentialDiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: CredentialDiagnostic[];
}) {
  return (
    <Panel title="Credential Diagnostics">
      <Text color="gray">Raw secret values are intentionally not printed.</Text>
      {diagnostics.map((diagnostic) => (
        <Box flexDirection="column" key={diagnostic.key} marginTop={1}>
          <Text>
            <Text bold>{diagnostic.key}</Text>{" "}
            <Text color="gray">source={diagnostic.source}</Text>
          </Text>
          <Text>
            length={diagnostic.length ?? "unset"} preview={diagnostic.preview}
          </Text>
          <Text color={diagnostic.warnings.length > 0 ? "yellow" : "gray"}>
            warnings=
            {diagnostic.warnings.length > 0
              ? diagnostic.warnings.join(", ")
              : "none"}
          </Text>
        </Box>
      ))}
    </Panel>
  );
}

function ErrorDiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: ErrorDiagnostic[];
}) {
  return (
    <Panel title="Error Diagnostics">
      <Text color="gray">
        OPENWIKI_DEBUG=1 is enabled. Only allowlisted, non-secret error fields
        are shown.
      </Text>
      {diagnostics.map((diagnostic) => (
        <Text key={diagnostic.label}>
          <Text bold>{diagnostic.label}</Text> {diagnostic.value}
        </Text>
      ))}
    </Panel>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <Box
      borderStyle="single"
      borderColor="cyan"
      flexDirection="column"
      marginBottom={1}
      paddingX={1}
    >
      <Text>
        <Text bold color="cyan">
          OpenWiki
        </Text>{" "}
        <Text color="gray">agent documentation CLI</Text>
      </Text>
      <Text>{subtitle}</Text>
    </Box>
  );
}

type StatusLineProps = {
  tone: "active" | "error" | "muted" | "success";
  label: string;
  value: string;
};

function StatusLine({ tone, label, value }: StatusLineProps) {
  const color =
    tone === "success"
      ? "green"
      : tone === "error"
        ? "red"
        : tone === "active"
          ? "yellow"
          : "gray";

  return (
    <Text>
      <Text color={color}>{"["}</Text>
      <Text bold color={color}>
        {label.toUpperCase()}
      </Text>
      <Text color={color}>{"]"}</Text>{" "}
      <Text color={tone === "muted" ? "gray" : undefined}>{value}</Text>
    </Text>
  );
}

type RunViewProps = {
  command: "init" | "update";
  credentialDiagnostics?: CredentialDiagnostic[];
  log: RunLogItem[];
  done?: boolean;
};

function RunView({
  command,
  credentialDiagnostics,
  log,
  done = false,
}: RunViewProps) {
  return (
    <Box flexDirection="column">
      <Header subtitle={done ? "Run complete" : "Agent running"} />
      <Box flexDirection="row" gap={1} marginBottom={1}>
        <Box
          borderStyle="single"
          borderColor={done ? "green" : "yellow"}
          flexDirection="column"
          paddingX={1}
          width={26}
        >
          <Text bold color={done ? "green" : "yellow"}>
            STATUS
          </Text>
          <Text>{done ? "complete" : "running"}</Text>
        </Box>
        <Box
          borderStyle="single"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
          width={34}
        >
          <Text bold color="cyan">
            COMMAND
          </Text>
          <Text>openwiki {command}</Text>
        </Box>
        <Box
          borderStyle="single"
          borderColor="gray"
          flexDirection="column"
          paddingX={1}
          width={22}
        >
          <Text bold color="cyan">
            EVENTS
          </Text>
          <Text>{log.length}</Text>
        </Box>
      </Box>
      <Panel title="Stream">
        {log.length > 0 ? (
          log.map((item) => <RunLogLine item={item} key={item.id} />)
        ) : (
          <Text color="gray">Waiting for model output...</Text>
        )}
      </Panel>
      {credentialDiagnostics ? (
        <CredentialDiagnosticsPanel diagnostics={credentialDiagnostics} />
      ) : null}
    </Box>
  );
}

function RunLogLine({ item }: { item: RunLogItem }) {
  if (item.type === "tool_call") {
    const content = truncateLogOutput(item.content, "[TOOL]");

    return (
      <Text>
        <Text color="magenta">[TOOL]</Text> <Text color="gray">{content}</Text>
      </Text>
    );
  }

  if (item.type === "debug") {
    return (
      <Text>
        <Text color="yellow">[DEBUG]</Text>{" "}
        <Text color="gray">{item.content}</Text>
      </Text>
    );
  }

  const content = truncateLogOutput(item.content, "[ASSISTANT]");

  return (
    <Text>
      <Text color="cyan">[ASSISTANT]</Text> {content}
    </Text>
  );
}

function appendRunEvent(
  state: RunState,
  event: OpenWikiRunEvent,
  nextLogId: React.MutableRefObject<number>,
): RunState {
  if (state.status !== "running") {
    return state;
  }

  if (event.type === "text" && event.text.length === 0) {
    return state;
  }

  const log = [...state.log];
  const content =
    event.type === "text"
      ? event.text
      : event.type === "tool_call"
        ? event.call
        : event.message;
  const previous = log.at(-1);

  if (event.type === "text" && previous?.type === "text") {
    log[log.length - 1] = {
      ...previous,
      content: `${previous.content}${content}`,
    };
  } else {
    log.push({
      id: nextLogId.current,
      type: event.type,
      content,
    });
    nextLogId.current += 1;
  }

  return {
    ...state,
    log,
  };
}

function truncateLogOutput(content: string, label: string): string {
  const terminalColumns = process.stdout.columns ?? 80;
  const availableColumns = Math.max(24, terminalColumns - label.length - 7);

  return truncateToDisplayLines(content, 2, availableColumns);
}

function truncateToDisplayLines(
  content: string,
  maxLines: number,
  maxColumns: number,
): string {
  const normalizedContent = content.replace(/\s+/gu, " ").trim();

  if (normalizedContent.length <= maxColumns) {
    return normalizedContent;
  }

  const lines: string[] = [];
  let remaining = normalizedContent;

  while (remaining.length > 0 && lines.length < maxLines) {
    lines.push(remaining.slice(0, maxColumns));
    remaining = remaining.slice(maxColumns);
  }

  if (remaining.length > 0 && lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    lines[lines.length - 1] =
      lastLine.length > 3 ? `${lastLine.slice(0, -3)}...` : "...";
  }

  return lines.join("\n");
}

function isDebugMode(): boolean {
  return process.env.OPENWIKI_DEBUG === "1";
}

function shouldShowCredentialDiagnostics(): boolean {
  return isDebugMode() || process.env.OPENWIKI_DEBUG_CREDENTIALS === "1";
}

function getErrorDiagnostics(error: unknown): ErrorDiagnostic[] {
  if (!isDebugMode()) {
    return [];
  }

  const diagnostics: ErrorDiagnostic[] = [];

  if (error instanceof Error) {
    diagnostics.push(
      { label: "name", value: error.name },
      { label: "message", value: sanitizeDiagnosticText(error.message) },
    );

    const messageStatus = error.message.match(/\b([45]\d{2})\b/)?.[1];

    if (messageStatus) {
      diagnostics.push({
        label: "httpStatusFromMessage",
        value: messageStatus,
      });
    }
  }

  if (!isRecord(error)) {
    return diagnostics;
  }

  addSafeObjectDiagnostics(diagnostics, error, "");
  addSafeNestedDiagnostics(diagnostics, error, "cause");
  addSafeNestedDiagnostics(diagnostics, error, "error");
  addSafeNestedDiagnostics(diagnostics, error, "response");

  return dedupeDiagnostics(diagnostics);
}

function addSafeNestedDiagnostics(
  diagnostics: ErrorDiagnostic[],
  value: Record<string, unknown>,
  key: string,
): void {
  const nested = value[key];

  if (!isRecord(nested)) {
    return;
  }

  addSafeObjectDiagnostics(diagnostics, nested, key);
}

function addSafeObjectDiagnostics(
  diagnostics: ErrorDiagnostic[],
  value: Record<string, unknown>,
  prefix: string,
): void {
  for (const key of [
    "status",
    "statusCode",
    "statusText",
    "code",
    "type",
    "param",
    "request_id",
    "requestID",
    "lc_error_code",
  ]) {
    const property = value[key];

    if (isDiagnosticValue(property)) {
      diagnostics.push({
        label: prefix ? `${prefix}.${key}` : key,
        value: sanitizeDiagnosticText(String(property)),
      });
    }
  }

  addSafeHeaderDiagnostics(diagnostics, value.headers, prefix);
}

function addSafeHeaderDiagnostics(
  diagnostics: ErrorDiagnostic[],
  headers: unknown,
  prefix: string,
): void {
  if (!isRecord(headers)) {
    return;
  }

  for (const key of [
    "x-request-id",
    "request-id",
    "openai-processing-ms",
    "cf-ray",
  ]) {
    const value = getHeaderValue(headers, key);

    if (isDiagnosticValue(value)) {
      diagnostics.push({
        label: prefix ? `${prefix}.header.${key}` : `header.${key}`,
        value: sanitizeDiagnosticText(String(value)),
      });
    }
  }
}

function getHeaderValue(
  headers: Record<string, unknown>,
  key: string,
): unknown {
  if (key in headers) {
    return headers[key];
  }

  const matchingKey = Object.keys(headers).find(
    (headerKey) => headerKey.toLowerCase() === key,
  );

  return matchingKey ? headers[matchingKey] : undefined;
}

function dedupeDiagnostics(diagnostics: ErrorDiagnostic[]): ErrorDiagnostic[] {
  const seen = new Set<string>();
  const deduped: ErrorDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.label}:${diagnostic.value}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(diagnostic);
  }

  return deduped;
}

function isDiagnosticValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "OpenWiki agent run failed.";

  return sanitizeDiagnosticText(message);
}

function sanitizeDiagnosticText(value: string): string {
  let sanitized = value;

  for (const key of ["OPENAI_API_KEY", "LANGSMITH_API_KEY"]) {
    const secret = process.env[key];

    if (secret && secret.length > 0) {
      sanitized = sanitized.split(secret).join(`[REDACTED:${key}]`);
    }
  }

  return sanitized
    .replace(
      /(Incorrect API key provided:\s*)([^\s.]+)/giu,
      "$1[REDACTED:OPENAI_API_KEY]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/gu, "[REDACTED:OPENAI_API_KEY]")
    .replace(/\bls[v_][A-Za-z0-9_-]+/gu, "[REDACTED:LANGSMITH_API_KEY]");
}

type PanelProps = {
  title: string;
  children: React.ReactNode;
};

function Panel({ title, children }: PanelProps) {
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      flexDirection="column"
      marginBottom={1}
      paddingX={1}
    >
      <Text bold color="cyan">
        {title}
      </Text>
      {children}
    </Box>
  );
}

type RowsProps = {
  rows: HelpRow[];
};

function Rows({ rows }: RowsProps) {
  const labelWidth = Math.max(...rows.map((row) => row.label.length));

  return (
    <>
      {rows.map((row) => (
        <Text key={row.label}>
          {"  "}
          {row.label.padEnd(labelWidth)}
          {"  "}
          {row.description}
        </Text>
      ))}
    </>
  );
}

const parsedCommand = parseCommand(process.argv.slice(2));

if (
  (parsedCommand.kind === "init" || parsedCommand.kind === "update") &&
  !parsedCommand.dryRun
) {
  await loadOpenWikiEnv();
}

const command = resolveStartupCommand(parsedCommand);

render(<App command={command} />);

function resolveStartupCommand(command: CliCommand): CliCommand {
  if (
    command.kind === "update" &&
    !command.dryRun &&
    !process.env.OPENAI_API_KEY
  ) {
    return {
      kind: "error",
      exitCode: 1,
      message: "OPENAI_API_KEY is required to run the OpenWiki agent.",
    };
  }

  if (
    command.kind === "init" &&
    !command.dryRun &&
    !process.env.OPENAI_API_KEY &&
    !process.stdin.isTTY
  ) {
    return {
      kind: "error",
      exitCode: 1,
      message:
        "OPENAI_API_KEY is required for non-interactive init. Run openwiki init in an interactive terminal to save credentials.",
    };
  }

  return command;
}
