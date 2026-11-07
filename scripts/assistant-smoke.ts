import { createAssistantApiHandler } from "@/lib/ai/api-handler";
import { createGroqModelClient } from "@/lib/ai/client";
import { resolveAssistantConfig } from "@/lib/ai/config";
import { runAssistant } from "@/lib/ai/pipeline";
import {
  estimateMaxAssistantCallTokens,
  normalizeAssistantTokenUsage,
} from "@/lib/ai/token-budget";
import type {
  AssistantLogEvent,
  AssistantModelClient,
  AssistantProviderDiagnostic,
  AssistantResult,
} from "@/lib/ai/types";
import { createNeonAssistantRuntimeAdapters } from "@/lib/db/runtime-adapters";
import {
  ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS,
  createAssistantSmokeEnvironment,
} from "./assistant-smoke-config";

const CONFIRMATION_ARGUMENT = "--confirm-one-provider-request";
const EXPECTED_DATABASE = "neondb";
const EXPECTED_DATABASE_USER = "sip_mvp_app_login";
const EXPECTED_DATABASE_HOST =
  "ep-raspy-mud-azjfswyc.c-3.ap-southeast-1.aws.neon.tech";
const EXPECTED_EVIDENCE_ID = "general-education.sip-basics";
const SMOKE_QUESTION = "What is a SIP?";

function fail(message: string): never {
  throw new Error(message);
}

