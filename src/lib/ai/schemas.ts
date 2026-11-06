import {
  ASSISTANT_ACTION_TYPES,
  ASSISTANT_INTENTS,
  type AssistantIntent,
  type AssistantModelOutput,
  type AssistantProposedAction,
} from "./types";

export const ASSISTANT_RESPONSE_FORMAT_NAME = "groww_sip_assistant_response_v1";

export const MAX_DIRECT_ANSWER_CHARS = 1_200;
export const MAX_KEY_POINTS = 6;
export const MAX_KEY_POINT_CHARS = 240;
export const MAX_CITATIONS = 5;
export const MAX_FOLLOW_UP_CHARS = 300;

const ACTION_TYPE_ENUM = [...ASSISTANT_ACTION_TYPES];
const INTENT_ENUM = [...ASSISTANT_INTENTS];

function actionVariant(
  type: (typeof ASSISTANT_ACTION_TYPES)[number],
  required: string[],
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties: {
      type: { type: "string", enum: [type] },
      ...properties,
    },
  };
}

/**
 * Strict JSON Schema passed to the Responses API via `text.format`.
 *
 * Keep this schema within OpenAI's supported Structured Outputs subset:
 * no root-level anyOf, no nulls, all object properties required, and
 * `additionalProperties: false` on every object.
 */
export const ASSISTANT_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "directAnswer",
    "keyPoints",
    "citedEvidenceIds",
    "proposedAction",
    "followUpQuestion",
    "refusal",
  ],
  properties: {
    intent: {
      type: "string",
      enum: INTENT_ENUM,
      description: "The deterministic user intent supplied in the context.",
    },
    directAnswer: {
      type: "string",
      description:
        "Direct, concise answer. Use only supplied facts and cited evidence. No reasoning or hidden chain-of-thought.",
    },
    keyPoints: {
      type: "array",
      maxItems: MAX_KEY_POINTS,
      items: {
        type: "string",
        description:
          "One short factual or safety point that is supported by the supplied facts or cited evidence.",
      },
    },
    citedEvidenceIds: {
      type: "array",
      maxItems: MAX_CITATIONS,
      items: {
        type: "string",
        description:
          "An evidence ID copied exactly from the supplied evidence packet.",
      },
    },
    proposedAction: {
      anyOf: [
        actionVariant("NONE", ["type"], {}),
        actionVariant("RETRY_PAYMENT", ["type", "cycleId"], {
          cycleId: {
            type: "string",
            description:
              "The failed cycle ID supplied in the context. Preview only.",
          },
        }),
        actionVariant("MODIFY_AMOUNT", ["type", "amount"], {
          amount: {
            type: "integer",
            minimum: 0,
            maximum: 1_000_000,
            description:
              "Monthly amount explicitly requested by the user. Preview only.",
          },
        }),
        actionVariant("MODIFY_DEBIT_DAY", ["type", "debitDay"], {
          debitDay: {
            type: "integer",
            minimum: 0,
            maximum: 31,
            description:
              "Debit day explicitly requested by the user. Preview only.",
          },
        }),
        actionVariant("RESTART_SIP", ["type"], {}),
      ],
    },
    followUpQuestion: {
      type: "string",
      description:
        "One clarifying question, or an empty string when no clarification is needed.",
    },
    refusal: {
      type: "boolean",
      description:
        "True only when the assistant must refuse a prohibited request.",
    },
  },
};

export const ASSISTANT_RESPONSE_SCHEMA_KEYS = [
  "intent",
  "directAnswer",
  "keyPoints",
  "citedEvidenceIds",
  "proposedAction",
  "followUpQuestion",
  "refusal",
] as const;

const SCHEMA_KEY_SET = new Set<string>(ASSISTANT_RESPONSE_SCHEMA_KEYS);
const ACTION_TYPE_SET = new Set<string>(ACTION_TYPE_ENUM);
const INTENT_SET = new Set<string>(INTENT_ENUM);

export interface ModelOutputParseFailure {
  issues: string[];
}

