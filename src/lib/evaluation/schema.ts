import { isValidDateOnly } from "@/lib/domain/date-utils";
import {
  validateDebitDay,
  validateSipAmount,
} from "@/lib/domain/modification-engine";
import { defaultEvidenceCorpus } from "@/lib/evidence";
import { normalizeText } from "@/lib/evidence/scoring";
import type { EvidenceIntent, EvidenceRecord } from "@/lib/evidence";
import {
  CONVERSATION_ROLES,
  GOLDEN_ACTION_TYPES,
  GOLDEN_CATEGORIES,
  GOLDEN_DATASET_VERSION,
  GOLDEN_DEMO_STATE_VARIANTS,
  GOLDEN_EVALUATION_INTENTS,
  GOLDEN_FALLBACK_REASONS,
  GOLDEN_INTENTS,
  GOLDEN_REVIEW_STATUSES,
  GOLDEN_SEVERITIES,
  GOLDEN_SPLITS,
  type FixtureCandidateResponse,
  type GoldenAction,
  type GoldenCase,
  type GoldenCategory,
  type GoldenConversationMessage,
  type GoldenDatasetCounts,
  type GoldenDatasetValidation,
  type GoldenDemoStateVariant,
  type GoldenFallbackReason,
  type GoldenFinancialFacts,
  type GoldenIntent,
  type GoldenResponsePoint,
  type GoldenReviewStatus,
  type GoldenSeverity,
  type GoldenSplit,
  type FixtureValidation,
} from "./types";

const REQUIRED_CASE_FIELDS = [
  "id",
  "datasetVersion",
  "split",
  "category",
  "severity",
  "investorQuestion",
  "demoStateVariant",
  "conversationHistory",
  "expectedIntent",
  "expectedEvidenceIds",
  "expectedResponsePoints",
  "prohibitedClaims",
  "expectedAction",
  "expectedFallback",
  "expectedFallbackReason",
  "humanReferenceResponse",
  "reviewStatus",
  "evidenceLogReference",
] as const;

const REQUIRED_FIXTURE_FIELDS = [
  "caseId",
  "fixtureSource",
  "reportedIntent",
  "citedEvidenceIds",
  "financialFacts",
  "proposedAction",
  "fallback",
  "fallbackReason",
  "responseText",
] as const;

const CASE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const EVIDENCE_LOG_PATTERN = /^EVL-[A-Z0-9][A-Z0-9-]*$/;

const GENERAL_EDUCATION_INTENTS = new Set<EvidenceIntent>([
  "sip_basics",
  "market_volatility",
  "investment_risk",
  "guaranteed_returns",
  "long_term_investing",
  "sip_discipline",
  "investor_support",
  "sip_vs_lumpsum",
]);

const FALLBACK_REASONS_REQUIRING_EMPTY_EVIDENCE = new Set<GoldenFallbackReason>([
  "OFFICIAL_EVIDENCE_UNAVAILABLE",
  "ACCOUNT_SPECIFIC_UNAVAILABLE",
  "INSUFFICIENT_EVIDENCE",
  "MODEL_UNAVAILABLE",
]);

export class GoldenDatasetValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "GoldenDatasetValidationError";
    this.issues = issues;
  }
}

