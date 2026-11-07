import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS } from "../../scripts/assistant-smoke-config";
import { ASSISTANT_RESPONSE_JSON_SCHEMA } from "@/lib/ai/schemas";
import { READY_CONFIG } from "./fixtures";

const mocks = vi.hoisted(() => {
  class MockAPIConnectionError extends Error {}
  class MockAPIConnectionTimeoutError extends MockAPIConnectionError {}
  class MockAPIUserAbortError extends Error {}

  return {
    create: vi.fn(),
    constructor: vi.fn(),
    APIConnectionError: MockAPIConnectionError,
    APIConnectionTimeoutError: MockAPIConnectionTimeoutError,
    APIUserAbortError: MockAPIUserAbortError,
  };
});

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      static APIConnectionError = mocks.APIConnectionError;
      static APIConnectionTimeoutError = mocks.APIConnectionTimeoutError;
      static APIUserAbortError = mocks.APIUserAbortError;
      readonly chat = { completions: { create: mocks.create } };

      constructor(options: unknown) {
        mocks.constructor(options);
      }
    },
  };
});

import { createGroqModelClient } from "@/lib/ai/client";

function response(overrides: Record<string, unknown> = {}) {
  return {
    id: "chatcmpl_test_1",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "{\"ok\":true}" },
      finish_reason: "stop",
    }],
    model: "configured-test-model",
    usage: {
      prompt_tokens: 11,
      prompt_tokens_details: { cached_tokens: 2 },
      completion_tokens: 7,
      completion_tokens_details: { reasoning_tokens: 3 },
      total_tokens: 18,
    },
    ...overrides,
  };
}

