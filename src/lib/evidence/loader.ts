import { readFileSync } from "node:fs";
import { demoPolicy } from "@/lib/domain/policy";
import {
  EvidenceValidationError,
  assertUniqueEvidenceIds,
  validateEvidenceRecord,
} from "./schema";
import type { EvidenceRecord } from "./types";

const POLICY_PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export class EvidenceCorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceCorpusError";
  }
}

function resolvePolicyTemplate(value: string): string {
  return value.replace(POLICY_PLACEHOLDER_PATTERN, (_match, key: string) => {
    if (!(key in demoPolicy)) {
      throw new EvidenceCorpusError(
        `Unknown demo policy placeholder in corpus: ${key}.`,
      );
    }

    const policyValue = demoPolicy[key as keyof typeof demoPolicy];

    if (typeof policyValue !== "string" && typeof policyValue !== "number") {
      throw new EvidenceCorpusError(
        `Unsupported demo policy placeholder value: ${key}.`,
      );
    }

    return String(policyValue);
  });
}

function hydratePolicyTemplates(value: unknown): unknown {
  if (typeof value === "string") {
    return resolvePolicyTemplate(value);
  }

  if (Array.isArray(value)) {
    return value.map(hydratePolicyTemplates);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        hydratePolicyTemplates(nestedValue),
      ]),
    );
  }

  return value;
}

/**
 * Parses and validates JSONL evidence records. Demo-policy placeholders are
 * hydrated from the authoritative domain policy constants before validation.
 */
export function loadEvidenceCorpusFromJsonl(source: string): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  const ids = new Set<string>();
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new EvidenceCorpusError(
        `Invalid JSON on corpus line ${lineNumber}: ${String(error)}`,
      );
    }

    let record: EvidenceRecord;

    try {
      record = validateEvidenceRecord(hydratePolicyTemplates(parsed));
    } catch (error) {
      if (error instanceof EvidenceValidationError) {
        throw new EvidenceCorpusError(
          `Invalid evidence record on corpus line ${lineNumber}: ${error.issues.join("; ")}`,
        );
      }

      throw error;
    }

    if (ids.has(record.id)) {
      throw new EvidenceCorpusError(
        `Duplicate evidence ID "${record.id}" on corpus line ${lineNumber}.`,
      );
    }

    ids.add(record.id);
    records.push(record);
  });

  assertUniqueEvidenceIds(records);
  return records;
}

export function loadDefaultEvidenceCorpus(): EvidenceRecord[] {
  const corpusUrl = new URL("./corpus.jsonl", import.meta.url);

  try {
    return loadEvidenceCorpusFromJsonl(readFileSync(corpusUrl, "utf8"));
  } catch (error) {
    if (error instanceof EvidenceCorpusError) {
      throw error;
    }

    throw new EvidenceCorpusError(
      `Unable to load the default evidence corpus: ${String(error)}`,
    );
  }
}

export const defaultEvidenceCorpus = loadDefaultEvidenceCorpus();
