import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toEvaluationFallbackReason } from "@/lib/ai/fallbacks";
import {
  ASSISTANT_FALLBACK_REASONS,
  ASSISTANT_INTENTS,
  ASSISTANT_QUALITY_LABELS,
} from "@/lib/ai/types";
import { GOLDEN_FALLBACK_REASONS, runFixtureEvaluation } from "@/lib/evaluation";

function sourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
}

function readAll(files: string[]): string {
  return files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
}

const nodeRequire = createRequire(import.meta.url);

describe("AI isolation and secret safety", () => {
  it("never uses a browser-exposed Groq key variable", () => {
    const source = readAll(sourceFiles("src"));
    const envExample = fs.readFileSync(".env.example", "utf8");

    expect(source).not.toContain("NEXT_PUBLIC_GROQ_API_KEY");
    expect(envExample).not.toContain("NEXT_PUBLIC_GROQ_API_KEY");
  });

  it("keeps the OpenAI-compatible Groq adapter server-only", () => {
    const clientSource = fs.readFileSync("src/lib/ai/client.ts", "utf8");

    expect(clientSource.startsWith('import "server-only";')).toBe(true);
    expect(clientSource).toContain('import OpenAI from "openai";');
  });

  it("keeps the assistant API implementation in server-only modules", () => {
    const serverOnlyFiles = [
      "src/app/api/assistant/route.ts",
      "src/lib/ai/api-handler.ts",
      "src/lib/ai/api-validation.ts",
      "src/lib/ai/public-response.ts",
      "src/lib/ai/rate-limit.ts",
    ];

    for (const file of serverOnlyFiles) {
      expect(fs.readFileSync(file, "utf8").startsWith('import "server-only";')).toBe(
        true,
      );
    }
  });

  it("protects the public AI entrypoint with the client-rejecting server-only marker", () => {
    const indexSource = fs.readFileSync("src/lib/ai/index.ts", "utf8");

    expect(indexSource.startsWith('import "server-only";')).toBe(true);
    expect(() => nodeRequire("server-only")).toThrow(
      "This module cannot be imported from a Client Component module.",
    );
  });

  it("does not import AI modules from the app or component layers", () => {
    const uiSource = readAll([
      ...sourceFiles("src/app").filter(
        (file) => !file.includes(`${path.sep}api${path.sep}`),
      ),
      ...sourceFiles("src/components"),
    ]);

    expect(uiSource).not.toMatch(/lib\/ai|lib\\ai/);
  });

  it("does not put the API key into prompts or prompt builders", () => {
    const promptSource = fs.readFileSync("src/lib/ai/prompts.ts", "utf8");

    expect(promptSource).not.toContain("apiKey");
    expect(promptSource).not.toContain("GROQ_API_KEY");
    expect(promptSource).not.toContain("NEXT_PUBLIC");
  });

  it("keeps .env.example as placeholders only", () => {
    const envExample = fs.readFileSync(".env.example", "utf8");

    expect(envExample).toContain("ASSISTANT_ENABLED=false");
    expect(envExample).toContain("GROQ_API_KEY=");
    expect(envExample).toContain("GROQ_MODEL=openai/gpt-oss-20b");
    expect(envExample).toContain("MAX_OUTPUT_TOKENS=700");
    expect(envExample).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});

describe("assistant contracts and Phase 4 evaluation integration", () => {
  it("supports all 14 required intents", () => {
    expect(ASSISTANT_INTENTS).toHaveLength(14);
    expect(new Set(ASSISTANT_INTENTS).size).toBe(14);
  });

  it("exposes exactly the six server-derived quality labels", () => {
    expect(ASSISTANT_QUALITY_LABELS).toEqual([
      "Evidence-backed",
      "Limited evidence",
      "Safety guidance",
      "Need more information",
      "Safe fallback",
      "Assistant unavailable",
    ]);
  });

  it("maps every runtime fallback reason into the Phase 4 contract", () => {
    for (const reason of ASSISTANT_FALLBACK_REASONS) {
      expect(GOLDEN_FALLBACK_REASONS).toContain(
        toEvaluationFallbackReason(reason),
      );
    }
  });

  it("reproduces the offline fixture report and human-review gate", () => {
    const generatedAt = "2026-11-05T00:00:00.000Z";
    const report = runFixtureEvaluation({ generatedAt }).report;
    const repeatedReport = runFixtureEvaluation({ generatedAt }).report;

    expect(report).toEqual(repeatedReport);
    expect(report.evaluationMode).toBe("fixture");
    expect(report.liveModelOutputs).toBe(false);
    expect(report.modelCallsMade).toBe(0);
    expect(report.datasetVersion).toBe("golden-v1.0.0");
    expect(report.totalCases).toBe(48);
    expect(report.status).toBe("NEEDS_REVIEW");
    expect(report.approvalBlocked).toBe(true);
    expect(report.humanReview.assessed).toBe(false);
    expect(report.humanReview.reviewedCases).toBe(0);
    expect(report.humanReview.totalCases).toBe(48);
  });
});