function validateRuntimeUrl(connectionString: string | undefined): void {
  if (!connectionString) {
    fail("Smoke preflight failed: runtime database configuration is unavailable.");
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    fail("Smoke preflight failed: runtime database configuration is invalid.");
  }

  let username: string;
  try {
    username = decodeURIComponent(parsed.username);
  } catch {
    fail("Smoke preflight failed: runtime database identity is invalid.");
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (
    username !== EXPECTED_DATABASE_USER ||
    parsed.hostname !== EXPECTED_DATABASE_HOST ||
    database !== EXPECTED_DATABASE
  ) {
    fail("Smoke preflight failed: database target or runtime role did not match.");
  }
}

async function verifyRuntimeDatabase(
  env: Record<string, string | undefined>,
) {
  validateRuntimeUrl(env.DATABASE_RUNTIME_URL);
  const runtime = createNeonAssistantRuntimeAdapters(env);
  const identity = await runtime.database.query<{
    database: unknown;
    username: unknown;
  }>("SELECT current_database() AS database, current_user AS username");
  if (
    identity.rows[0]?.database !== EXPECTED_DATABASE ||
    identity.rows[0]?.username !== EXPECTED_DATABASE_USER
  ) {
    fail("Smoke preflight failed: database identity query did not match the target.");
  }
  return runtime;
}

async function main(): Promise<void> {
  if (process.argv.includes("--preflight-only")) {
    await verifyRuntimeDatabase(process.env);
    console.log(JSON.stringify({
      pass: true,
      database: EXPECTED_DATABASE,
      runtimeRole: EXPECTED_DATABASE_USER,
      modelCalls: 0,
      writes: 0,
    }, null, 2));
    return;
  }

  if (!process.argv.includes(CONFIRMATION_ARGUMENT)) {
    fail(`No request sent. Use --preflight-only for a read-only check, or rerun only after approval with ${CONFIRMATION_ARGUMENT}.`);
  }

  if (process.env.ASSISTANT_ENABLED !== "true") {
    fail("Smoke preflight failed: assistant is not explicitly enabled in this process.");
  }
  if (process.env.SHARED_RUNTIME_VERIFIED !== "true") {
    fail("Smoke preflight failed: shared runtime is not explicitly verified in this process.");
  }

  // Apply smoke-only settings to a copy. The parent process and its environment
  // are not modified; the output cap is fixed for this one in-process request.
  const smokeEnv = createAssistantSmokeEnvironment(process.env);
  const configResolution = resolveAssistantConfig(smokeEnv);
  if (configResolution.status !== "READY") {
    fail(`Smoke preflight failed: assistant configuration is unavailable (${configResolution.reason}).`);
  }
  const config = configResolution.config;

  const runtime = await verifyRuntimeDatabase(smokeEnv);

  const providerClient = createGroqModelClient(config);
  let providerCalls = 0;
  let reservedMaximum: number | null = null;
  const oneCallClient: AssistantModelClient = {
    async respond(request) {
      if (providerCalls >= 1) {
        return { status: "UNAVAILABLE", errorCode: "smoke_single_call_limit" };
      }
      providerCalls += 1;
      reservedMaximum = estimateMaxAssistantCallTokens(
        request,
        config.maxOutputTokens,
      );

      const result = await providerClient.respond(request);
      const usage = normalizeAssistantTokenUsage(result.usage);
      if (!usage.complete) {
        return {
          status: "UNAVAILABLE",
          errorCode:
            "errorCode" in result
              ? result.errorCode ?? "smoke_usage_incomplete"
              : "smoke_usage_incomplete",
          usage: usage.usage ?? undefined,
          providerDiagnostic: result.providerDiagnostic,
        };
      }
      return { ...result, usage: usage.usage ?? undefined };
    },
  };

  const captured = {
    assistantResult: null as AssistantResult | null,
    providerDiagnostic: null as AssistantProviderDiagnostic | null,
  };
  const handler = createAssistantApiHandler({
    env: smokeEnv,
    budgetCoordinator: runtime.tokenBudgetCoordinator,
    demoQuotaCoordinator: runtime.demoQuotaCoordinator,
    runAssistant: async (request, dependencies) => {
      captured.assistantResult = await runAssistant(request, {
        ...(dependencies ?? {}),
        env: smokeEnv,
        config,
        modelClient: oneCallClient,
        budgetCoordinator: runtime.tokenBudgetCoordinator,
        demoQuotaCoordinator: runtime.demoQuotaCoordinator,
        allowRepair: false,
        log: (event: AssistantLogEvent) => {
          captured.providerDiagnostic = event.providerDiagnostic ?? null;
        },
      });
      return captured.assistantResult;
    },
  });

  const response = await handler(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({ question: SMOKE_QUESTION }),
    }),
  );
  const publicBody = await response.json() as { citations?: Array<{ evidenceId?: unknown }> };
  const result = captured.assistantResult;
  const actualTokens = result?.model?.usage?.totalTokens;
  const usageComplete = result?.model?.usageComplete === true;
  const withinReservation =
    usageComplete &&
    typeof actualTokens === "number" &&
    reservedMaximum !== null &&
    actualTokens <= reservedMaximum;
  const citedIds = Array.isArray(publicBody.citations)
    ? publicBody.citations
        .map((citation) => citation.evidenceId)
        .filter((id): id is string => typeof id === "string")
    : [];
  const passed =
    response.status === 200 &&
    result?.status === "APPROVED" &&
    result.gateResult?.passed === true &&
    result.repairAttempted === false &&
    result.executionPerformed === false &&
    providerCalls === 1 &&
    result.model?.modelCalls === 1 &&
    withinReservation &&
    citedIds.includes(EXPECTED_EVIDENCE_ID);

  const summary = {
    pass: passed,
    httpStatus: response.status,
    assistantStatus: result?.status ?? "NO_RESULT",
    providerCalls,
    modelId: result?.model?.modelId ?? null,
    outputLimit: ASSISTANT_SMOKE_MAX_OUTPUT_TOKENS,
    inputTokens: result?.model?.usage?.inputTokens ?? null,
    outputTokens: result?.model?.usage?.outputTokens ?? null,
    actualTotalTokens: actualTokens ?? null,
    reservedMaximumTokens: reservedMaximum,
    usageComplete,
    actualWithinReservation: withinReservation,
    citedEvidenceIds: citedIds,
    gatePassed: result?.gateResult?.passed ?? false,
    repairAttempted: result?.repairAttempted ?? false,
    executionPerformed: result?.executionPerformed ?? false,
    fallbackReason: result?.fallbackReason ?? null,
    providerDiagnostic: captured.providerDiagnostic,
    ...(passed && result ? { directAnswer: result.directAnswer } : {}),
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!passed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Smoke test failed.";
  console.error(message);
  process.exitCode = 1;
});
