import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_INPUT_CHARS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  resolveAssistantConfig,
} from "@/lib/ai/config";

describe("assistant configuration", () => {
  it("fails closed when the assistant is not explicitly enabled", () => {
    const result = resolveAssistantConfig({
      OPENAI_API_KEY: "test-api-key",
      OPENAI_MODEL: "configured-model",
    });

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      reason: "ASSISTANT_DISABLED",
      fallbackReason: "ASSISTANT_DISABLED",
    });
  });

  it("fails closed when ASSISTANT_ENABLED is not exactly true", () => {
    for (const value of ["TRUE", "1", "yes", "enabled", ""]) {
      const result = resolveAssistantConfig({
        ASSISTANT_ENABLED: value,
        OPENAI_API_KEY: "test-api-key",
        OPENAI_MODEL: "configured-model",
      });

      expect(result, value).toMatchObject({
        status: "UNAVAILABLE",
        reason: "ASSISTANT_DISABLED",
      });
    }
  });

  it("fails closed when the API key is missing", () => {
    const result = resolveAssistantConfig({
      ASSISTANT_ENABLED: "true",
      OPENAI_MODEL: "configured-model",
    });

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      reason: "MISSING_API_KEY",
      fallbackReason: "MISSING_CONFIG",
    });
  });

  it("fails closed when OPENAI_MODEL is missing and never substitutes a model", () => {
    const result = resolveAssistantConfig({
      ASSISTANT_ENABLED: "true",
      OPENAI_API_KEY: "test-api-key",
    });

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      reason: "MISSING_MODEL",
      fallbackReason: "MISSING_CONFIG",
    });
  });

  it("uses the exact configured model and safe defaults", () => {
    const result = resolveAssistantConfig({
      ASSISTANT_ENABLED: "true",
      OPENAI_API_KEY: "test-api-key",
      OPENAI_MODEL: "model-from-environment",
    });

    expect(result.status).toBe("READY");

    if (result.status !== "READY") {
      throw new Error("Expected ready configuration.");
    }

    expect(result.config.model).toBe("model-from-environment");
    expect(result.config.maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(result.config.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(result.config.maxInputChars).toBe(DEFAULT_MAX_INPUT_CHARS);
  });

  it.each(["0", "10", "2001", "abc", "1.5", "-5"])(
    "rejects an unsafe MAX_OUTPUT_TOKENS value: %s",
    (value) => {
      const result = resolveAssistantConfig({
        ASSISTANT_ENABLED: "true",
        OPENAI_API_KEY: "test-api-key",
        OPENAI_MODEL: "configured-model",
        MAX_OUTPUT_TOKENS: value,
      });

      expect(result).toMatchObject({
        status: "UNAVAILABLE",
        reason: "INVALID_MAX_OUTPUT_TOKENS",
        fallbackReason: "MISSING_CONFIG",
      });
    },
  );

  it("accepts a bounded MAX_OUTPUT_TOKENS override", () => {
    const result = resolveAssistantConfig({
      ASSISTANT_ENABLED: "true",
      OPENAI_API_KEY: "test-api-key",
      OPENAI_MODEL: "configured-model",
      MAX_OUTPUT_TOKENS: "1200",
    });

    expect(result.status).toBe("READY");

    if (result.status === "READY") {
      expect(result.config.maxOutputTokens).toBe(1200);
    }
  });
});
