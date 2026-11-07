import { describe, expect, it, vi } from "vitest";
import {
  buildDiagnosticRequest,
  buildShapeComparison,
  createSdkClient,
  parseDiagnosticArgs,
  runGroqChatDiagnostic,
  sanitizeProviderError,
} from "../../scripts/groq-chat-diagnostic";

describe("standalone Groq Chat Completions diagnostic", () => {
  it("requires one explicit mode and permits only one live flag", () => {
    expect(parseDiagnosticArgs(["--mode", "basic"])).toEqual({
      mode: "basic",
      live: false,
    });
    expect(parseDiagnosticArgs(["--live", "--mode", "strict"])).toEqual({
      mode: "strict",
      live: true,
    });
    expect(() => parseDiagnosticArgs(["--mode", "basic", "--mode", "strict"]))
      .toThrow("duplicate_mode");
    expect(() => parseDiagnosticArgs(["--live", "--live", "--mode", "basic"]))
      .toThrow("duplicate_live_flag");
    expect(() => parseDiagnosticArgs(["--mode", "unknown"]))
      .toThrow("invalid_mode");
  });

  it("builds the basic one-message request without structured output", () => {
    const request = buildDiagnosticRequest("basic");

    expect(request).toEqual({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: "Reply with exactly OK." }],
      max_completion_tokens: 64,
    });
    expect(request).not.toHaveProperty("response_format");
  });

  it("builds a strict schema with one required string field and no extra properties", () => {
    const request = buildDiagnosticRequest("strict");

    expect(request).toEqual({
      model: "openai/gpt-oss-20b",
      messages: [{
        role: "user",
        content: "Return a short answer in the required JSON object.",
      }],
      max_completion_tokens: 64,
      response_format: {
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
      },
    });
  });

  it("serializes only the documented request fields; SDK timeout and retry controls stay out of JSON", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ id: "chatcmpl_local", choices: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_local_serialization",
        },
      });
    };
    const client = createSdkClient("local-test-key", fetchImpl);

    await client.chat.completions.create(buildDiagnosticRequest("strict"), {
      timeout: 15_000,
      maxRetries: 0,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.groq.com/openai/v1/chat/completions",
    );
    const sentBody = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(sentBody).toEqual(buildDiagnosticRequest("strict"));
    expect(sentBody).not.toHaveProperty("timeout");
    expect(sentBody).not.toHaveProperty("maxRetries");
    expect(sentBody).not.toHaveProperty("stream");
  });

  it("compares diagnostic request shapes with production without including prompt text", () => {
    const basic = buildShapeComparison("basic");
    const strict = buildShapeComparison("strict");

    expect(basic.diagnosticRequest).toMatchObject({
      topLevelFields: ["max_completion_tokens", "messages", "model"],
      messageRoles: ["user"],
      strictJsonSchema: false,
      schemaKeywords: [],
    });
    expect(strict.diagnosticRequest).toMatchObject({
      topLevelFields: ["max_completion_tokens", "messages", "model", "response_format"],
      messageRoles: ["user"],
      strictJsonSchema: true,
      schemaKeywords: ["additionalProperties", "properties", "required", "type"],
    });
    expect(strict.productionAssistantRequest).toMatchObject({
      messageRoles: ["system", "user"],
      strictJsonSchema: true,
    });
    expect(strict.productionAssistantRequest.schemaKeywords).toEqual([
      "additionalProperties",
      "anyOf",
      "description",
      "enum",
      "items",
      "maximum",
      "minimum",
      "properties",
      "required",
      "type",
    ]);
    expect(strict.productionAssistantRequest.schemaKeywords).not.toContain("maxItems");
    expect(JSON.stringify(strict)).not.toContain("<system instructions omitted>");
    expect(JSON.stringify(strict)).not.toContain("<user input omitted>");
  });

  it("does not create a client or call the provider in dry-run mode", async () => {
    const clientFactory = vi.fn();
    const result = await runGroqChatDiagnostic(
      { mode: "basic", live: false },
      { GROQ_API_KEY: "must-not-be-used" },
      clientFactory,
    );

    expect(result).toMatchObject({
      ok: true,
      live: false,
      providerCallAttempted: false,
    });
    expect(clientFactory).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("must-not-be-used");
  });

  it("requires the key only after live mode is explicitly selected", async () => {
    const clientFactory = vi.fn();
    const result = await runGroqChatDiagnostic(
      { mode: "strict", live: true },
      {},
      clientFactory,
    );

    expect(result).toMatchObject({
      ok: false,
      live: true,
      providerCallAttempted: false,
      error: "missing_groq_api_key",
    });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("makes one provider call with retries disabled for a live diagnostic", async () => {
    const create = vi.fn().mockResolvedValue({ _request_id: "req_safe_123" });
    const clientFactory = vi.fn(() => ({
      chat: { completions: { create } },
    }));

    const result = await runGroqChatDiagnostic(
      { mode: "strict", live: true },
      { GROQ_API_KEY: "test-secret" },
      clientFactory,
    );

    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(clientFactory).toHaveBeenCalledWith("test-secret");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[1]).toEqual({ timeout: 15_000, maxRetries: 0 });
    expect(result).toMatchObject({
      ok: true,
      providerCallAttempted: true,
      accepted: true,
      httpStatus: 200,
      requestId: "req_safe_123",
    });
    expect(JSON.stringify(result)).not.toContain("test-secret");
    expect(JSON.stringify(result)).not.toContain("Return a short answer");
  });

  it("returns only sanitized provider validation metadata", () => {
    const error = Object.assign(
      new Error("Invalid schema: unsupported keyword maxItems; secret prompt and body"),
      {
        status: 400,
        param: "response_format.json_schema.schema.properties.answer.maxItems",
        type: "invalid_request_error",
        requestID: "req_schema_safe_1",
        headers: { authorization: "secret-header" },
      },
    );

    const diagnostic = sanitizeProviderError(error);

    expect(diagnostic).toEqual({
      httpStatus: 400,
      errorCategory: "schema_error",
      requestId: "req_schema_safe_1",
      providerErrorType: "invalid_request_error",
      requestParameter: "response_format.json_schema",
      schemaKeyword: "maxItems",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("unsupported keyword");
    expect(JSON.stringify(diagnostic)).not.toContain("secret prompt");
    expect(JSON.stringify(diagnostic)).not.toContain("secret-header");
  });

  it("extracts a recognized parameter from the SDK message without returning the message", () => {
    const diagnostic = sanitizeProviderError(
      Object.assign(
        new Error("Unsupported parameter max_completion_tokens; private message"),
        { status: 400, type: "invalid_request_error" },
      ),
    );

    expect(diagnostic).toMatchObject({
      httpStatus: 400,
      errorCategory: "invalid_request",
      providerErrorType: "invalid_request_error",
      requestParameter: "max_completion_tokens",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("private message");
  });

  it("classifies nested SDK error metadata without returning the provider message", () => {
    const diagnostic = sanitizeProviderError({
      status: 400,
      requestID: "req_nested_safe_1",
      error: {
        type: "invalid_request_error",
        param: "response_format.json_schema.schema.properties.answer.minLength",
        message: "Unsupported schema constraint minLength; private provider detail",
      },
    });

    expect(diagnostic).toEqual({
      httpStatus: 400,
      errorCategory: "schema_error",
      requestId: "req_nested_safe_1",
      providerErrorType: "invalid_request_error",
      requestParameter: "response_format.json_schema",
      schemaKeyword: "minLength",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("private provider detail");
  });

  it("omits unknown provider details", () => {
    const diagnostic = sanitizeProviderError(
      Object.assign(new Error("secret body with unrecognized fields"), {
        status: 400,
        param: "Authorization",
        type: "provider_secret_type",
        requestID: "bad request id with spaces",
      }),
    );

    expect(diagnostic).toEqual({
      httpStatus: 400,
      errorCategory: "invalid_request",
      requestId: null,
    });
    expect(JSON.stringify(diagnostic)).not.toContain("Authorization");
    expect(JSON.stringify(diagnostic)).not.toContain("secret body");
  });

  it("does not reveal raw errors or responses from a failed live attempt", async () => {
    const error = Object.assign(
      new Error("Invalid request: secret prompt text"),
      { status: 400, type: "invalid_request_error", requestID: "req_bad_1" },
    );
    const create = vi.fn().mockRejectedValue(error);
    const clientFactory = vi.fn(() => ({
      chat: { completions: { create } },
    }));

    const result = await runGroqChatDiagnostic(
      { mode: "basic", live: true },
      { GROQ_API_KEY: "test-secret" },
      clientFactory,
    );

    expect(result).toMatchObject({
      ok: false,
      providerCallAttempted: true,
      providerDiagnostic: {
        httpStatus: 400,
        errorCategory: "invalid_request",
        requestId: "req_bad_1",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret prompt text");
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });
});