export class FixtureValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "FixtureValidationError";
    this.issues = issues;
  }
}

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function readString(
  value: unknown,
  field: string,
  errors: string[],
): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string.`);
    return null;
  }

  return value.trim();
}

function readNullableString(
  value: unknown,
  field: string,
  errors: string[],
): string | null {
  if (value === null) {
    return null;
  }

  return readString(value, field, errors);
}

function readBoolean(
  value: unknown,
  field: string,
  errors: string[],
): boolean | null {
  if (typeof value !== "boolean") {
    errors.push(`${field} must be a boolean.`);
    return null;
  }

  return value;
}

function readStringArray(
  value: unknown,
  field: string,
  errors: string[],
  options: { allowEmpty?: boolean } = {},
): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array.`);
    return [];
  }

  if (!options.allowEmpty && value.length === 0) {
    errors.push(`${field} must not be empty.`);
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      errors.push(`${field} entries must be non-empty strings.`);
      continue;
    }

    const normalized = item.trim();

    if (seen.has(normalized)) {
      errors.push(`${field} must not contain duplicates: ${normalized}.`);
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function readConversationHistory(
  value: unknown,
  errors: string[],
): GoldenConversationMessage[] {
  if (!Array.isArray(value)) {
    errors.push("conversationHistory must be an array.");
    return [];
  }

  const messages: GoldenConversationMessage[] = [];

  value.forEach((message, index) => {
    if (!isRecord(message)) {
      errors.push(`conversationHistory[${index}] must be an object.`);
      return;
    }

    for (const key of Object.keys(message)) {
      if (key !== "role" && key !== "content") {
        errors.push(
          `conversationHistory[${index}] has unknown field: ${key}.`,
        );
      }
    }

    if (!isOneOf(message.role, CONVERSATION_ROLES)) {
      errors.push(
        `conversationHistory[${index}].role must be user or assistant.`,
      );
      return;
    }

    const content = readString(
      message.content,
      `conversationHistory[${index}].content`,
      errors,
    );

    if (content) {
      messages.push({ role: message.role, content });
    }
  });

  return messages;
}

function readResponsePoints(
  value: unknown,
  errors: string[],
): GoldenResponsePoint[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("expectedResponsePoints must be a non-empty array.");
    return [];
  }

  const points: GoldenResponsePoint[] = [];
  const seenIds = new Set<string>();

  value.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`expectedResponsePoints[${index}] must be an object.`);
      return;
    }

    for (const key of Object.keys(item)) {
      if (key !== "id" && key !== "description" && key !== "requiredTerms") {
        errors.push(
          `expectedResponsePoints[${index}] has unknown field: ${key}.`,
        );
      }
    }

    const id = readString(
      item.id,
      `expectedResponsePoints[${index}].id`,
      errors,
    );
    const description = readString(
      item.description,
      `expectedResponsePoints[${index}].description`,
      errors,
    );
    const requiredTerms = readStringArray(
      item.requiredTerms,
      `expectedResponsePoints[${index}].requiredTerms`,
      errors,
    );

    if (id && seenIds.has(id)) {
      errors.push(`Duplicate expectedResponsePoints id: ${id}.`);
    }

    if (id) {
      seenIds.add(id);
    }

    if (id && description && requiredTerms.length > 0) {
      points.push({ id, description, requiredTerms });
    }
  });

  return points;
}

