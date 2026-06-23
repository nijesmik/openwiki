import { initChatModel } from "langchain/chat_models/universal";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { loadOpenWikiEnv } from "../env.js";
import { createSystemPrompt, createUserPrompt } from "./prompt.js";
import type {
  OpenWikiCommand,
  OpenWikiRunEvent,
  OpenWikiRunOptions,
  OpenWikiRunResult,
} from "./types.js";
import {
  MODEL_NAME,
  OPENAI_RESPONSES_API_URL,
  OPENAI_RESPONSES_CLIENT_BASE_URL,
} from "../constants.js";
import { createRunContext, writeLastUpdateMetadata } from "./utils.js";

export async function runOpenWikiAgent(
  command: OpenWikiCommand,
  cwd = process.cwd(),
  options: OpenWikiRunOptions = {},
): Promise<OpenWikiRunResult> {
  emitDebug(options, `command=${command}`);
  emitDebug(options, `cwd=${cwd}`);
  emitDebug(options, `model=${MODEL_NAME}`);
  emitDebug(
    options,
    "openai=modelProvider=openai useResponsesApi=true reasoning.effort=medium",
  );
  emitDebug(
    options,
    `openai.clientBaseUrl=${JSON.stringify(OPENAI_RESPONSES_CLIENT_BASE_URL)}`,
  );
  emitDebug(options, `env.beforeLoad ${formatEnvironmentDebug()}`);

  await loadOpenWikiEnv();
  emitDebug(options, "env=loaded ~/.openwiki/.env");
  emitDebug(options, `env.afterLoad ${formatEnvironmentDebug()}`);
  forceOpenAIResponsesApiUrl(options);
  emitDebug(options, `env.afterForce ${formatEnvironmentDebug()}`);
  ensureOpenAIKey();
  emitDebug(options, "credentials=openai key present");

  const context = await createRunContext(command, cwd);
  emitDebug(options, "context=created");
  const model = await createModel();
  emitDebug(options, "model=initialized");
  const agent = createDeepAgent({
    model,
    tools: [],
    backend: new FilesystemBackend({
      rootDir: cwd,
      virtualMode: true,
    }),
    systemPrompt: createSystemPrompt(command),
  });
  emitDebug(options, "agent=created");

  const input = {
    messages: [
      {
        role: "user",
        content: createUserPrompt(command, context),
      },
    ],
  };

  emitDebug(options, "stream=opening modes=messages,tools subgraphs=true");
  const stream = await agent.stream(input, {
    streamMode: ["messages", "tools"],
    subgraphs: true,
  });
  emitDebug(options, "stream=started modes=messages,tools subgraphs=true");

  for await (const chunk of stream) {
    const event = parseStreamEvent(chunk);

    if (event) {
      options.onEvent?.(event);
    }
  }
  emitDebug(options, "stream=completed");

  await writeLastUpdateMetadata(command, cwd);
  emitDebug(options, "metadata=written");

  return {
    command,
    model: MODEL_NAME,
  };
}

function emitDebug(options: OpenWikiRunOptions, message: string): void {
  if (!options.debug) {
    return;
  }

  options.onEvent?.({
    type: "debug",
    message,
  });
}

function ensureOpenAIKey(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run the OpenWiki agent.");
  }
}

function forceOpenAIResponsesApiUrl(options: OpenWikiRunOptions): void {
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = OPENAI_RESPONSES_API_URL;

  emitDebug(
    options,
    `openai.responsesApiUrl=${JSON.stringify(OPENAI_RESPONSES_API_URL)}`,
  );

  if (
    previousBaseUrl !== undefined &&
    previousBaseUrl !== OPENAI_RESPONSES_API_URL
  ) {
    emitDebug(
      options,
      `openai.baseUrlOverridden from ${formatUrlDebugValue(
        previousBaseUrl,
      )} to ${formatUrlDebugValue(OPENAI_RESPONSES_API_URL)}`,
    );
  }
}