describe("server-only Groq Chat Completions client", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.constructor.mockReset();
  });

  it("uses strict Chat JSON Schema, the output cap, timeout and no retries", async () => {
    mocks.create.mockResolvedValue(response());
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({
      instructions: "system instructions",
      input: "user input",
    });

    expect(mocks.constructor).toHaveBeenCalledWith({
      apiKey: READY_CONFIG.apiKey,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: READY_CONFIG.requestTimeoutMs,
      maxRetries: 0,
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);

    const [body, options] = mocks.create.mock.calls[0];

    expect(body).toMatchObject({
      model: "configured-test-model",
      messages: [
        { role: "system", content: "system instructions" },
        { role: "user", content: "user input" },
      ],
      max_completion_tokens: 700,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "groww_sip_assistant_response_v1",
          strict: true,
          schema: ASSISTANT_RESPONSE_JSON_SCHEMA,
        },
      },
    });
    expect(body).not.toHaveProperty("instructions");
    expect(body).not.toHaveProperty("input");
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body).not.toHaveProperty("store");
    expect(body).not.toHaveProperty("text");
    expect(options).toEqual({ timeout: 1_000, maxRetries: 0 });
    expect(result).toEqual({
      status: "OK",
      outputText: "{\"ok\":true}",
      modelId: "configured-test-model",
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
      },
    });
    expect(JSON.stringify(result)).not.toContain(READY_CONFIG.apiKey);
  });

  it("uses Groq JSON Object mode when selected and keeps the raw output for runtime validation", async () => {
    mocks.create.mockResolvedValue(response({
      choices: [{
        index: 0,
        message: { role: "assistant", content: "{\"directAnswer\":\"ok\"}" },
        finish_reason: "stop",
      }],
    }));
    const client = createGroqModelClient({
      ...READY_CONFIG,
      responseFormat: "json_object",
    });

    const result = await client.respond({ instructions: "Return JSON.", input: "Question." });
    const [body] = mocks.create.mock.calls[0] ?? [];

    expect(body).toMatchObject({
      response_format: { type: "json_object" },
    });
    expect(body.response_format).not.toHaveProperty("json_schema");
    expect(result).toMatchObject({
      status: "OK",
      outputText: "{\"directAnswer\":\"ok\"}",
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    });
  });

  it("rejects an unsupported output cap before constructing the provider client", () => {
    expect(() => createGroqModelClient({ ...READY_CONFIG, maxOutputTokens: 2_001 })).toThrow(
      "Assistant model output limit is outside the supported range.",
    );
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it("sends the largest supported output limit as the provider-side cap", async () => {
    mocks.create.mockResolvedValue(response());
    const client = createGroqModelClient({ ...READY_CONFIG, maxOutputTokens: 2_000 });
    await client.respond({ instructions: "s", input: "u" });

    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
      max_completion_tokens: 2_000,
    });
  });

  it("sends the controlled-smoke output limit as max_completion_tokens", async () => {
    mocks.create.mockResolvedValue(response());
    const client = createGroqModelClient({
      ...READY_CONFIG,
      maxOutputTokens: ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS,
    });
    await client.respond({ instructions: "s", input: "u" });

    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
      max_completion_tokens: ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS,
    });
  });

  it("retains usage when the completion reaches its output cap", async () => {
    mocks.create.mockResolvedValue(response({
      choices: [{
        index: 0,
        message: { role: "assistant", content: "{\"ok\":" },
        finish_reason: "length",
      }],
    }));
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "INVALID_OUTPUT",
      errorCode: "incomplete",
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      providerDiagnostic: {
        httpStatus: 200,
        errorCategory: "response_error",
        requestId: null,
      },
    });
  });

  it("rejects a malformed completion with no choices", async () => {
    mocks.create.mockResolvedValue(response({ choices: [] }));
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "INVALID_OUTPUT",
      errorCode: "missing_choice",
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      providerDiagnostic: {
        httpStatus: 200,
        errorCategory: "response_error",
        requestId: null,
      },
    });
  });

  it("treats an empty message as invalid output", async () => {
    mocks.create.mockResolvedValue(response({
      choices: [{
        index: 0,
        message: { role: "assistant", content: "   " },
        finish_reason: "stop",
      }],
    }));
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "INVALID_OUTPUT",
      errorCode: "empty_output",
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      providerDiagnostic: {
        httpStatus: 200,
        errorCategory: "response_error",
        requestId: null,
      },
    });
  });

  it("rejects unexpected finish reasons even when content is present", async () => {
    mocks.create.mockResolvedValue(response({
      choices: [{
        index: 0,
        message: { role: "assistant", content: "{\"ok\":true}" },
        finish_reason: "tool_calls",
      }],
    }));
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      errorCode: "unexpected_finish_reason",
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      providerDiagnostic: {
        httpStatus: 200,
        errorCategory: "response_error",
        requestId: null,
      },
    });
  });

  it("maps SDK timeouts to a timeout result", async () => {
    const error = new mocks.APIConnectionTimeoutError("private timeout detail");
    mocks.create.mockRejectedValue(error);
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "TIMEOUT",
      errorCode: "timeout",
      providerDiagnostic: {
        httpStatus: null,
        errorCategory: "timeout",
        requestId: null,
        transportCause: "timeout",
      },
    });
  });

  it("reports a sanitized provider status, category and request ID", async () => {
    const error = Object.assign(new Error("secret provider response body"), {
      status: 400,
      requestID: "req_safe_123",
    });
    mocks.create.mockRejectedValue(error);
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      errorCode: "invalid_request",
      providerDiagnostic: {
        httpStatus: 400,
        errorCategory: "invalid_request",
        requestId: "req_safe_123",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret provider response body");
    expect(JSON.stringify(result)).not.toContain(READY_CONFIG.apiKey);
  });

  it("reports authentication failures without returning provider text", async () => {
    const error = Object.assign(new Error("private auth response"), { status: 401 });
    mocks.create.mockRejectedValue(error);
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      errorCode: "authentication",
      providerDiagnostic: {
        httpStatus: 401,
        errorCategory: "authentication",
        requestId: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain("private auth response");
  });

  it("maps rate limits and upstream failures to unavailable results", async () => {
    const rateLimit = Object.assign(new Error("rate limit"), { status: 429 });
    const upstream = Object.assign(new Error("server error"), { status: 500 });

    mocks.create.mockRejectedValueOnce(rateLimit);
    const client = createGroqModelClient(READY_CONFIG);
    const rateResult = await client.respond({ instructions: "s", input: "u" });

    mocks.create.mockRejectedValueOnce(upstream);
    const upstreamResult = await client.respond({ instructions: "s", input: "u" });

    expect(rateResult).toEqual({
      status: "UNAVAILABLE",
      errorCode: "rate_limit",
      providerDiagnostic: {
        httpStatus: 429,
        errorCategory: "rate_limit",
        requestId: null,
      },
    });
    expect(upstreamResult).toEqual({
      status: "UNAVAILABLE",
      errorCode: "upstream_error",
      providerDiagnostic: {
        httpStatus: 500,
        errorCategory: "upstream_error",
        requestId: null,
      },
    });
  });

  it("distinguishes network and SDK failures without leaking error text", async () => {
    const connection = new mocks.APIConnectionError("private network detail");
    const generic = new Error("secret upstream detail");

    mocks.create.mockRejectedValueOnce(connection);
    const client = createGroqModelClient(READY_CONFIG);
    const connectionResult = await client.respond({
      instructions: "s",
      input: "u",
    });

    mocks.create.mockRejectedValueOnce(generic);
    const genericResult = await client.respond({ instructions: "s", input: "u" });

    expect(connectionResult).toEqual({
      status: "UNAVAILABLE",
      errorCode: "network_error",
      providerDiagnostic: {
        httpStatus: null,
        errorCategory: "network_error",
        requestId: null,
      },
    });
    expect(genericResult).toEqual({
      status: "UNAVAILABLE",
      errorCode: "sdk_error",
      providerDiagnostic: {
        httpStatus: null,
        errorCategory: "sdk_error",
        requestId: null,
      },
    });
    expect(JSON.stringify(connectionResult)).not.toContain("private network");
    expect(JSON.stringify(genericResult)).not.toContain("secret upstream");
  });

  it.each([
    ["ENOTFOUND", "dns"],
    ["EAI_AGAIN", "dns"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
    ["ECONNRESET", "connection_reset"],
    ["ECONNREFUSED", "connection_refused"],
    ["ENETUNREACH", "network_unreachable"],
    ["UND_ERR_CONNECT_TIMEOUT", "timeout"],
  ] as const)("sanitizes nested transport cause %s", async (code, transportCause) => {
    const lowLevelCause = Object.assign(new Error("private transport detail"), {
      code,
      family: 6,
      address: "2001:db8::1",
    });
    const fetchFailure = Object.assign(new TypeError("fetch failed with secret host"), {
      cause: lowLevelCause,
    });
    const connection = Object.assign(
      new mocks.APIConnectionError("private network detail"),
      { cause: fetchFailure },
    );
    mocks.create.mockRejectedValue(connection);
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "network_error",
      providerDiagnostic: {
        httpStatus: null,
        errorCategory: "network_error",
        requestId: null,
        transportCause,
        networkFamily: "ipv6",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private transport detail");
    expect(JSON.stringify(result)).not.toContain("secret host");
    expect(JSON.stringify(result)).not.toContain("2001:db8::1");
  });

  it("classifies local request-construction errors as SDK errors", async () => {
    mocks.create.mockRejectedValue(new TypeError("invalid local request options"));
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      errorCode: "sdk_error",
      providerDiagnostic: {
        httpStatus: null,
        errorCategory: "sdk_error",
        requestId: null,
      },
    });
  });

  it.each([
    [4, "ipv4"],
    [6, "ipv6"],
  ] as const)("reports only the network family for family %i", async (family, networkFamily) => {
    const lowLevelCause = Object.assign(new Error("private socket detail"), {
      code: "ECONNRESET",
      family,
      address: family === 4 ? "192.0.2.10" : "2001:db8::10",
    });
    const connection = Object.assign(
      new mocks.APIConnectionError("private network detail"),
      { cause: lowLevelCause },
    );
    mocks.create.mockRejectedValue(connection);
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      providerDiagnostic: { transportCause: "connection_reset", networkFamily },
    });
    expect(JSON.stringify(result)).not.toContain("192.0.2.10");
    expect(JSON.stringify(result)).not.toContain("2001:db8::10");
  });

  it("categorizes schema rejections without returning the provider message", async () => {
    const error = Object.assign(new Error("private schema rejection detail"), {
      status: 400,
      param: "response_format.json_schema",
      type: "invalid_request_error",
      requestID: "req_schema_123",
    });
    mocks.create.mockRejectedValue(error);
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "schema_error",
      providerDiagnostic: {
        httpStatus: 400,
        errorCategory: "schema_error",
        requestId: "req_schema_123",
        providerErrorType: "invalid_request_error",
        requestParameter: "response_format.json_schema",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private schema rejection detail");
  });

  it("reports only an allowlisted schema keyword from a provider validation message", async () => {
    const error = Object.assign(
      new Error("Invalid response schema: unsupported keyword maxItems; private prompt text"),
      {
        status: 400,
        param: "response_format.json_schema.schema.properties.keyPoints.maxItems",
        type: "invalid_request_error",
      },
    );
    mocks.create.mockRejectedValue(error);
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "schema_error",
      providerDiagnostic: {
        httpStatus: 400,
        errorCategory: "schema_error",
        providerErrorType: "invalid_request_error",
        requestParameter: "response_format.json_schema",
        schemaKeyword: "maxItems",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private prompt text");
    expect(JSON.stringify(result)).not.toContain("unsupported keyword");
  });

  it("extracts only a known schema keyword when the provider omits its parameter", async () => {
    const error = Object.assign(
      new Error("Invalid response schema: unsupported keyword 'maxItems'; private evidence text"),
      { status: 400, type: "invalid_request_error" },
    );
    mocks.create.mockRejectedValue(error);
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "schema_error",
      providerDiagnostic: {
        httpStatus: 400,
        errorCategory: "schema_error",
        providerErrorType: "invalid_request_error",
        schemaKeyword: "maxItems",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private evidence text");
  });

  it("extracts a known request parameter without exposing the provider message", async () => {
    const error = Object.assign(
      new Error("Invalid request: unsupported parameter max_completion_tokens; private prompt text"),
      { status: 400, type: "invalid_request_error" },
    );
    mocks.create.mockRejectedValue(error);
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "invalid_request",
      providerDiagnostic: {
        httpStatus: 400,
        errorCategory: "invalid_request",
        providerErrorType: "invalid_request_error",
        requestParameter: "max_completion_tokens",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private prompt text");
  });

  it("omits unrecognized provider error types and request parameters", async () => {
    const error = Object.assign(new Error("private schema detail: hidden secret"), {
      status: 400,
      param: "Authorization",
      type: "provider-specific-secret",
    });
    mocks.create.mockRejectedValue(error);
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      errorCode: "invalid_request",
      providerDiagnostic: {
        httpStatus: 400,
        errorCategory: "invalid_request",
        requestId: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain("provider-specific-secret");
    expect(JSON.stringify(result)).not.toContain("hidden secret");
    expect(JSON.stringify(result)).not.toContain("Authorization");
  });

  it("reports adapter decoding failures separately from SDK request failures", async () => {
    const malformedResponse = response();
    Object.defineProperty(malformedResponse, "usage", {
      get() {
        throw new Error("private adapter failure detail");
      },
    });
    Object.assign(malformedResponse, { _request_id: "req_adapter_123" });
    mocks.create.mockResolvedValue(malformedResponse);
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      errorCode: "adapter_error",
      providerDiagnostic: {
        httpStatus: 200,
        errorCategory: "adapter_error",
        requestId: "req_adapter_123",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private adapter failure detail");
  });

  it("omits usage when the API does not provide it", async () => {
    mocks.create.mockResolvedValue(response({ usage: undefined }));
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result.status).toBe("OK");

    if (result.status === "OK") {
      expect(result.usage).toBeUndefined();
    }
  });

  it("derives total usage only from both reported components", async () => {
    mocks.create.mockResolvedValue(response({
      usage: { prompt_tokens: 9, completion_tokens: 4 },
    }));
    const client = createGroqModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toMatchObject({
      status: "OK",
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
    });
  });
});
