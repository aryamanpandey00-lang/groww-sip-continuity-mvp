import { isValidDateOnly } from "@/lib/domain/date-utils";
import { demoPolicy } from "@/lib/domain/policy";
import {
  EVIDENCE_INTENTS,
  EVIDENCE_SOURCE_TIERS,
  EVIDENCE_VERIFICATION_STATUSES,
  type EvidenceIntent,
  type EvidenceRecord,
  type EvidenceSourceTier,
  type EvidenceVerificationStatus,
} from "./types";

const REQUIRED_FIELDS = [
  "id",
  "version",
  "sourceTier",
  "intents",
  "title",
  "text",
  "keywords",
  "sourceName",
  "sourceUrl",
  "sourceDate",
  "verifiedAt",
  "verificationStatus",
  "applicableDemoPolicyVersion",
] as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export class EvidenceValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "EvidenceValidationError";
    this.issues = issues;
  }
}

export type EvidenceParseResult =
  | { success: true; data: EvidenceRecord }
  | { success: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceTier(value: unknown): value is EvidenceSourceTier {
  return (
    typeof value === "string" &&
    (EVIDENCE_SOURCE_TIERS as readonly string[]).includes(value)
  );
}

function isIntent(value: unknown): value is EvidenceIntent {
  return (
    typeof value === "string" &&
    (EVIDENCE_INTENTS as readonly string[]).includes(value)
  );
}

function isVerificationStatus(
  value: unknown,
): value is EvidenceVerificationStatus {
  return (
    typeof value === "string" &&
    (EVIDENCE_VERIFICATION_STATUSES as readonly string[]).includes(value)
  );
}

function readRequiredString(
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

  return readRequiredString(value, field, errors);
}

function readNullableDate(
  value: unknown,
  field: string,
  errors: string[],
): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || !isValidDateOnly(value)) {
    errors.push(`${field} must be null or a valid YYYY-MM-DD date.`);
    return null;
  }

  return value;
}

function readNullableUrl(
  value: unknown,
  field: string,
  errors: string[],
): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    errors.push(`${field} must be null or a URL string.`);
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      errors.push(`${field} must use http or https.`);
      return null;
    }
  } catch {
    errors.push(`${field} must be a valid URL.`);
    return null;
  }

  return value;
}

function readIntentArray(value: unknown, errors: string[]): EvidenceIntent[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("intents must be a non-empty array.");
    return [];
  }

  const intents: EvidenceIntent[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!isIntent(item)) {
      errors.push(`Unknown evidence intent: ${String(item)}.`);
      continue;
    }

    if (seen.has(item)) {
      errors.push(`Duplicate evidence intent: ${item}.`);
      continue;
    }

    seen.add(item);
    intents.push(item);
  }

  return intents;
}

function readKeywordArray(value: unknown, errors: string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("keywords must be a non-empty array.");
    return [];
  }

  const keywords: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      errors.push("Every keyword must be a non-empty string.");
      continue;
    }

    const keyword = item.trim();

    if (seen.has(keyword)) {
      errors.push(`Duplicate keyword: ${keyword}.`);
      continue;
    }

    seen.add(keyword);
    keywords.push(keyword);
  }

  return keywords;
}