function readAction(
  value: unknown,
  field: string,
  errors: string[],
): GoldenAction | null {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object.`);
    return null;
  }

  if (!isOneOf(value.type, GOLDEN_ACTION_TYPES)) {
    errors.push(`${field}.type is not a valid action type.`);
    return null;
  }

  const allowedFields: Record<string, readonly string[]> = {
    NONE: ["type"],
    RETRY_PAYMENT: ["type", "cycleId"],
    MODIFY_AMOUNT: ["type", "amount"],
    MODIFY_DEBIT_DAY: ["type", "debitDay"],
    RESTART_SIP: ["type"],
  };

  for (const key of Object.keys(value)) {
    if (!allowedFields[value.type].includes(key)) {
      errors.push(`${field}.${key} is not valid for ${value.type}.`);
    }
  }

  switch (value.type) {
    case "NONE":
      return { type: "NONE" };
    case "RESTART_SIP":
      return { type: "RESTART_SIP" };
    case "RETRY_PAYMENT": {
      const cycleId = readString(value.cycleId, `${field}.cycleId`, errors);
      return cycleId ? { type: "RETRY_PAYMENT", cycleId } : null;
    }
    case "MODIFY_AMOUNT": {
      if (typeof value.amount !== "number" || !Number.isFinite(value.amount)) {
        errors.push(`${field}.amount must be a finite number.`);
        return null;
      }

      const amountErrors = validateSipAmount(value.amount);

      for (const amountError of amountErrors) {
        errors.push(`${field}.amount is invalid: ${amountError}`);
      }

      return amountErrors.length === 0
        ? { type: "MODIFY_AMOUNT", amount: value.amount }
        : null;
    }
    case "MODIFY_DEBIT_DAY": {
      if (
        typeof value.debitDay !== "number" ||
        !Number.isFinite(value.debitDay)
      ) {
        errors.push(`${field}.debitDay must be a finite number.`);
        return null;
      }

      const debitDayErrors = validateDebitDay(value.debitDay);

      for (const debitDayError of debitDayErrors) {
        errors.push(`${field}.debitDay is invalid: ${debitDayError}`);
      }

      return debitDayErrors.length === 0
        ? { type: "MODIFY_DEBIT_DAY", debitDay: value.debitDay }
        : null;
    }
  }
}

function readFinancialFacts(
  value: unknown,
  field: string,
  errors: string[],
): GoldenFinancialFacts {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object.`);
    return {};
  }

  const allowedFields = [
    "sipStatus",
    "monthlyAmount",
    "debitDay",
    "retryEligible",
    "retryDeadline",
    "retryAttemptsUsed",
    "retryAttemptsRemaining",
    "rewardEligibleInstalments",
    "rewardTargetInstalments",
    "rewardUnlocked",
    "restartEligible",
    "restartDeadline",
    "restartDaysRemaining",
  ] as const;
  const facts: GoldenFinancialFacts = {};

  for (const key of Object.keys(value)) {
    if (!(allowedFields as readonly string[]).includes(key)) {
      errors.push(`${field}.${key} is not a supported financial fact.`);
    }
  }

  function optionalNumber(key: keyof GoldenFinancialFacts): void {
    const item = (value as Record<string, unknown>)[key];

    if (item === undefined) {
      return;
    }

    if (typeof item !== "number" || !Number.isFinite(item)) {
      errors.push(`${field}.${key} must be a finite number.`);
      return;
    }

    (facts as Record<string, unknown>)[key] = item;
  }

  function optionalBooleanOrNull(key: keyof GoldenFinancialFacts): void {
    const item = (value as Record<string, unknown>)[key];

    if (item === undefined) {
      return;
    }

    if (item !== null && typeof item !== "boolean") {
      errors.push(`${field}.${key} must be a boolean or null.`);
      return;
    }

    (facts as Record<string, unknown>)[key] = item;
  }

  function optionalNumberOrNull(key: keyof GoldenFinancialFacts): void {
    const item = (value as Record<string, unknown>)[key];

    if (item === undefined) {
      return;
    }

    if (item !== null && (typeof item !== "number" || !Number.isFinite(item))) {
      errors.push(`${field}.${key} must be a finite number or null.`);
      return;
    }

    (facts as Record<string, unknown>)[key] = item;
  }

  function optionalDateOrNull(key: keyof GoldenFinancialFacts): void {
    const item = (value as Record<string, unknown>)[key];

    if (item === undefined) {
      return;
    }

    if (item !== null && (typeof item !== "string" || !isValidDateOnly(item))) {
      errors.push(`${field}.${key} must be a valid YYYY-MM-DD date or null.`);
      return;
    }

    (facts as Record<string, unknown>)[key] = item;
  }

  if (value.sipStatus !== undefined) {
    if (
      value.sipStatus !== "ACTIVE" &&
      value.sipStatus !== "PAUSED" &&
      value.sipStatus !== "STOPPED"
    ) {
      errors.push(`${field}.sipStatus must be ACTIVE, PAUSED or STOPPED.`);
    } else {
      facts.sipStatus = value.sipStatus;
    }
  }

  optionalNumber("monthlyAmount");
  optionalNumber("debitDay");
  optionalBooleanOrNull("retryEligible");
  optionalDateOrNull("retryDeadline");
  optionalNumberOrNull("retryAttemptsUsed");
  optionalNumberOrNull("retryAttemptsRemaining");
  optionalNumber("rewardEligibleInstalments");
  optionalNumber("rewardTargetInstalments");

  if (value.rewardUnlocked !== undefined) {
    if (typeof value.rewardUnlocked !== "boolean") {
      errors.push(`${field}.rewardUnlocked must be a boolean.`);
    } else {
      facts.rewardUnlocked = value.rewardUnlocked;
    }
  }

  optionalBooleanOrNull("restartEligible");
  optionalDateOrNull("restartDeadline");
  optionalNumberOrNull("restartDaysRemaining");

  return facts;
}

