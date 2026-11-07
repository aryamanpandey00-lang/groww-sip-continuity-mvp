export const ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS = 1_024;

/** Return an isolated one-call smoke environment without mutating the parent. */
export function createAssistantSmokeEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...env,
    NODE_ENV: "production",
    MAX_OUTPUT_TOKENS: String(ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS),
  };
}
