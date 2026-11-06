import type {
  AssistantConfig,
  AssistantConfigResolution,
  AssistantFallbackReason,
} from "./types";

export const DEFAULT_MAX_OUTPUT_TOKENS = 700;
export const MIN_MAX_OUTPUT_TOKENS = 64;
export const MAX_MAX_OUTPUT_TOKENS = 2_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_INPUT_CHARS = 2_000;

export const ASSISTANT_ENV_KEYS = {
  enabled: "ASSISTANT_ENABLED",
  apiKey: "OPENAI_API_KEY",
  model: "OPENAI_MODEL",
  maxOutputTokens: "MAX_OUTPUT_TOKENS",
} as const;

function unavailable(
  reason:
    | "ASSISTANT_DISABLED"
    | "MISSING_API_KEY"
    | "MISSING_MODEL"
    | "INVALID_MAX_OUTPUT_TOKENS",
): AssistantConfigResolution {
  const fallbackReason: AssistantFallbackReason =
    reason === "ASSISTANT_DISABLED" ? "ASSISTANT_DISABLED" : "MISSING_CONFIG";

  return { status: "UNAVAILABLE", reason, fallbackReason };
}

function parseMaxOutputTokens(value: string | undefined): number | null {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }

  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number(value.trim());

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_MAX_OUTPUT_TOKENS ||
    parsed > MAX_MAX_OUTPUT_TOKENS
  ) {
    return null;
  }

  return parsed;
}

/**
 * Resolves assistant configuration from an explicit environment object.
 *
 * The assistant fails closed: if it is not explicitly enabled, or if either the
 * API key or model is absent, no client is constructed and no request is made.
 * `OPENAI_MODEL` is never defaulted or substituted.
 */
export function resolveAssistantConfig(
  env: Record<string, string | undefined> = process.env,
): AssistantConfigResolution {
  if (env[ASSISTANT_ENV_KEYS.enabled]?.trim() !== "true") {
    return unavailable("ASSISTANT_DISABLED");
  }

  const apiKey = env[ASSISTANT_ENV_KEYS.apiKey]?.trim();

  if (!apiKey) {
    return unavailable("MISSING_API_KEY");
  }

  const model = env[ASSISTANT_ENV_KEYS.model]?.trim();

  if (!model) {
    return unavailable("MISSING_MODEL");
  }

  const maxOutputTokens = parseMaxOutputTokens(
    env[ASSISTANT_ENV_KEYS.maxOutputTokens],
  );

  if (maxOutputTokens === null) {
    return unavailable("INVALID_MAX_OUTPUT_TOKENS");
  }

  const config: AssistantConfig = {
    apiKey,
    model,
    maxOutputTokens,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    maxInputChars: DEFAULT_MAX_INPUT_CHARS,
  };

  return { status: "READY", config };
}