export function isResolvedEvidenceLogReference(
  value: string | null,
): value is string {
  return typeof value === "string" && EVIDENCE_LOG_PATTERN.test(value);
}

function expectedTierForIntent(
  intent: EvidenceIntent,
): "demo_policy" | "general_education" | "official_groww" | null {
  if (GENERAL_EDUCATION_INTENTS.has(intent)) {
    return "general_education";
  }

  if (intent === "official_groww_policy") {
    return "official_groww";
  }

  if (intent === "account_specific") {
    return null;
  }

  return "demo_policy";
}

export interface ParseGoldenCaseOptions {
  corpusById?: Map<string, EvidenceRecord>;
}

export function parseGoldenCase(
  input: unknown,
  options: ParseGoldenCaseOptions = {},
): ParseResult<GoldenCase> {
  if (!isRecord(input)) {
    return { success: false, errors: ["Golden case must be an object."] };
  }

  const errors: string[] = [];
  const corpusById =
    options.corpusById ??
    new Map(defaultEvidenceCorpus.map((record) => [record.id, record]));

  for (const key of Object.keys(input)) {
    if (!(REQUIRED_CASE_FIELDS as readonly string[]).includes(key)) {
      errors.push(`Unknown golden-case field: ${key}.`);
    }
  }

  for (const field of REQUIRED_CASE_FIELDS) {
    if (!(field in input)) {
      errors.push(`Missing required golden-case field: ${field}.`);
    }
  }

  const id = readString(input.id, "id", errors);
  const datasetVersion = readString(
    input.datasetVersion,
    "datasetVersion",
    errors,
  );
  const investorQuestion = readString(
    input.investorQuestion,
    "investorQuestion",
    errors,
  );
  const humanReferenceResponse = readString(
    input.humanReferenceResponse,
    "humanReferenceResponse",
    errors,
  );
  const split = isOneOf(input.split, GOLDEN_SPLITS)
    ? (input.split as GoldenSplit)
    : null;
  const category = isOneOf(input.category, GOLDEN_CATEGORIES)
    ? (input.category as GoldenCategory)
    : null;
  const severity = isOneOf(input.severity, GOLDEN_SEVERITIES)
    ? (input.severity as GoldenSeverity)
    : null;
  const demoStateVariant = isOneOf(
    input.demoStateVariant,
    GOLDEN_DEMO_STATE_VARIANTS,
  )
    ? (input.demoStateVariant as GoldenDemoStateVariant)
    : null;
  const expectedIntent = isOneOf(input.expectedIntent, GOLDEN_INTENTS)
    ? (input.expectedIntent as GoldenIntent)
    : null;
  const expectedFallback = readBoolean(
    input.expectedFallback,
    "expectedFallback",
    errors,
  );
  const expectedFallbackReason = isOneOf(
    input.expectedFallbackReason,
    GOLDEN_FALLBACK_REASONS,
  )
    ? (input.expectedFallbackReason as GoldenFallbackReason)
    : null;
  const reviewStatus = isOneOf(input.reviewStatus, GOLDEN_REVIEW_STATUSES)
    ? (input.reviewStatus as GoldenReviewStatus)
    : null;
  const evidenceLogReference = readNullableString(
    input.evidenceLogReference,
    "evidenceLogReference",
    errors,
  );
  const conversationHistory = readConversationHistory(
    input.conversationHistory,
    errors,
  );
  const expectedEvidenceIds = readStringArray(
    input.expectedEvidenceIds,
    "expectedEvidenceIds",
    errors,
    { allowEmpty: true },
  );
  const expectedResponsePoints = readResponsePoints(
    input.expectedResponsePoints,
    errors,
  );
  const prohibitedClaims = readStringArray(
    input.prohibitedClaims,
    "prohibitedClaims",
    errors,
    { allowEmpty: true },
  );
  const expectedAction = readAction(
    input.expectedAction,
    "expectedAction",
    errors,
  );

  if (!split) {
    errors.push(`Unknown golden split: ${String(input.split)}.`);
  }

  if (!category) {
    errors.push(`Unknown golden category: ${String(input.category)}.`);
  }

  if (!severity) {
    errors.push(`Unknown golden severity: ${String(input.severity)}.`);
  }

  if (!demoStateVariant) {
    errors.push(
      `Unknown demoStateVariant: ${String(input.demoStateVariant)}.`,
    );
  }

  if (!expectedIntent) {
    errors.push(`Unknown expectedIntent: ${String(input.expectedIntent)}.`);
  }

  if (!expectedFallbackReason) {
    errors.push(
      `Unknown expectedFallbackReason: ${String(input.expectedFallbackReason)}.`,
    );
  }

  if (!reviewStatus) {
    errors.push(`Unknown reviewStatus: ${String(input.reviewStatus)}.`);
  }

  if (id && !CASE_ID_PATTERN.test(id)) {
    errors.push(
      "id must start with a lowercase letter or number and contain only lowercase letters, numbers, dots, underscores or hyphens.",
    );
  }

  if (datasetVersion && datasetVersion !== GOLDEN_DATASET_VERSION) {
    errors.push(
      `datasetVersion must be ${GOLDEN_DATASET_VERSION}, received ${datasetVersion}.`,
    );
  }

  if (expectedFallback !== null && expectedFallbackReason) {
    if (expectedFallback && expectedFallbackReason === "NONE") {
      errors.push("expectedFallbackReason must not be NONE when fallback is true.");
    }

    if (!expectedFallback && expectedFallbackReason !== "NONE") {
      errors.push("expectedFallbackReason must be NONE when fallback is false.");
    }

    if (
      expectedFallbackReason &&
      FALLBACK_REASONS_REQUIRING_EMPTY_EVIDENCE.has(expectedFallbackReason) &&
      expectedEvidenceIds.length > 0
    ) {
      errors.push(
        `${expectedFallbackReason} requires expectedEvidenceIds to be empty.`,
      );
    }

    if (
      expectedFallback === true &&
      expectedAction !== null &&
      expectedAction.type !== "NONE"
    ) {
      errors.push(
        "expectedAction must be NONE when expectedFallback is true.",
      );
    }
  }

  if (reviewStatus === "human_reviewed" && !isResolvedEvidenceLogReference(evidenceLogReference)) {
    errors.push(
      "human_reviewed requires a resolved Evidence Log reference such as EVL-...",
    );
  }

  if (
    evidenceLogReference !== null &&
    evidenceLogReference !== "pending" &&
    !EVIDENCE_LOG_PATTERN.test(evidenceLogReference)
  ) {
    errors.push(
      "evidenceLogReference must be null, pending, or an EVL-... reference.",
    );
  }

  if (expectedIntent) {
    if (expectedEvidenceIds.length > 0) {
      if (!isOneOf(expectedIntent, [
        "retry_payment",
        "insufficient_funds",
        "retry_attempt_limit",
        "modify_sip_amount",
        "modify_debit_day",
        "restart_sip",
        "reward_progress",
        "missed_cycle",
        "successful_retry_reward",
        "action_confirmation",
        "simulated_action_disclaimer",
        "sip_basics",
        "market_volatility",
        "investment_risk",
        "guaranteed_returns",
        "long_term_investing",
        "sip_discipline",
        "investor_support",
        "sip_vs_lumpsum",
      ])) {
        errors.push(
          "Evaluation-only intents must not have expectedEvidenceIds.",
        );
      }
    }

    if (
      !isOneOf(expectedIntent, GOLDEN_EVALUATION_INTENTS) &&
      expectedEvidenceIds.length === 0 &&
      expectedIntent !== "official_groww_policy" &&
      expectedIntent !== "account_specific"
    ) {
      errors.push(
        "Normal evidence intents must have expectedEvidenceIds unless the case is official/account-specific.",
      );
    }

    const expectedTier = isOneOf(expectedIntent, GOLDEN_EVALUATION_INTENTS)
      ? null
      : expectedTierForIntent(expectedIntent as EvidenceIntent);

    for (const evidenceId of expectedEvidenceIds) {
      const record = corpusById.get(evidenceId);

      if (!record) {
        errors.push(`Unknown expectedEvidenceId: ${evidenceId}.`);
        continue;
      }

      if (!record.intents.includes(expectedIntent as EvidenceIntent)) {
        errors.push(
          `Evidence ${evidenceId} does not support intent ${expectedIntent}.`,
        );
      }

      if (expectedTier && record.sourceTier !== expectedTier) {
        errors.push(
          `Evidence ${evidenceId} has tier ${record.sourceTier}; expected ${expectedTier} for intent ${expectedIntent}.`,
        );
      }
    }
  }

  if (humanReferenceResponse) {
    const normalizedReference = normalizeText(humanReferenceResponse);

    for (const responsePoint of expectedResponsePoints) {
      for (const term of responsePoint.requiredTerms) {
        if (!normalizedReference.includes(normalizeText(term))) {
          errors.push(
            `humanReferenceResponse is missing response-point term "${term}" for ${responsePoint.id}.`,
          );
        }
      }
    }

    for (const claim of prohibitedClaims) {
      if (normalizedReference.includes(normalizeText(claim))) {
        errors.push(
          `humanReferenceResponse contains prohibited claim: ${claim}.`,
        );
      }
    }
  }

  if (
    errors.length > 0 ||
    !id ||
    !datasetVersion ||
    !split ||
    !category ||
    !severity ||
    !investorQuestion ||
    !demoStateVariant ||
    !expectedIntent ||
    !expectedAction ||
    expectedFallback === null ||
    !expectedFallbackReason ||
    !humanReferenceResponse ||
    !reviewStatus
  ) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      id,
      datasetVersion,
      split,
      category,
      severity,
      investorQuestion,
      demoStateVariant,
      conversationHistory,
      expectedIntent,
      expectedEvidenceIds,
      expectedResponsePoints,
      prohibitedClaims,
      expectedAction,
      expectedFallback: expectedFallback as boolean,
      expectedFallbackReason,
      humanReferenceResponse,
      reviewStatus,
      evidenceLogReference,
    },
  };
  }