export type ModelOutputParseResult =
  | { success: true; output: AssistantModelOutput }
  | { success: false; issues: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function parseAction(
  value: unknown,
  issues: string[],
): AssistantProposedAction | null {
  if (!isRecord(value)) {
    issues.push("proposedAction must be an object.");
    return null;
  }

  const type = value.type;

  if (typeof type !== "string" || !ACTION_TYPE_SET.has(type)) {
    issues.push("proposedAction.type must be an allowed action type.");
    return null;
  }

  const keys = Object.keys(value);

  switch (type) {
    case "NONE":
      if (keys.some((key) => key !== "type")) {
        issues.push("NONE must not include action parameters.");
        return null;
      }
      return { type: "NONE" };

    case "RESTART_SIP":
      if (keys.some((key) => key !== "type")) {
        issues.push("RESTART_SIP must not include action parameters.");
        return null;
      }
      return { type: "RESTART_SIP" };

    case "RETRY_PAYMENT":
      if (keys.some((key) => key !== "type" && key !== "cycleId")) {
        issues.push("RETRY_PAYMENT must only include cycleId.");
        return null;
      }

      if (
        typeof value.cycleId !== "string" ||
        value.cycleId.trim().length === 0 ||
        value.cycleId.length > 120
      ) {
        issues.push("RETRY_PAYMENT requires a non-empty cycleId.");
        return null;
      }

      return { type: "RETRY_PAYMENT", cycleId: value.cycleId.trim() };

    case "MODIFY_AMOUNT":
      if (keys.some((key) => key !== "type" && key !== "amount")) {
        issues.push("MODIFY_AMOUNT must only include amount.");
        return null;
      }

      if (!isFiniteInteger(value.amount)) {
        issues.push("MODIFY_AMOUNT requires an integer amount.");
        return null;
      }

      return { type: "MODIFY_AMOUNT", amount: value.amount };

    case "MODIFY_DEBIT_DAY":
      if (keys.some((key) => key !== "type" && key !== "debitDay")) {
        issues.push("MODIFY_DEBIT_DAY must only include debitDay.");
        return null;
      }

      if (!isFiniteInteger(value.debitDay)) {
        issues.push("MODIFY_DEBIT_DAY requires an integer debitDay.");
        return null;
      }

      return { type: "MODIFY_DEBIT_DAY", debitDay: value.debitDay };

    default:
      issues.push("proposedAction.type is not supported.");
      return null;
  }
}

/**
 * Defensive parser for model output. The API is configured with a strict
 * schema, but the runtime gate still validates the parsed object because model
 * availability, SDK behaviour, fixtures and future schema changes must not be
 * trusted implicitly.
 */
export function parseAssistantModelOutput(
  raw: string | unknown,
): ModelOutputParseResult {
  const issues: string[] = [];
  let value: unknown;

  if (typeof raw === "string") {
    const text = raw.trim();

    if (text.length === 0) {
      return { success: false, issues: ["Model output is empty."] };
    }

    try {
      value = JSON.parse(text);
    } catch {
      return { success: false, issues: ["Model output is not valid JSON."] };
    }
  } else {
    value = raw;
  }

  if (!isRecord(value)) {
    return { success: false, issues: ["Model output must be a JSON object."] };
  }

  for (const key of Object.keys(value)) {
    if (!SCHEMA_KEY_SET.has(key)) {
      issues.push(`Unexpected property: ${key}.`);
    }
  }

  for (const key of ASSISTANT_RESPONSE_SCHEMA_KEYS) {
    if (!(key in value)) {
      issues.push(`Missing required property: ${key}.`);
    }
  }

  const intent = value.intent;

  if (typeof intent !== "string" || !INTENT_SET.has(intent)) {
    issues.push("intent must be one of the supported assistant intents.");
  }

  const directAnswer =
    typeof value.directAnswer === "string" ? value.directAnswer.trim() : "";

  if (
    typeof value.directAnswer !== "string" ||
    directAnswer.length === 0 ||
    directAnswer.length > MAX_DIRECT_ANSWER_CHARS
  ) {
    issues.push(
      `directAnswer must be a non-empty string of at most ${MAX_DIRECT_ANSWER_CHARS} characters.`,
    );
  }

  const keyPoints: string[] = [];

  if (!Array.isArray(value.keyPoints)) {
    issues.push("keyPoints must be an array.");
  } else {
    if (value.keyPoints.length > MAX_KEY_POINTS) {
      issues.push(`keyPoints must contain at most ${MAX_KEY_POINTS} items.`);
    }

    for (const item of value.keyPoints) {
      if (typeof item !== "string") {
        issues.push("Every key point must be a string.");
        continue;
      }

      const point = item.trim();

      if (point.length === 0 || point.length > MAX_KEY_POINT_CHARS) {
        issues.push(
          `Every key point must contain 1-${MAX_KEY_POINT_CHARS} characters.`,
        );
        continue;
      }

      keyPoints.push(point);
    }
  }

  const citedEvidenceIds: string[] = [];

  if (!Array.isArray(value.citedEvidenceIds)) {
    issues.push("citedEvidenceIds must be an array.");
  } else {
    if (value.citedEvidenceIds.length > MAX_CITATIONS) {
      issues.push(
        `citedEvidenceIds must contain at most ${MAX_CITATIONS} items.`,
      );
    }

    for (const item of value.citedEvidenceIds) {
      if (
        typeof item !== "string" ||
        item.trim().length === 0 ||
        item.length > 120
      ) {
        issues.push("Every cited evidence ID must be a non-empty string.");
        continue;
      }

      citedEvidenceIds.push(item.trim());
    }
  }

  const proposedAction = parseAction(value.proposedAction, issues);

  const followUpQuestion =
    typeof value.followUpQuestion === "string"
      ? value.followUpQuestion.trim()
      : null;

  if (followUpQuestion === null) {
    issues.push("followUpQuestion must be a string.");
  } else if (followUpQuestion.length > MAX_FOLLOW_UP_CHARS) {
    issues.push(
      `followUpQuestion must contain at most ${MAX_FOLLOW_UP_CHARS} characters.`,
    );
  }

  if (typeof value.refusal !== "boolean") {
    issues.push("refusal must be a boolean.");
  }

  if (
    issues.length > 0 ||
    typeof intent !== "string" ||
    !INTENT_SET.has(intent) ||
    proposedAction === null ||
    followUpQuestion === null ||
    typeof value.refusal !== "boolean"
  ) {
    return { success: false, issues };
  }

  return {
    success: true,
    output: {
      intent: intent as AssistantIntent,
      directAnswer,
      keyPoints,
      citedEvidenceIds,
      proposedAction,
      followUpQuestion,
      refusal: value.refusal,
    },
  };
}
