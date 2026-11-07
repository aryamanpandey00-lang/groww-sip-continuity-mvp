import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSISTANT_RESPONSE_JSON_SCHEMA,
} from "../src/lib/ai/schemas";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../src/lib/ai/config";

export const GROQ_DIAGNOSTIC_MODEL = "openai/gpt-oss-20b";
export const GROQ_DIAGNOSTIC_OUTPUT_LIMIT = 64;
export const GROQ_DIAGNOSTIC_TIMEOUT_MS = 15_000;

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const BASIC_MESSAGE = "Reply with exactly OK.";
const STRICT_MESSAGE = "Return a short answer in the required JSON object.";

export type DiagnosticMode = "basic" | "strict";

export interface DiagnosticOptions {
  mode: DiagnosticMode;
  live: boolean;
}

export interface DiagnosticRequest {
  model: string;
  messages: Array<{ role: "user"; content: string }>;
  max_completion_tokens: number;
  response_format?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: true;
      schema: Record<string, unknown>;
    };
  };
}

export type SafeRequestParameter =
  | "model"
  | "messages"
  | "max_completion_tokens"
  | "response_format"
  | "response_format.json_schema";

export type SafeSchemaKeyword =
  | "additionalProperties"
  | "anyOf"
  | "description"
  | "enum"
  | "items"
  | "maximum"
  | "maxItems"
  | "maxLength"
  | "minimum"
  | "minItems"
  | "minLength"
  | "properties"
  | "required"
  | "type";

export interface SafeProviderDiagnostic {
  httpStatus: number | null;
  errorCategory:
    | "invalid_request"
    | "schema_error"
    | "authentication"
    | "permission_denied"
    | "not_found"
    | "rate_limit"
    | "upstream_error"
    | "sdk_error"
    | "provider_error";
  requestId: string | null;
  providerErrorType?:
    | "invalid_request_error"
    | "authentication_error"
    | "permission_error"
    | "not_found_error"
    | "rate_limit_error"
    | "server_error";
  requestParameter?: SafeRequestParameter;
  schemaKeyword?: SafeSchemaKeyword;
}

export interface DiagnosticShapeSummary {
  topLevelFields: string[];
  messageRoles: string[];
  outputTokenLimit: number;
  strictJsonSchema: boolean;
  schemaKeywords: string[];
}

export interface DiagnosticShapeComparison {
  mode: DiagnosticMode;
  diagnosticRequest: DiagnosticShapeSummary;
  productionAssistantRequest: DiagnosticShapeSummary;
}

export interface DiagnosticClient {
  chat: {
    completions: {
      create(
        request: DiagnosticRequest,
        options: { timeout: number; maxRetries: 0 },
      ): Promise<unknown>;
    };
  };
}

export type DiagnosticClientFactory = (apiKey: string) => DiagnosticClient;

const SAFE_REQUEST_PARAMETERS: readonly SafeRequestParameter[] = [
  "response_format.json_schema",
  "max_completion_tokens",
  "response_format",
  "messages",
  "model",
];

const SAFE_SCHEMA_KEYWORDS: readonly SafeSchemaKeyword[] = [
  "additionalProperties",
  "anyOf",
  "description",
  "enum",
  "items",
  "maximum",
  "maxItems",
  "maxLength",
  "minimum",
  "minItems",
  "minLength",
  "properties",
  "required",
  "type",
];

const SCHEMA_KEYWORDS = new Set<string>([
  ...SAFE_SCHEMA_KEYWORDS,
  "const",
  "default",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "multipleOf",
  "oneOf",
  "pattern",
  "uniqueItems",
]);

