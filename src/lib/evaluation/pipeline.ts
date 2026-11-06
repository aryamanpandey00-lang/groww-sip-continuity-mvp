import {
  assertFixtureResponsesValid,
  assertGoldenDatasetValid,
  loadFixtureResponses,
  loadGoldenDataset,
} from "./loader";
import { buildEvaluationReport } from "./report";
import { evaluateFixtureCases } from "./runner";
import type {
  EvaluationCaseResult,
  EvaluationReport,
  EvaluationThresholds,
  LoadedFixtureResponses,
  LoadedGoldenDataset,
} from "./types";

export interface RunFixtureEvaluationOptions {
  dataset?: LoadedGoldenDataset;
  fixtures?: LoadedFixtureResponses;
  generatedAt?: string;
  thresholds?: EvaluationThresholds;
}

export interface FixtureEvaluationRun {
  dataset: LoadedGoldenDataset;
  fixtures: LoadedFixtureResponses;
  caseResults: EvaluationCaseResult[];
  report: EvaluationReport;
}

export function runFixtureEvaluation(
  options: RunFixtureEvaluationOptions = {},
): FixtureEvaluationRun {
  const dataset = options.dataset ?? loadGoldenDataset();
  const datasetCases = assertGoldenDatasetValid(dataset);
  const fixtures =
    options.fixtures ?? loadFixtureResponses(datasetCases);
  const responses = assertFixtureResponsesValid(fixtures);
  const caseResults = evaluateFixtureCases(datasetCases, responses);
  const report = buildEvaluationReport({
    dataset,
    fixtures,
    caseResults,
    generatedAt: options.generatedAt,
    thresholds: options.thresholds,
  });

  return { dataset, fixtures, caseResults, report };
}
