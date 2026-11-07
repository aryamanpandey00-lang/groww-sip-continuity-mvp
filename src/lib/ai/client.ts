import "server-only";

import OpenAI from "openai";
import type {
  AssistantConfig,
  AssistantModelCallResult,
  AssistantModelClient,
  AssistantModelRequest,
  AssistantNetworkFamily,
  AssistantProviderErrorType,
  AssistantProviderDiagnostic,
  AssistantProviderRequestParameter,
  AssistantSchemaKeyword,
  AssistantTransportCause,
} from "./types";
import {
  MAX_MAX_OUTPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS,
} from "./config";
import {
  ASSISTANT_RESPONSE_FORMAT_NAME,
  ASSISTANT_RESPONSE_JSON_SCHEMA,
} from "./schemas";
import { normalizeAssistantTokenUsage } from "./token-budget";

function errorStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return null;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return "";
}

function errorParameter(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "param" in error &&
    typeof error.param === "string"
  ) {
    return error.param;
  }

  return "";
}

function errorType(error: unknown): string {
  const record = recordOf(error);
  if (typeof record?.type === "string") return record.type;

  const nestedError = recordOf(record?.error);
  return typeof nestedError?.type === "string" ? nestedError.type : "";
}

function safeProviderErrorType(
  error: unknown,
): AssistantProviderErrorType | undefined {
  const allowedTypes: readonly AssistantProviderErrorType[] = [
    "invalid_request_error",
    "authentication_error",
    "permission_error",
    "not_found_error",
    "rate_limit_error",
    "server_error",
  ];
  const type = errorType(error);
  return allowedTypes.find((allowed) => allowed === type);
}

const SAFE_REQUEST_PARAMETERS: readonly AssistantProviderRequestParameter[] = [
  "response_format.json_schema",
  "max_completion_tokens",
  "response_format",
  "messages",
  "max_tokens",
  "model",
  "temperature",
  "top_p",
  "n",
  "stop",
  "stream",
  "tools",
  "tool_choice",
];

function safeRequestParameter(
  parameter: string,
): AssistantProviderRequestParameter | undefined {

  if (parameter === "response_format.json_schema" ||
      parameter.startsWith("response_format.json_schema.")) {
    return "response_format.json_schema";
  }

  return SAFE_REQUEST_PARAMETERS.find((allowed) =>
    parameter === allowed || parameter.startsWith(`${allowed}.`),
  );
}

function safeRequestParameterFromError(
  error: unknown,
): AssistantProviderRequestParameter | undefined {
  const parameter = safeRequestParameter(errorParameter(error));
  if (parameter) return parameter;

  const message = error instanceof Error ? error.message : "";
  if (!/(?:parameter|field)/i.test(message)) return undefined;

  return SAFE_REQUEST_PARAMETERS.find((candidate) => {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const token = `(?:^|[^A-Za-z0-9_.])${escaped}(?:$|[^A-Za-z0-9_.])`;
    const parameterReference = new RegExp(
      `(?:parameter|field)[^\\r\\n]{0,80}${token}`,
      "i",
    );
    return parameterReference.test(message);
  });
}

const SAFE_SCHEMA_KEYWORDS: readonly AssistantSchemaKeyword[] = [
  "additionalProperties",
  "anyOf",
  "const",
  "default",
  "description",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "multipleOf",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "type",
  "uniqueItems",
];

function safeSchemaKeyword(error: unknown): AssistantSchemaKeyword | undefined {
  const parameter = errorParameter(error);
  if (parameter.startsWith("response_format.json_schema.")) {
    const path = parameter
      .replaceAll("[", ".")
      .replaceAll("]", ".")
      .replaceAll("/", ".")
      .split(".")
      .filter(Boolean)
      .reverse();
    const finalPathPart = path[0];
    if (finalPathPart) {
      return SAFE_SCHEMA_KEYWORDS.find((allowed) => allowed === finalPathPart);
    }
  }

  const message = error instanceof Error ? error.message : "";
  if (!/schema|structured output|response_format/i.test(message)) return undefined;

  return SAFE_SCHEMA_KEYWORDS.find((keyword) => {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const token = `(?:^|[^A-Za-z0-9_$])${escapedKeyword}(?:$|[^A-Za-z0-9_$])`;
    const unsupportedBefore = new RegExp(
      `(?:unsupported|unknown|unrecognized|not supported|not allowed|invalid)[^\\r\\n]{0,100}${token}`,
      "i",
    );
    const unsupportedAfter = new RegExp(
      `${token}[^\\r\\n]{0,100}(?:unsupported|unknown|unrecognized|not supported|not allowed|invalid)`,
      "i",
    );
    const namedKeyword = new RegExp(
      `(?:keyword|constraint)\\s*[:=]?\\s*[\\"'\\x60]?${escapedKeyword}(?:$|[^A-Za-z0-9_$])`,
      "i",
    );
    return unsupportedBefore.test(message) ||
      unsupportedAfter.test(message) ||
      namedKeyword.test(message);
  });
}