const ALLOWED_PROVIDER_ERROR_TYPES = [
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
  "rate_limit_error",
  "server_error",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function property(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function providerParameter(error: unknown): unknown {
  const direct = property(error, "param");
  if (typeof direct === "string") return direct;
  return property(property(error, "error"), "param");
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const nestedMessage = property(property(error, "error"), "message");
  return typeof nestedMessage === "string" ? nestedMessage : "";
}

function requestParameterFromPath(value: string): SafeRequestParameter | undefined {
  return SAFE_REQUEST_PARAMETERS.find((candidate) =>
    value === candidate || value.startsWith(`${candidate}.`),
  );
}

function requestParameterFromMessage(message: string): SafeRequestParameter | undefined {
  if (!/\b(?:parameter|field)\b/i.test(message)) return undefined;

  return SAFE_REQUEST_PARAMETERS.find((candidate) => {
    const token = `(?:^|[^A-Za-z0-9_.])${escapeRegExp(candidate)}(?:$|[^A-Za-z0-9_.])`;
    return new RegExp(token, "i").test(message);
  });
}

function safeRequestParameter(error: unknown): SafeRequestParameter | undefined {
  const parameter = providerParameter(error);
  if (typeof parameter === "string") {
    const recognized = requestParameterFromPath(parameter);
    if (recognized) return recognized;
  }

  return requestParameterFromMessage(messageOf(error));
}

function schemaKeywordFromPath(value: string): SafeSchemaKeyword | undefined {
  const parts = value
    .replaceAll("[", ".")
    .replaceAll("]", ".")
    .replaceAll("/", ".")
    .split(".")
    .filter(Boolean);

  for (const part of parts.reverse()) {
    const keyword = SAFE_SCHEMA_KEYWORDS.find((candidate) => candidate === part);
    if (keyword) return keyword;
  }

  return undefined;
}

function schemaKeywordFromMessage(message: string): SafeSchemaKeyword | undefined {
  if (!/(?:schema|structured output|response_format)/i.test(message)) {
    return undefined;
  }

  return SAFE_SCHEMA_KEYWORDS.find((keyword) => {
    const token = `(?:^|[^A-Za-z0-9_$])${escapeRegExp(keyword)}(?:$|[^A-Za-z0-9_$])`;
    const unsupportedBefore = new RegExp(
      `(?:unsupported|unknown|unrecognized|not supported|not allowed|invalid)[^\\r\\n]{0,100}${token}`,
      "i",
    );
    const unsupportedAfter = new RegExp(
      `${token}[^\\r\\n]{0,100}(?:unsupported|unknown|unrecognized|not supported|not allowed|invalid)`,
      "i",
    );
    const namedKeyword = new RegExp(
      `(?:keyword|constraint)\\s*[:=]?\\s*[\\"'\\x60]?${escapeRegExp(keyword)}(?:$|[^A-Za-z0-9_$])`,
      "i",
    );

    return unsupportedBefore.test(message) ||
      unsupportedAfter.test(message) ||
      namedKeyword.test(message);
  });
}

function safeSchemaKeyword(error: unknown): SafeSchemaKeyword | undefined {
  const parameter = providerParameter(error);
  if (typeof parameter === "string" && parameter.startsWith("response_format.json_schema")) {
    const keyword = schemaKeywordFromPath(parameter);
    if (keyword) return keyword;
  }

  return schemaKeywordFromMessage(messageOf(error));
}

function safeErrorType(error: unknown): SafeProviderDiagnostic["providerErrorType"] {
  const directType = property(error, "type");
  const nestedType = property(property(error, "error"), "type");
  const type = typeof directType === "string" ? directType : nestedType;
  return ALLOWED_PROVIDER_ERROR_TYPES.find((candidate) => candidate === type);
}

function safeRequestId(error: unknown): string | null {
  const requestId = property(error, "requestID");
  return typeof requestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(requestId)
    ? requestId
    : null;
}

function statusOf(error: unknown): number | null {
  const status = property(error, "status");
  return typeof status === "number" &&
      Number.isSafeInteger(status) &&
      status >= 100 &&
      status <= 599
    ? status
    : null;
}

export function sanitizeProviderError(error: unknown): SafeProviderDiagnostic {
  const httpStatus = statusOf(error);
  const requestParameter = safeRequestParameter(error);
  const schemaKeyword = safeSchemaKeyword(error);
  const isSchemaError =
    requestParameter === "response_format" ||
    requestParameter === "response_format.json_schema" ||
    schemaKeyword !== undefined;
  let errorCategory: SafeProviderDiagnostic["errorCategory"] = "provider_error";

  if (httpStatus === null) errorCategory = "sdk_error";
  else if (httpStatus === 400) errorCategory = isSchemaError ? "schema_error" : "invalid_request";
  else if (httpStatus === 401) errorCategory = "authentication";
  else if (httpStatus === 403) errorCategory = "permission_denied";
  else if (httpStatus === 404) errorCategory = "not_found";
  else if (httpStatus === 429) errorCategory = "rate_limit";
  else if (httpStatus >= 500) errorCategory = "upstream_error";

  const providerErrorType = safeErrorType(error);
  const requestId = safeRequestId(error);

  return {
    httpStatus,
    errorCategory,
    requestId,
    ...(providerErrorType ? { providerErrorType } : {}),
    ...(requestParameter ? { requestParameter } : {}),
    ...(schemaKeyword ? { schemaKeyword } : {}),
  };
}

export function parseDiagnosticArgs(args: string[]): DiagnosticOptions {
  let mode: DiagnosticMode | undefined;
  let live = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--live") {
      if (live) throw new Error("duplicate_live_flag");
      live = true;
      continue;
    }

    if (argument === "--mode") {
      if (mode) throw new Error("duplicate_mode");
      const value = args[index + 1];
      if (value !== "basic" && value !== "strict") {
        throw new Error("invalid_mode");
      }
      mode = value;
      index += 1;
      continue;
    }

    throw new Error("invalid_argument");
  }

  if (!mode) throw new Error("missing_mode");
  return { mode, live };
}