function emptyCounts(): GoldenDatasetCounts {
  return {
    bySplit: { dev: 0, holdout: 0, adversarial: 0 },
    byCategory: {},
  };
}

export interface ValidateGoldenDatasetOptions {
  corpus?: EvidenceRecord[];
  expectedSplitCounts?: Record<GoldenSplit, number>;
}

export function validateGoldenDataset(
  input: unknown[],
  options: ValidateGoldenDatasetOptions = {},
): GoldenDatasetValidation & { parsedCases: GoldenCase[] } {
  const corpusById = new Map(
    (options.corpus ?? defaultEvidenceCorpus).map((record) => [record.id, record]),
  );
  const expectedSplitCounts = options.expectedSplitCounts ?? {
    dev: 29,
    holdout: 12,
    adversarial: 7,
  };
  const errors: string[] = [];
  const parsedCases: GoldenCase[] = [];
  const ids = new Set<string>();
  const counts = emptyCounts();

  input.forEach((item, index) => {
    const parsed = parseGoldenCase(item, { corpusById });

    if (!parsed.success) {
      const candidateId =
        isRecord(item) && typeof item.id === "string" ? item.id : null;
      const prefix = candidateId ? `Case ${candidateId}` : `Case ${index + 1}`;
      errors.push(...parsed.errors.map((error) => `${prefix}: ${error}`));
      return;
    }

    if (ids.has(parsed.data.id)) {
      errors.push(`Duplicate golden case ID: ${parsed.data.id}.`);
      return;
    }

    ids.add(parsed.data.id);
    parsedCases.push(parsed.data);
    counts.bySplit[parsed.data.split] += 1;
    counts.byCategory[parsed.data.category] =
      (counts.byCategory[parsed.data.category] ?? 0) + 1;
  });

  for (const split of GOLDEN_SPLITS) {
    if (counts.bySplit[split] !== expectedSplitCounts[split]) {
      errors.push(
        `Split ${split} must contain ${expectedSplitCounts[split]} cases; found ${counts.bySplit[split]}.`,
      );
    }
  }

  if (parsedCases.length !== Object.values(expectedSplitCounts).reduce((a, b) => a + b, 0)) {
    errors.push(
      `Dataset must contain ${Object.values(expectedSplitCounts).reduce((a, b) => a + b, 0)} valid cases; found ${parsedCases.length}.`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    counts,
    parsedCases,
  };
}

export function parseFixtureCandidateResponse(
  input: unknown,
  datasetCaseIds: Set<string>,
): ParseResult<FixtureCandidateResponse> {
  if (!isRecord(input)) {
    return { success: false, errors: ["Fixture response must be an object."] };
  }

  const errors: string[] = [];

  for (const key of Object.keys(input)) {
    if (!(REQUIRED_FIXTURE_FIELDS as readonly string[]).includes(key)) {
      errors.push(`Unknown fixture-response field: ${key}.`);
    }
  }

  for (const field of REQUIRED_FIXTURE_FIELDS) {
    if (!(field in input)) {
      errors.push(`Missing required fixture-response field: ${field}.`);
    }
  }

  const caseId = readString(input.caseId, "caseId", errors);
  const responseText = readString(input.responseText, "responseText", errors);
  const fixtureSource =
    input.fixtureSource === "handcrafted_reference_fixture"
      ? input.fixtureSource
      : null;

  if (!fixtureSource) {
    errors.push(
      "fixtureSource must be handcrafted_reference_fixture; live-model outputs are not allowed in Phase 4.",
    );
  }

  if (caseId && !datasetCaseIds.has(caseId)) {
    errors.push(`Unknown dataset caseId: ${caseId}.`);
  }

  const reportedIntent = isOneOf(input.reportedIntent, GOLDEN_INTENTS)
    ? (input.reportedIntent as GoldenIntent)
    : null;

  if (!reportedIntent) {
    errors.push(`Unknown reportedIntent: ${String(input.reportedIntent)}.`);
  }

  const citedEvidenceIds = readStringArray(
    input.citedEvidenceIds,
    "citedEvidenceIds",
    errors,
    { allowEmpty: true },
  );
  const financialFacts = readFinancialFacts(
    input.financialFacts,
    "financialFacts",
    errors,
  );
  const proposedAction = readAction(
    input.proposedAction,
    "proposedAction",
    errors,
  );
  const fallback = readBoolean(input.fallback, "fallback", errors);
  const fallbackReason = isOneOf(input.fallbackReason, GOLDEN_FALLBACK_REASONS)
    ? (input.fallbackReason as GoldenFallbackReason)
    : null;

  if (!fallbackReason) {
    errors.push(`Unknown fallbackReason: ${String(input.fallbackReason)}.`);
  }

  if (fallback !== null && fallbackReason) {
    if (fallback && fallbackReason === "NONE") {
      errors.push("fallbackReason must not be NONE when fallback is true.");
    }

    if (!fallback && fallbackReason !== "NONE") {
      errors.push("fallbackReason must be NONE when fallback is false.");
    }
  }

  if (
    errors.length > 0 ||
    !caseId ||
    !fixtureSource ||
    !reportedIntent ||
    !proposedAction ||
    fallback === null ||
    !fallbackReason ||
    !responseText
  ) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      caseId,
      fixtureSource,
      reportedIntent,
      citedEvidenceIds,
      financialFacts,
      proposedAction,
      fallback,
      fallbackReason,
      responseText,
    },
  };
}

export function validateFixtureResponses(
  input: unknown[],
  datasetCases: GoldenCase[],
): FixtureValidation {
  const caseIds = new Set(datasetCases.map((item) => item.id));
  const errors: string[] = [];
  const responses: FixtureCandidateResponse[] = [];
  const seenCaseIds = new Set<string>();

  input.forEach((item, index) => {
    const parsed = parseFixtureCandidateResponse(item, caseIds);

    if (!parsed.success) {
      const candidateId =
        isRecord(item) && typeof item.caseId === "string" ? item.caseId : null;
      const prefix = candidateId
        ? `Fixture ${candidateId}`
        : `Fixture ${index + 1}`;
      errors.push(...parsed.errors.map((error) => `${prefix}: ${error}`));
      return;
    }

    if (seenCaseIds.has(parsed.data.caseId)) {
      errors.push(`Duplicate fixture response for case ${parsed.data.caseId}.`);
      return;
    }

    seenCaseIds.add(parsed.data.caseId);
    responses.push(parsed.data);
  });

  for (const caseId of caseIds) {
    if (!seenCaseIds.has(caseId)) {
      errors.push(`Missing fixture response for case ${caseId}.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    responses,
  };
}