function safeRequestId(error: unknown): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("requestID" in error) ||
    typeof error.requestID !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(error.requestID)
  ) {
    return null;
  }

  return error.requestID;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function transportCauseFromCode(
  code: string,
  name: string,
): AssistantTransportCause | null {
  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "EAI_FAIL" ||
    code === "ENODATA"
  ) {
    return "dns";
  }

  if (
    code.startsWith("ERR_TLS_") ||
    code.startsWith("ERR_SSL_") ||
    code.startsWith("CERT_") ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "EPROTO"
  ) {
    return "tls";
  }

  if (
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT" ||
    name === "ConnectTimeoutError" ||
    name === "TimeoutError"
  ) {
    return "timeout";
  }

  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
    return "connection_reset";
  }

  if (code === "ECONNREFUSED") return "connection_refused";

  if (
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "EAFNOSUPPORT"
  ) {
    return "network_unreachable";
  }

  return null;
}

function networkFamilyFromCause(
  cause: Record<string, unknown>,
): AssistantNetworkFamily | undefined {
  const family = cause.family;
  if (family === 4 || family === "IPv4" || family === "AF_INET") return "ipv4";
  if (family === 6 || family === "IPv6" || family === "AF_INET6") return "ipv6";

  const address = cause.address;
  if (typeof address !== "string") return undefined;
  if (address.includes(":")) return "ipv6";
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) return "ipv4";
  return undefined;
}

function safeTransportDetails(
  error: unknown,
  timedOut: boolean,
): Pick<AssistantProviderDiagnostic, "transportCause" | "networkFamily"> {
  const visited = new Set<object>();
  let current = recordOf(error)?.cause;
  let transportCause: AssistantTransportCause | undefined = timedOut
    ? "timeout"
    : undefined;
  let networkFamily: AssistantNetworkFamily | undefined;
  let foundCause = false;

  for (let depth = 0; depth < 6; depth += 1) {
    const cause = recordOf(current);
    if (!cause || visited.has(cause)) break;
    visited.add(cause);
    foundCause = true;

    if (!networkFamily) networkFamily = networkFamilyFromCause(cause);

    const code = typeof cause.code === "string" ? cause.code : "";
    const name = typeof cause.name === "string" ? cause.name : "";
    const categorized = transportCauseFromCode(code, name);
    if (categorized) transportCause = categorized;

    current = cause.cause;
  }

  if (!transportCause && foundCause) transportCause = "unknown";

  return {
    ...(transportCause ? { transportCause } : {}),
    ...(networkFamily ? { networkFamily } : {}),
  };
}

function safeResponseRequestId(response: unknown): string | null {
  if (
    typeof response !== "object" ||
    response === null ||
    !("_request_id" in response) ||
    typeof response._request_id !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(response._request_id)
  ) {
    return null;
  }

  return response._request_id;
}

function providerErrorCategory(
  status: number | null,
  name: string,
  code: string,
  parameter: string,
  sdkErrorKind: {
    timedOut: boolean;
    connected: boolean;
    cancelled: boolean;
  },
): AssistantProviderDiagnostic["errorCategory"] {
  if (sdkErrorKind.cancelled) return "request_cancelled";
  if (
    sdkErrorKind.timedOut ||
    name === "AbortError" ||
    name === "TimeoutError" ||
    status === 408 ||
    code === "ETIMEDOUT"
  ) {
    return "timeout";
  }

  const schemaParameters = [
    "response_format",
    "response_format.json_schema",
  ];
  if (
    status === 400 &&
    (schemaParameters.includes(parameter) || parameter.startsWith("response_format.json_schema."))
  ) {
    return "schema_error";
  }

  if (status === 400) return "invalid_request";
  if (status === 401) return "authentication";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "request_too_large";
  if (status === 422) return "unprocessable_entity";
  if (status === 429) return "rate_limit";
  if (status === 498) return "capacity_exceeded";
  if (status === 499) return "request_cancelled";
  if (status !== null && status >= 500) return "upstream_error";

  if (
    sdkErrorKind.connected ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED"
  ) {
    return "network_error";
  }

  return status === null ? "sdk_error" : "provider_error";
}