export function buildDiagnosticRequest(mode: DiagnosticMode): DiagnosticRequest {
  const request: DiagnosticRequest = {
    model: GROQ_DIAGNOSTIC_MODEL,
    messages: [{
      role: "user",
      content: mode === "basic" ? BASIC_MESSAGE : STRICT_MESSAGE,
    }],
    max_completion_tokens: GROQ_DIAGNOSTIC_OUTPUT_LIMIT,
  };

  if (mode === "strict") {
    request.response_format = {
      type: "json_schema",
      json_schema: {
        name: "groq_minimal_schema_diagnostic",
        strict: true,
        schema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
          additionalProperties: false,
        },
      },
    };
  }

  return request;
}

function collectSchemaKeywords(value: unknown, result = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaKeywords(item, result);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (SCHEMA_KEYWORDS.has(key)) result.add(key);
      collectSchemaKeywords(item, result);
    }
  }

  return [...result].sort();
}

function summarizeRequest(request: DiagnosticRequest): DiagnosticShapeSummary {
  return {
    topLevelFields: Object.keys(request).sort(),
    messageRoles: request.messages.map(({ role }) => role),
    outputTokenLimit: request.max_completion_tokens,
    strictJsonSchema: request.response_format?.json_schema.strict === true,
    schemaKeywords: request.response_format
      ? collectSchemaKeywords(request.response_format.json_schema.schema)
      : [],
  };
}

export function buildShapeComparison(mode: DiagnosticMode): DiagnosticShapeComparison {
  const diagnosticRequest = buildDiagnosticRequest(mode);
  return {
    mode,
    diagnosticRequest: summarizeRequest(diagnosticRequest),
    productionAssistantRequest: {
      topLevelFields: [
        "model",
        "messages",
        "max_completion_tokens",
        "response_format",
      ].sort(),
      messageRoles: ["system", "user"],
      outputTokenLimit: DEFAULT_MAX_OUTPUT_TOKENS,
      strictJsonSchema: true,
      schemaKeywords: collectSchemaKeywords(ASSISTANT_RESPONSE_JSON_SCHEMA),
    },
  };
}

export function createSdkClient(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): DiagnosticClient {
  const client = new OpenAI({
    apiKey,
    baseURL: GROQ_BASE_URL,
    timeout: GROQ_DIAGNOSTIC_TIMEOUT_MS,
    maxRetries: 0,
    fetch: fetchImpl,
  });
  return client as unknown as DiagnosticClient;
}

function safeResponseRequestId(response: unknown): string | null {
  const requestId = property(response, "_request_id");
  return typeof requestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(requestId)
    ? requestId
    : null;
}

export async function runGroqChatDiagnostic(
  options: DiagnosticOptions,
  env: Record<string, string | undefined> = process.env,
  clientFactory: DiagnosticClientFactory = createSdkClient,
): Promise<Record<string, unknown>> {
  const comparison = buildShapeComparison(options.mode);

  if (!options.live) {
    return {
      ok: true,
      live: false,
      providerCallAttempted: false,
      mode: options.mode,
      model: GROQ_DIAGNOSTIC_MODEL,
      comparison,
    };
  }

  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      live: true,
      providerCallAttempted: false,
      mode: options.mode,
      error: "missing_groq_api_key",
      comparison,
    };
  }

  const client = clientFactory(apiKey);
  const request = buildDiagnosticRequest(options.mode);
  const providerCallAttempted = true;

  try {
    const response = await client.chat.completions.create(request, {
      timeout: GROQ_DIAGNOSTIC_TIMEOUT_MS,
      maxRetries: 0,
    });

    return {
      ok: true,
      live: true,
      providerCallAttempted,
      accepted: true,
      mode: options.mode,
      model: GROQ_DIAGNOSTIC_MODEL,
      httpStatus: 200,
      requestId: safeResponseRequestId(response),
      comparison,
    };
  } catch (error) {
    return {
      ok: false,
      live: true,
      providerCallAttempted,
      accepted: false,
      mode: options.mode,
      model: GROQ_DIAGNOSTIC_MODEL,
      providerDiagnostic: sanitizeProviderError(error),
      comparison,
    };
  }
}

async function main(): Promise<void> {
  let options: DiagnosticOptions;
  try {
    options = parseDiagnosticArgs(process.argv.slice(2));
  } catch {
    console.error(JSON.stringify({
      ok: false,
      error: "invalid_arguments",
      usage: "npm run groq:diagnostic -- --mode <basic|strict> [--live]",
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const result = await runGroqChatDiagnostic(options);
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true) process.exitCode = 1;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && path.resolve(entry) === fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  void main().catch(() => {
    console.error(JSON.stringify({ ok: false, error: "diagnostic_failed" }));
    process.exitCode = 1;
  });
}
