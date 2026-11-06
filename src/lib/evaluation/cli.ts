import { EVIDENCE_CORPUS_VERSION } from "@/lib/evidence";
import { loadGoldenDataset } from "./loader";
import { runFixtureEvaluation } from "./pipeline";
import { writeEvaluationReport } from "./report";
import { isResolvedEvidenceLogReference } from "./schema";
import type { EvaluationMetricSet, LoadedGoldenDataset } from "./types";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printDatasetSummary(dataset: LoadedGoldenDataset): void {
  console.log(`Dataset version: ${dataset.cases[0]?.datasetVersion ?? "unknown"}`);
  console.log(`Dataset SHA-256: ${dataset.hash}`);
  console.log(`Case counts: ${dataset.cases.length}`);
  console.log(
    `Splits: dev ${dataset.validation.counts.bySplit.dev}, holdout ${dataset.validation.counts.bySplit.holdout}, adversarial ${dataset.validation.counts.bySplit.adversarial}`,
  );
  console.log(`Evidence corpus: ${EVIDENCE_CORPUS_VERSION}`);
  const categories = Object.entries(dataset.validation.counts.byCategory).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  console.log(
    `Categories: ${categories.map(([category, count]) => `${category} ${count}`).join(", ")}`,
  );
  const pending = dataset.cases.filter(
    (item) => item.reviewStatus !== "human_reviewed",
  ).length;
  const unresolved = dataset.cases.filter(
    (item) => !isResolvedEvidenceLogReference(item.evidenceLogReference),
  ).length;
  console.log(`Human reviews pending: ${pending}/${dataset.cases.length}`);
  console.log(`Evidence Log references unresolved: ${unresolved}/${dataset.cases.length}`);
}

function printMetricSet(label: string, metrics: EvaluationMetricSet): void {
  console.log(`\n${label}`);
  console.log(`  Intent accuracy: ${percent(metrics.intentAccuracy)}`);
  console.log(
    `  Evidence Recall@3: ${percent(metrics.evidenceRecallAt3)} (${metrics.evidenceHits}/${metrics.evidenceExpected})`,
  );
  console.log(
    `  Citation validity: ${percent(metrics.citationValidity)} (${metrics.citationIdsValid}/${metrics.citationIdsChecked})`,
  );
  console.log(
    `  Financial-state consistency: ${
      metrics.financialStateConsistency === null
        ? "N/A"
        : percent(metrics.financialStateConsistency)
    }`,
  );
  console.log(`  Action accuracy: ${percent(metrics.actionAccuracy)}`);
  console.log(`  Safety compliance: ${percent(metrics.safetyCompliance)}`);
  console.log(
    `  Critical safety compliance: ${percent(metrics.criticalSafetyCompliance)}`,
  );
  console.log(`  Fallback accuracy: ${percent(metrics.fallbackAccuracy)}`);
  console.log(`  Fallback recall: ${percent(metrics.fallbackRecall)}`);
  console.log(
    `  Response-point coverage: ${percent(metrics.responsePointCoverage)} (${metrics.responsePointPassed}/${metrics.responsePointChecks})`,
  );
  console.log(`  Illegal actions: ${metrics.illegalActions}`);
  console.log(`  Critical failures: ${metrics.criticalFailures}`);
}

function validateCommand(): void {
  const dataset = loadGoldenDataset();

  if (!dataset.validation.valid) {
    console.error("Golden dataset validation failed:");
    for (const error of dataset.validation.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Golden dataset is valid.");
  printDatasetSummary(dataset);
}

function fixtureCommand(writeReport: boolean): void {
  const run = runFixtureEvaluation();
  console.log("Fixture-mode evaluation complete.");
  console.log("Handcrafted reference fixtures only; no model was called.");
  printDatasetSummary(run.dataset);
  printMetricSet("Overall metrics", run.report.metrics.overall);
  printMetricSet("Dev split", run.report.metrics.bySplit.dev);
  printMetricSet("Holdout split", run.report.metrics.bySplit.holdout);
  printMetricSet("Adversarial split", run.report.metrics.bySplit.adversarial);
  console.log(`\nFailed case IDs: ${run.report.failedCaseIds.length === 0 ? "none" : run.report.failedCaseIds.join(", ")}`);
  console.log(
    `Critical failures: ${run.report.criticalFailures.length === 0 ? "none" : run.report.criticalFailures.map((item) => item.caseId).join(", ")}`,
  );
  console.log(`Automated status: ${run.report.automatedStatus}`);
  console.log(`Final status: ${run.report.status}`);
  console.log(`Missing human reviews: ${run.report.missingHumanReviews.length}`);
  console.log(
    `Unresolved Evidence Log references: ${run.report.unresolvedEvidenceLogReferences.length}`,
  );

  if (writeReport) {
    const paths = writeEvaluationReport(run.report);
    console.log(`\nWrote JSON report: ${paths.jsonPath}`);
    console.log(`Wrote Markdown report: ${paths.markdownPath}`);
  }

  if (run.report.automatedStatus !== "PASS") {
    process.exitCode = 1;
  }
}

function helpCommand(): void {
  console.log("Usage: tsx src/lib/evaluation/cli.ts <command>");
  console.log("");
  console.log("Commands:");
  console.log("  validate  Validate the versioned golden dataset.");
  console.log("  fixture   Run fixture-mode evaluation and write reports.");
  console.log("  report    Run evaluation and write the machine-readable report.");
}

const command = process.argv[2] ?? "help";

try {
  switch (command) {
    case "validate":
      validateCommand();
      break;
    case "fixture":
      fixtureCommand(true);
      break;
    case "report":
      fixtureCommand(true);
      break;
    case "help":
    case "--help":
    case "-h":
      helpCommand();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      helpCommand();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