export function parseEvidenceRecord(input: unknown): EvidenceParseResult {
  if (!isRecord(input)) {
    return { success: false, errors: ["Evidence record must be an object."] };
  }

  const errors: string[] = [];

  for (const key of Object.keys(input)) {
    if (!(REQUIRED_FIELDS as readonly string[]).includes(key)) {
      errors.push(`Unknown evidence field: ${key}.`);
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in input)) {
      errors.push(`Missing required evidence field: ${field}.`);
    }
  }

  const id = readRequiredString(input.id, "id", errors);
  const version = readRequiredString(input.version, "version", errors);
  const title = readRequiredString(input.title, "title", errors);
  const text = readRequiredString(input.text, "text", errors);
  const sourceName = readRequiredString(input.sourceName, "sourceName", errors);
  const sourceUrl = readNullableUrl(input.sourceUrl, "sourceUrl", errors);
  const sourceDate = readNullableDate(input.sourceDate, "sourceDate", errors);
  const verifiedAt = readNullableDate(input.verifiedAt, "verifiedAt", errors);
  const applicableDemoPolicyVersion = readNullableString(
    input.applicableDemoPolicyVersion,
    "applicableDemoPolicyVersion",
    errors,
  );
  const intents = readIntentArray(input.intents, errors);
  const keywords = readKeywordArray(input.keywords, errors);

  if (id && !ID_PATTERN.test(id)) {
    errors.push(
      "id must start with a lowercase letter or number and contain only lowercase letters, numbers, dots, underscores or hyphens.",
    );
  }

  if (version && !VERSION_PATTERN.test(version)) {
    errors.push("version must use semantic version form such as 1.0.0.");
  }

  const sourceTier = isSourceTier(input.sourceTier)
    ? input.sourceTier
    : null;

  if (!sourceTier) {
    errors.push(`Unknown evidence source tier: ${String(input.sourceTier)}.`);
  }

  const verificationStatus = isVerificationStatus(input.verificationStatus)
    ? input.verificationStatus
    : null;

  if (!verificationStatus) {
    errors.push(
      `Unknown verification status: ${String(input.verificationStatus)}.`,
    );
  }

  if (sourceTier === "demo_policy") {
    if (verificationStatus !== "fictional_demo") {
      errors.push("demo_policy records must use fictional_demo verification.");
    }

    if (applicableDemoPolicyVersion !== demoPolicy.version) {
      errors.push(
        `demo_policy records must reference ${demoPolicy.version}.`,
      );
    }

    const normalizedText = (text ?? "").toLowerCase();

    if (!normalizedText.includes("fictional demonstration rule")) {
      errors.push(
        "demo_policy text must explicitly say it is a fictional demonstration rule.",
      );
    }

    if (!normalizedText.includes("not groww policy")) {
      errors.push(
        "demo_policy text must explicitly say it is not Groww policy.",
      );
    }

    if (verifiedAt !== null) {
      errors.push(
        "fictional_demo records must not claim external source verification.",
      );
    }
  }

  if (sourceTier === "general_education") {
    if (verificationStatus === "fictional_demo") {
      errors.push(
        "general_education records cannot use fictional_demo verification.",
      );
    }

    if (applicableDemoPolicyVersion !== null) {
      errors.push(
        "general_education records cannot reference a demo policy version.",
      );
    }
  }

  if (sourceTier === "official_groww") {
    if (verificationStatus !== "verified") {
      errors.push("official_groww records must be verified.");
    }

    if (applicableDemoPolicyVersion !== null) {
      errors.push(
        "official_groww records cannot reference a demo policy version.",
      );
    }

    if (!sourceUrl) {
      errors.push("official_groww records require a source URL.");
    }
  }

  if (verificationStatus === "verified" && verifiedAt === null) {
    errors.push("verified records require a verifiedAt date.");
  }

  if (verificationStatus === "unverified" && verifiedAt !== null) {
    errors.push("unverified records cannot include a verifiedAt date.");
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      id: id as string,
      version: version as string,
      sourceTier: sourceTier as EvidenceSourceTier,
      intents,
      title: title as string,
      text: text as string,
      keywords,
      sourceName: sourceName as string,
      sourceUrl,
      sourceDate,
      verifiedAt,
      verificationStatus: verificationStatus as EvidenceVerificationStatus,
      applicableDemoPolicyVersion,
    },
  };
}

export function validateEvidenceRecord(input: unknown): EvidenceRecord {
  const result = parseEvidenceRecord(input);

  if (!result.success) {
    throw new EvidenceValidationError(result.errors);
  }

  return result.data;
}

export function assertUniqueEvidenceIds(records: EvidenceRecord[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const record of records) {
    if (seen.has(record.id)) {
      duplicates.add(record.id);
    }

    seen.add(record.id);
  }

  if (duplicates.size > 0) {
    throw new EvidenceValidationError([
      `Duplicate evidence IDs: ${[...duplicates].sort().join(", ")}.`,
    ]);
  }
}