async function createModel() {
  return initChatModel(MODEL_NAME, {
    modelProvider: "openai",
    useResponsesApi: true,
    configuration: {
      baseURL: OPENAI_RESPONSES_CLIENT_BASE_URL,
    },
    reasoning: {
      effort: "medium",
    },
  });
}

function parseStreamEvent(chunk: unknown): OpenWikiRunEvent | null {
  if (!Array.isArray(chunk) || chunk.length < 2) {
    return null;
  }

  const [mode, payload] = normalizeStreamChunk(chunk);

  if (mode === "messages") {
    const text = extractMessageText(payload);

    return text.length > 0
      ? {
          type: "text",
          text,
        }
      : null;
  }

  if (mode === "tools") {
    const toolCall = formatToolStart(payload);

    return toolCall
      ? {
          type: "tool_call",
          call: toolCall,
        }
      : null;
  }

  return null;
}

function normalizeStreamChunk(chunk: unknown[]): [unknown, unknown] {
  if (Array.isArray(chunk[0]) && chunk.length >= 3) {
    return [chunk[1], chunk[2]];
  }

  return [chunk[0], chunk[1]];
}

function extractMessageText(payload: unknown): string {
  if (Array.isArray(payload)) {
    const [message] = payload;
    return extractContentText(getRecordValue(message, "content"));
  }

  return extractContentText(getRecordValue(payload, "content"));
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content.map(extractContentBlockText).join("");
}

function extractContentBlockText(block: unknown): string {
  if (typeof block === "string") {
    return block;
  }

  if (!isRecord(block)) {
    return "";
  }

  const text = block.text ?? block.content;

  return typeof text === "string" ? text : "";
}

function formatToolStart(payload: unknown): string | null {
  if (!isRecord(payload) || payload.event !== "on_tool_start") {
    return null;
  }

  const name = typeof payload.name === "string" ? payload.name : "tool";

  return `${name}(${formatToolArgs(payload.input)})`;
}

function formatToolArgs(input: unknown): string {
  const value = parseStringifiedJson(input);

  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, argValue]) => `${key}=${formatToolValue(argValue)}`)
      .join(", ");
  }

  if (Array.isArray(value)) {
    return value.map(formatToolValue).join(", ");
  }

  if (value === undefined || value === null) {
    return "";
  }

  return formatToolValue(value);
}

function formatToolValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return JSON.stringify(value) ?? String(value);
}

function parseStringifiedJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getRecordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatEnvironmentDebug(): string {
  const keys = [
    "OPENAI_BASE_URL",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT",
    "LANGCHAIN_TRACING_V2",
    "LANGCHAIN_PROJECT",
    "LANGCHAIN_ENDPOINT",
  ];

  return keys
    .map((key) => `${key}:${formatDebugValue(key, process.env[key])}`)
    .join(" ");
}

function formatDebugValue(key: string, value: string | undefined): string {
  if (value === undefined) {
    return "unset";
  }

  if (key === "OPENAI_BASE_URL" || key === "LANGCHAIN_ENDPOINT") {
    return formatUrlDebugValue(value);
  }

  if (value.length <= 10) {
    return `set(length=${value.length})`;
  }

  return `set(length=${value.length}, preview=${JSON.stringify(
    `${value.slice(0, 6)}...${value.slice(-4)}`,
  )})`;
}

function formatUrlDebugValue(value: string): string {
  try {
    const url = new URL(value);
    const redacted: string[] = [];

    if (url.username || url.password) {
      redacted.push("auth");
      url.username = "";
      url.password = "";
    }

    if (url.search) {
      redacted.push("query");
      url.search = "";
    }

    if (url.hash) {
      redacted.push("hash");
      url.hash = "";
    }

    const redactionSuffix =
      redacted.length > 0 ? `, redacted=${redacted.join("+")}` : "";

    return `set(url=${JSON.stringify(url.toString())}${redactionSuffix})`;
  } catch {
    return `set(length=${value.length}, preview=${JSON.stringify(
      `${value.slice(0, 6)}...${value.slice(-4)}`,
    )})`;
  }
}