function classifySdkError(error: unknown): AssistantModelCallResult {
  const name = errorName(error);
  const rawStatus = errorStatus(error);
  const status =
    rawStatus !== null && Number.isSafeInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
      ? rawStatus
      : null;
  const code = errorCode(error);
  const sdkErrorKind = {
    timedOut: error instanceof OpenAI.APIConnectionTimeoutError,
    connected: error instanceof OpenAI.APIConnectionError,
    cancelled: error instanceof OpenAI.APIUserAbortError,
  };
  const requestParameter = safeRequestParameterFromError(error);
  const schemaKeyword = safeSchemaKeyword(error);
  const baseCategory = providerErrorCategory(
    status,
    name,
    code,
    requestParameter ?? "",
    sdkErrorKind,
  );
  const category = baseCategory === "invalid_request" && status === 400 && schemaKeyword
    ? "schema_error"
    : baseCategory;
  const providerErrorType = safeProviderErrorType(error);
  const providerDiagnostic: AssistantProviderDiagnostic = {
    httpStatus: status,
    errorCategory: category,
    requestId: safeRequestId(error),
    ...(providerErrorType ? { providerErrorType } : {}),
    ...(requestParameter ? { requestParameter } : {}),
    ...(schemaKeyword ? { schemaKeyword } : {}),
    ...(sdkErrorKind.connected || sdkErrorKind.timedOut
      ? safeTransportDetails(error, sdkErrorKind.timedOut)
      : {}),
  };

  if (category === "timeout") {
    return { status: "TIMEOUT", errorCode: "timeout", providerDiagnostic };
  }

  return {
    status: "UNAVAILABLE",
    errorCode: category,
    providerDiagnostic,
  };
}

/**
 * Server-only Groq Chat Completions adapter using the OpenAI-compatible SDK.
 * The API key stays in the SDK instance and is never returned, logged, or
 * included in request/result payloads exposed to callers.
 */
export function createGroqModelClient(
  config: AssistantConfig,
): AssistantModelClient {
  if (
    !Number.isSafeInteger(config.maxOutputTokens) ||
    config.maxOutputTokens < MIN_MAX_OUTPUT_TOKENS ||
    config.maxOutputTokens > MAX_MAX_OUTPUT_TOKENS
  ) {
    throw new Error("Assistant model output limit is outside the supported range.");
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: "https://api.groq.com/openai/v1",
    timeout: config.requestTimeoutMs,
    maxRetries: 0,
  });

  return {
    async respond(request: AssistantModelRequest): Promise<AssistantModelCallResult> {
      let response: Awaited<ReturnType<typeof client.chat.completions.create>>;
      try {
        const responseFormat = config.responseFormat === "json_object"
          ? { type: "json_object" as const }
          : {
              type: "json_schema" as const,
              json_schema: {
                name: ASSISTANT_RESPONSE_FORMAT_NAME,
                strict: true as const,
                schema: ASSISTANT_RESPONSE_JSON_SCHEMA,
              },
            };

        response = await client.chat.completions.create(
          {
            model: config.model,
            messages: [
              { role: "system", content: request.instructions },
              { role: "user", content: request.input },
            ],
            max_completion_tokens: config.maxOutputTokens,
            response_format: responseFormat,
          },
          {
            timeout: config.requestTimeoutMs,
            maxRetries: 0,
          },
        );
      } catch (error) {
        return classifySdkError(error);
      }

      try {
        const usage = normalizeAssistantTokenUsage(response.usage);
        const choice = response.choices?.[0];

        if (!choice) {
          return {
            status: "INVALID_OUTPUT",
            errorCode: "missing_choice",
            usage: usage.usage ?? undefined,
            providerDiagnostic: {
              httpStatus: 200,
              errorCategory: "response_error",
              requestId: safeResponseRequestId(response),
            },
          };
        }

        if (choice.finish_reason === "length") {
          return {
            status: "INVALID_OUTPUT",
            errorCode: "incomplete",
            usage: usage.usage ?? undefined,
            providerDiagnostic: {
              httpStatus: 200,
              errorCategory: "response_error",
              requestId: safeResponseRequestId(response),
            },
          };
        }

        if (choice.finish_reason !== "stop") {
          return {
            status: "UNAVAILABLE",
            errorCode: "unexpected_finish_reason",
            usage: usage.usage ?? undefined,
            providerDiagnostic: {
              httpStatus: 200,
              errorCategory: "response_error",
              requestId: safeResponseRequestId(response),
            },
          };
        }

        const rawOutputText: unknown = choice.message?.content;
        const outputText =
          typeof rawOutputText === "string" ? rawOutputText.trim() : "";

        if (!outputText) {
          return {
            status: "INVALID_OUTPUT",
            errorCode: "empty_output",
            usage: usage.usage ?? undefined,
            providerDiagnostic: {
              httpStatus: 200,
              errorCategory: "response_error",
              requestId: safeResponseRequestId(response),
            },
          };
        }

        return {
          status: "OK",
          outputText,
          modelId: response.model || undefined,
          usage: usage.usage ?? undefined,
        };
      } catch {
        return {
          status: "UNAVAILABLE",
          errorCode: "adapter_error",
          providerDiagnostic: {
            httpStatus: 200,
            errorCategory: "adapter_error",
            requestId: safeResponseRequestId(response),
          },
        };
      }
    },
  };
}
