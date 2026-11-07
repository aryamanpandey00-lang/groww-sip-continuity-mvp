import { describe, expect, it } from "vitest";
import {
  ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS,
  createAssistantSmokeEnvironment,
} from "../../scripts/assistant-smoke-config";
import { resolveAssistantConfig } from "@/lib/ai/config";

describe("assistant smoke process configuration", () => {
  it("sets the fixed output cap on an isolated environment copy", () => {
    const processEnvironment = {
      ASSISTANT_ENABLED: "true",
      SHARED_RUNTIME_VERIFIED: "true",
      GROQ_API_KEY: "test-only-key",
      GROQ_MODEL: "test-model",
      MAX_OUTPUT_TOKENS: "256",
    };

    const smokeEnvironment = createAssistantSmokeEnvironment(processEnvironment);
    const config = resolveAssistantConfig(smokeEnvironment);

    expect(ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS).toBe(1_024);
    expect(smokeEnvironment).not.toBe(processEnvironment);
    expect(processEnvironment.MAX_OUTPUT_TOKENS).toBe("256");
    expect(smokeEnvironment.MAX_OUTPUT_TOKENS).toBe("1024");
    expect(config).toMatchObject({
      status: "READY",
      config: { maxOutputTokens: ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS },
    });
  });
});
