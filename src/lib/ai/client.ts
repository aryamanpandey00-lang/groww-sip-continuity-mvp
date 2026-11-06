import "server-only";

import OpenAI from "openai";
import type {
  AssistantConfig,
  AssistantModelCallResult,
  AssistantModelClient,
  AssistantModelRequest,
} from "./types";
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

function classifySdkError(error: unknown): AssistantModelCallResult {
  const name = errorName(error);
  const status = errorStatus(error);
  const code = errorCode(error);

  if (
    name === "AbortError" ||
    name === "APIConnectionTimeoutError" ||
    name === "TimeoutError" ||
    status === 408 ||
    code === "ETIMEDOUT"
  ) {
    return { status: "TIMEOUT", errorCode: "timeout" };
  }

  if (status === 429) {
    return { status: "UNAVAILABLE", errorCode: "rate_limit" };
  }

  if (status !== null && status >= 500) {
    return { status: "UNAVAILABLE", errorCode: "upstream_error" };
  }

  if (
    name === "APIConnectionError" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED"
  ) {
    return { status: "UNAVAILABLE", errorCode: "connection_error" };
  }

  return { status: "UNAVAILABLE", errorCode: "sdk_error" };
}

/**
 * Server-only Responses API adapter. The API key is held only by the SDK
 * instance; it is never returned, logged, or included in request/result
 * payloads exposed to callers.
 */
export function createOpenAIModelClient(
  config: AssistantConfig,
): AssistantModelClient {
  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: config.requestTimeoutMs,
    maxRetries: 0,
  });

  return {
    async respond(request: AssistantModelRequest): Promise<AssistantModelCallResult> {
      try {
        const response = await client.responses.create(
          {
            model: config.model,
            instructions: request.instructions,
            input: request.input,
            max_output_tokens: config.maxOutputTokens,
            store: false,
            text: {
              format: {
                type: "json_schema",
                name: ASSISTANT_RESPONSE_FORMAT_NAME,
                strict: true,
                schema: ASSISTANT_RESPONSE_JSON_SCHEMA,
              },
            },
          },
          {
            timeout: config.requestTimeoutMs,
            maxRetries: 0,
          },
        );

        const usage = normalizeAssistantTokenUsage(response.usage);

        if (response.status === "incomplete") {
          return {
            status: "INVALID_OUTPUT",
            errorCode: "incomplete",
            usage: usage.usage ?? undefined,
          };
        }

        if (response.error) {
          return {
            status: "UNAVAILABLE",
            errorCode: "response_error",
            usage: usage.usage ?? undefined,
          };
        }

        if (response.status !== "completed") {
          return {
            status: "UNAVAILABLE",
            errorCode: "unexpected_response_status",
            usage: usage.usage ?? undefined,
          };
        }

        const rawOutputText: unknown = response.output_text;
        const outputText =
          typeof rawOutputText === "string" ? rawOutputText.trim() : "";

        if (!outputText) {
          return {
            status: "INVALID_OUTPUT",
            errorCode: "empty_output",
            usage: usage.usage ?? undefined,
          };
        }

        return {
          status: "OK",
          outputText,
          modelId: response.model || undefined,
          usage: usage.usage ?? undefined,
        };
      } catch (error) {
        return classifySdkError(error);
      }
    },
  };
}
