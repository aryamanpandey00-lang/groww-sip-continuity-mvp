import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURE_RESPONSE_FILE,
  GOLDEN_DATASET_FILE,
  type FixtureCandidateResponse,
  type GoldenCase,
  type LoadedFixtureResponses,
  type LoadedGoldenDataset,
} from "./types";
import {
  FixtureValidationError,
  GoldenDatasetValidationError,
  validateFixtureResponses,
  validateGoldenDataset,
  type ValidateGoldenDatasetOptions,
} from "./schema";

export class EvaluationFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationFileError";
  }
}

export function hashEvaluationSource(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function parseJsonlSource(source: string): unknown[] {
  const values: unknown[] = [];
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      return;
    }

    try {
      values.push(JSON.parse(trimmed));
    } catch (error) {
      throw new EvaluationFileError(
        `Invalid JSON on line ${index + 1}: ${String(error)}`,
      );
    }
  });

  return values;
}

export function loadGoldenDatasetFromSource(
  source: string,
  options: ValidateGoldenDatasetOptions = {},
): LoadedGoldenDataset {
  const values = parseJsonlSource(source);
  const validation = validateGoldenDataset(values, options);

  return {
    cases: validation.parsedCases,
    source,
    hash: hashEvaluationSource(source),
    validation: {
      valid: validation.valid,
      errors: validation.errors,
      counts: validation.counts,
    },
  };
}

export function loadGoldenDataset(
  options: ValidateGoldenDatasetOptions = {},
): LoadedGoldenDataset {
  const path = join(process.cwd(), GOLDEN_DATASET_FILE);

  try {
    return loadGoldenDatasetFromSource(readFileSync(path, "utf8"), options);
  } catch (error) {
    if (error instanceof EvaluationFileError) {
      throw error;
    }

    throw new EvaluationFileError(
      `Unable to load golden dataset at ${path}: ${String(error)}`,
    );
  }
}

export function assertGoldenDatasetValid(
  dataset: LoadedGoldenDataset,
): GoldenCase[] {
  if (!dataset.validation.valid) {
    throw new GoldenDatasetValidationError(dataset.validation.errors);
  }

  return dataset.cases;
}

export function loadFixtureResponsesFromSource(
  source: string,
  datasetCases: GoldenCase[],
): LoadedFixtureResponses {
  const values = parseJsonlSource(source);
  const validation = validateFixtureResponses(values, datasetCases);

  return {
    responses: validation.responses,
    source,
    hash: hashEvaluationSource(source),
    validation,
  };
}

export function loadFixtureResponses(
  datasetCases: GoldenCase[],
): LoadedFixtureResponses {
  const path = join(process.cwd(), FIXTURE_RESPONSE_FILE);

  try {
    return loadFixtureResponsesFromSource(
      readFileSync(path, "utf8"),
      datasetCases,
    );
  } catch (error) {
    if (error instanceof EvaluationFileError) {
      throw error;
    }

    throw new EvaluationFileError(
      `Unable to load fixture responses at ${path}: ${String(error)}`,
    );
  }
}

export function assertFixtureResponsesValid(
  fixture: LoadedFixtureResponses,
): FixtureCandidateResponse[] {
  if (!fixture.validation.valid) {
    throw new FixtureValidationError(fixture.validation.errors);
  }

  return fixture.responses;
}
