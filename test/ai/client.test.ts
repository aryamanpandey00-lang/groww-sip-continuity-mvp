import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_RESPONSE_JSON_SCHEMA } from "@/lib/ai/schemas";
import { READY_CONFIG } from "./fixtures";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      readonly responses = { create: mocks.create };

      constructor(options: unknown) {
        mocks.constructor(options);
      }
    },
  };
});

import { createOpenAIModelClient } from "@/lib/ai/client";

function response(overrides: Record<string, unknown> = {}) {
  return {
    status: "completed",
    error: null,
    output_text: "{\"ok\":true}",
    model: "configured-test-model",
    usage: {
      input_tokens: 11,
      output_tokens: 7,
      total_tokens: 18,
    },
    ...overrides,
  };
}

describe("server-only OpenAI Responses API client", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.constructor.mockReset();
  });

  it("uses the configured model, strict schema, token limit, timeout and no retries", async () => {
    mocks.create.mockResolvedValue(response());
    const client = createOpenAIModelClient(READY_CONFIG);

    const result = await client.respond({
      instructions: "system instructions",
      input: "user input",
    });

    expect(mocks.constructor).toHaveBeenCalledWith({
      apiKey: READY_CONFIG.apiKey,
      timeout: READY_CONFIG.requestTimeoutMs,
      maxRetries: 0,
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);

    const [body, options] = mocks.create.mock.calls[0];

    expect(body).toMatchObject({
      model: "configured-test-model",
      instructions: "system instructions",
      input: "user input",
      max_output_tokens: 700,
      store: false,
    });
    expect(body.text).toMatchObject({
      format: {
        type: "json_schema",
        name: "groww_sip_assistant_response_v1",
        strict: true,
        schema: ASSISTANT_RESPONSE_JSON_SCHEMA,
      },
    });
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

  it("retains usage from an incomplete response for budget settlement", async () => {
    mocks.create.mockResolvedValue(response({ status: "incomplete" }));
    const client = createOpenAIModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "INVALID_OUTPUT",
      errorCode: "incomplete",
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    });
  });

  it("treats an empty output as invalid output", async () => {
    mocks.create.mockResolvedValue(response({ output_text: "   " }));
    const client = createOpenAIModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "INVALID_OUTPUT",
      errorCode: "empty_output",
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    });
  });

  it("rejects non-completed statuses even when output text is present", async () => {
    mocks.create.mockResolvedValue(response({ status: "in_progress" }));
    const client = createOpenAIModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      errorCode: "unexpected_response_status",
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    });
  });

  it("maps SDK timeouts to a timeout result", async () => {
    const error = new Error("timeout");
    error.name = "APIConnectionTimeoutError";
    mocks.create.mockRejectedValue(error);
    const client = createOpenAIModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toEqual({ status: "TIMEOUT", errorCode: "timeout" });
  });

  it("maps rate limits and upstream failures to unavailable results", async () => {
    const rateLimit = Object.assign(new Error("rate limit"), { status: 429 });
    const upstream = Object.assign(new Error("server error"), { status: 500 });

    mocks.create.mockRejectedValueOnce(rateLimit);
    const client = createOpenAIModelClient(READY_CONFIG);
    const rateResult = await client.respond({ instructions: "s", input: "u" });

    mocks.create.mockRejectedValueOnce(upstream);
    const upstreamResult = await client.respond({ instructions: "s", input: "u" });

    expect(rateResult).toEqual({
      status: "UNAVAILABLE",
      errorCode: "rate_limit",
    });
    expect(upstreamResult).toEqual({
      status: "UNAVAILABLE",
      errorCode: "upstream_error",
    });
  });

  it("maps connection errors and unknown failures without leaking error text", async () => {
    const connection = new Error("private network detail");
    connection.name = "APIConnectionError";
    const generic = new Error("secret upstream detail");

    mocks.create.mockRejectedValueOnce(connection);
    const client = createOpenAIModelClient(READY_CONFIG);
    const connectionResult = await client.respond({
      instructions: "s",
      input: "u",
    });

    mocks.create.mockRejectedValueOnce(generic);
    const genericResult = await client.respond({ instructions: "s", input: "u" });

    expect(connectionResult).toEqual({
      status: "UNAVAILABLE",
      errorCode: "connection_error",
    });
    expect(genericResult).toEqual({
      status: "UNAVAILABLE",
      errorCode: "sdk_error",
    });
    expect(JSON.stringify(connectionResult)).not.toContain("private network");
    expect(JSON.stringify(genericResult)).not.toContain("secret upstream");
  });

  it("omits usage when the API does not provide it", async () => {
    mocks.create.mockResolvedValue(response({ usage: undefined }));
    const client = createOpenAIModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result.status).toBe("OK");

    if (result.status === "OK") {
      expect(result.usage).toBeUndefined();
    }
  });

  it("derives total usage only from both reported components", async () => {
    mocks.create.mockResolvedValue(response({
      usage: { input_tokens: 9, output_tokens: 4 },
    }));
    const client = createOpenAIModelClient(READY_CONFIG);

    const result = await client.respond({ instructions: "s", input: "u" });

    expect(result).toMatchObject({
      status: "OK",
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
    });
  });
});
