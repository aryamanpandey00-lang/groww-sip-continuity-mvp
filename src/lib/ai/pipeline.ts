import { randomUUID } from "node:crypto";
import { cloneDemoInvestorState } from "@/lib/domain/fixtures/demo-investor";
import type { DemoInvestorState } from "@/lib/domain/types";
import { retrieveEvidence, INSUFFICIENT_EVIDENCE_MESSAGE } from "@/lib/evidence";
import { resolveAssistantConfig, DEFAULT_MAX_INPUT_CHARS } from "./config";
import { buildAssistantContextPacket } from "./context";
import {
  buildConfigUnavailableContent,
  buildGateFailureContent,
  buildInsufficientEvidenceContent,
  buildInputInvalidContent,
  buildMissingInformationContent,
  buildModelUnavailableContent,
  buildNoEvidenceContent,
  buildSafetyContent,
  type AssistantFallbackContent,
} from "./fallbacks";
import { evaluateRuntimeGate } from "./gate";
import {
  classifyIntent,
  evidenceIntentForAssistantIntent,
  isAssistantProblemCategory,
  isSafetyOverrideIntent,
} from "./intent";
import { emitAssistantLog } from "./logger";
import { detectMissingInformation } from "./missing-info";
import {
  createAssistantBudgetReservationId,
  estimateMaxAssistantCallTokens,
  normalizeAssistantTokenUsage,
  resolveAssistantTokenBudgetCoordinator,
} from "./token-budget";
import {
  buildAssistantModelRequest,
  buildRepairModelRequest,
} from "./prompts";
import type {
  AssistantContextPacket,
  AssistantDependencies,
  AssistantIntent,
  AssistantModelCallResult,
  AssistantModelClient,
  AssistantTokenBudgetCoordinator,
  AssistantModelDiagnostics,
  AssistantRequest,
  AssistantResult,
  AssistantEvidenceItem,
  AssistantTokenUsage,
  RuntimeGateResult,
} from "./types";

interface CallTelemetry {
  latencyMs: number;
  modelId: string | null;
  usage: AssistantTokenUsage | null;
  modelCalls: number;
  usageComplete: boolean;
}

interface ModelAttempt {
  result: AssistantModelCallResult;
  telemetry: CallTelemetry;
}

async function callModel(
  client: AssistantModelClient,
  request: ReturnType<typeof buildAssistantModelRequest>,
  budgetCoordinator: AssistantTokenBudgetCoordinator,
  maxOutputTokens: number,
): Promise<ModelAttempt> {
  const startedAt = Date.now();
  let reservation;

  try {
    reservation = await budgetCoordinator.reserve({
      reservationId: createAssistantBudgetReservationId(),
      maxTokens: estimateMaxAssistantCallTokens(request, maxOutputTokens),
      nowMs: Date.now(),
    });
  } catch {
    reservation = null;
  }

  if (!reservation) {
    return {
      result: { status: "UNAVAILABLE", errorCode: "token_budget_unavailable" },
      telemetry: {
        latencyMs: 0,
        modelId: null,
        usage: null,
        modelCalls: 0,
        usageComplete: true,
      },
    };
  }

  let result: AssistantModelCallResult;

  try {
    result = await client.respond(request);
  } catch {
    result = { status: "UNAVAILABLE", errorCode: "client_exception" };
  }

  const normalizedUsage = normalizeAssistantTokenUsage(result.usage);
  let settlementFailed = false;

  try {
    await reservation.settle(
      normalizedUsage.complete
        ? normalizedUsage.usage?.totalTokens ?? null
        : null,
    );
  } catch {
    settlementFailed = true;
  }

  const normalizedResult = settlementFailed
    ? {
        status: "UNAVAILABLE" as const,
        errorCode: "token_budget_settlement_failed",
        usage: normalizedUsage.usage ?? undefined,
      }
    : { ...result, usage: normalizedUsage.usage ?? undefined };

  return {
    result: normalizedResult,
    telemetry: {
      latencyMs: Date.now() - startedAt,
      modelId:
        normalizedResult.status === "OK"
          ? normalizedResult.modelId ?? null
          : null,
      usage: normalizedUsage.usage,
      modelCalls: 1,
      usageComplete: normalizedUsage.complete,
    },
  };
}

function addUsage(
  previous: AssistantTokenUsage | null,
  next: AssistantTokenUsage | null,
  previousCallCount: number,
): AssistantTokenUsage | null {
  if (previousCallCount === 0) return next;
  if (previous === null) return next;
  if (next === null) return previous;

  const add = (
    left: number | undefined,
    right: number | undefined,
  ): number | undefined => {
    if (left === undefined) return right;
    if (right === undefined) return left;
    const sum = left + right;
    return Number.isSafeInteger(sum) ? sum : undefined;
  };

  const usage = {
    inputTokens: add(previous.inputTokens, next.inputTokens),
    outputTokens: add(previous.outputTokens, next.outputTokens),
    totalTokens: add(previous.totalTokens, next.totalTokens),
  };

  return Object.values(usage).some((value) => value !== undefined)
    ? usage
    : null;
}

function mergeTelemetry(
  previous: CallTelemetry | null,
  next: CallTelemetry,
): CallTelemetry | null {
  if (next.modelCalls === 0) return previous;
  if (previous === null) return next;
  return {
    latencyMs: previous.latencyMs + next.latencyMs,
    modelId: next.modelId ?? previous.modelId,
    usage: addUsage(previous.usage, next.usage, previous.modelCalls),
    modelCalls: previous.modelCalls + next.modelCalls,
    usageComplete: previous.usageComplete && next.usageComplete,
  };
}

function buildResult(input: {
  requestId: string;
  intent: AssistantIntent;
  content: AssistantFallbackContent;
  gateResult: RuntimeGateResult | null;
  retrievedEvidenceIds: string[];
  retrievedEvidenceItems: AssistantEvidenceItem[];
  model: AssistantModelDiagnostics | null;
  repairAttempted: boolean;
  repairSucceeded: boolean;
  generatedAt: string;
}): AssistantResult {
  return {
    requestId: input.requestId,
    status: input.content.status,
    intent: input.intent,
    directAnswer: input.content.directAnswer,
    keyPoints: input.content.keyPoints,
    citedEvidenceIds: input.content.citedEvidenceIds,
    proposedAction: input.content.proposedAction,
    followUpQuestion: input.content.followUpQuestion,
    refusal: input.content.refusal,
    qualityLabel: input.content.qualityLabel,
    fallbackReason: input.content.fallbackReason,
    evaluationFallbackReason: input.content.evaluationFallbackReason,
    fallbackUsed: input.content.fallbackUsed,
    repairAttempted: input.repairAttempted,
    repairSucceeded: input.repairSucceeded,
    gateResult: input.gateResult,
    retrievedEvidenceIds: input.retrievedEvidenceIds,
    retrievedEvidenceItems: input.retrievedEvidenceItems,
    model: input.model,
    executionPerformed: false,
    generatedAt: input.generatedAt,
  };
}

function modelDiagnostics(
  telemetry: CallTelemetry | null,
): AssistantModelDiagnostics | null {
  if (!telemetry) {
    return null;
  }

  return {
    modelId: telemetry.modelId,
    latencyMs: telemetry.latencyMs,
    usage: telemetry.usage,
    modelCalls: telemetry.modelCalls,
    usageComplete: telemetry.usageComplete,
  };
}

function defaultState(state: DemoInvestorState | undefined): DemoInvestorState {
  if (!state) {
    return cloneDemoInvestorState();
  }

  return structuredClone(state);
}

/**
 * General-education and safety retrieval must not be blocked by Phase 3's
 * account-specific guard just because a general question contains "my SIP".
 * The original question is still preserved in the context packet.
 */
function evidenceQuestionForIntent(
  intent: AssistantIntent,
  question: string,
): string {
  if (
    intent !== "GENERAL_SIP_EDUCATION" &&
    intent !== "MARKET_UNCERTAINTY" &&
    intent !== "GUARANTEED_RETURN_REQUEST"
  ) {
    return question;
  }

  return question.replace(
    /\bmy\s+(sip|mutual fund|portfolio|investment)\b/gi,
    "a $1",
  );
}

/**
 * Runs the server-side assistant pipeline. The OpenAI client is only imported
 * lazily on the approved model path, so configuration failures, deterministic
 * clarification, safety refusals and offline tests never construct an SDK
 * client or require a live API key.
 */
export async function runAssistant(
  request: AssistantRequest,
  dependencies: AssistantDependencies = {},
): Promise<AssistantResult> {
  const startedAt = Date.now();
  const requestId = dependencies.requestId ?? randomUUID();
  const now = dependencies.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const rawQuestion =
    typeof request.question === "string" ? request.question.trim() : "";
  const selectedCategory =
    request.selectedCategory && isAssistantProblemCategory(request.selectedCategory)
      ? request.selectedCategory
      : null;
  const intent = classifyIntent(rawQuestion, selectedCategory);
  const retrievedEvidenceIds: string[] = [];
  let retrievedEvidenceItems: AssistantEvidenceItem[] = [];
  let telemetry: CallTelemetry | null = null;
  let repairAttempted = false;
  let repairSucceeded = false;

  const finish = (
    content: AssistantFallbackContent,
    gateResult: RuntimeGateResult | null,
  ): AssistantResult => {
    const result = buildResult({
      requestId,
      intent,
      content,
      gateResult,
      retrievedEvidenceIds,
      retrievedEvidenceItems,
      model: modelDiagnostics(telemetry),
      repairAttempted,
      repairSucceeded,
      generatedAt,
    });

    emitAssistantLog(dependencies.log, {
      requestId,
      intent,
      retrievedEvidenceIds,
      gatePassed: gateResult?.passed ?? null,
      gateFailureCodes:
        gateResult?.criticalFailures.map((failure) => failure.code) ?? [],
      fallbackReason: result.fallbackReason,
      qualityLabel: result.qualityLabel,
      modelId: result.model?.modelId ?? null,
      latencyMs: Date.now() - startedAt,
      tokenUsage: result.model?.usage ?? null,
      modelCalls: result.model?.modelCalls ?? 0,
      tokenUsageComplete: result.model?.usageComplete ?? true,
      repairAttempted,
      timestamp: generatedAt,
    });

    return result;
  };

  if (!rawQuestion) {
    return finish(
      buildInputInvalidContent(DEFAULT_MAX_INPUT_CHARS),
      null,
    );
  }

  if (rawQuestion.length > DEFAULT_MAX_INPUT_CHARS) {
    return finish(buildInputInvalidContent(DEFAULT_MAX_INPUT_CHARS), null);
  }

  const evidenceIntent = evidenceIntentForAssistantIntent(
    intent,
    rawQuestion,
  );
  const retrieval = evidenceIntent
    ? retrieveEvidence({
        question: evidenceQuestionForIntent(intent, rawQuestion),
        intent: evidenceIntent,
      })
    : null;

  if (retrieval) {
    retrievedEvidenceIds.push(...retrieval.evidenceIds);
    retrievedEvidenceItems = retrieval.matches.map((item) => ({
      ...item,
      matchedTerms: [...item.matchedTerms],
    }));
  }

  const configResolution = dependencies.config
    ? ({ status: "READY", config: dependencies.config } as const)
    : resolveAssistantConfig(dependencies.env ?? process.env);

  if (configResolution.status === "UNAVAILABLE") {
    return finish(
      buildConfigUnavailableContent(
        configResolution.reason,
        configResolution.fallbackReason,
      ),
      null,
    );
  }

  const config = configResolution.config;

  if (rawQuestion.length > config.maxInputChars) {
    return finish(buildInputInvalidContent(config.maxInputChars), null);
  }

  if (isSafetyOverrideIntent(intent)) {
    return finish(buildSafetyContent(intent, rawQuestion, retrieval), null);
  }

  if (intent === "INSUFFICIENT_EVIDENCE") {
    return finish(
      buildInsufficientEvidenceContent(INSUFFICIENT_EVIDENCE_MESSAGE),
      null,
    );
  }

  if (!retrieval || retrieval.status === "NO_EVIDENCE") {
    return retrieval
      ? finish(buildNoEvidenceContent(retrieval), null)
      : finish(buildInsufficientEvidenceContent(INSUFFICIENT_EVIDENCE_MESSAGE), null);
  }

  const missingInformation = detectMissingInformation(
    rawQuestion,
    intent,
    selectedCategory,
  );

  if (missingInformation.required && missingInformation.question) {
    return finish(
      buildMissingInformationContent(missingInformation.question),
      null,
    );
  }

  const state = defaultState(request.state);
  const packet = buildAssistantContextPacket({
    question: rawQuestion,
    selectedCategory,
    intent,
    evidenceIntent,
    retrieval,
    state,
  });

  const budgetCoordinator = resolveAssistantTokenBudgetCoordinator(
    dependencies.env ?? process.env,
    dependencies.budgetCoordinator,
  );

  if (!budgetCoordinator) {
    return finish(buildModelUnavailableContent("MODEL_UNAVAILABLE"), null);
  }

  let modelClient = dependencies.modelClient;

  if (!modelClient) {
    try {
      const { createOpenAIModelClient } = await import("./client");
      modelClient = createOpenAIModelClient(config);
    } catch {
      return finish(buildModelUnavailableContent("MODEL_UNAVAILABLE"), null);
    }
  }

  const firstCall = await callModel(
    modelClient,
    buildAssistantModelRequest(packet),
    budgetCoordinator,
    config.maxOutputTokens,
  );
  telemetry = mergeTelemetry(telemetry, firstCall.telemetry);

  if (firstCall.result.status === "TIMEOUT") {
    return finish(buildModelUnavailableContent("MODEL_TIMEOUT"), null);
  }

  if (firstCall.result.status === "UNAVAILABLE") {
    return finish(buildModelUnavailableContent("MODEL_UNAVAILABLE"), null);
  }

  let previousOutput =
    firstCall.result.status === "OK" ? firstCall.result.outputText : "";
  let gateEvaluation = evaluateRuntimeGate({
    rawOutput: previousOutput,
    packet,
    state,
  });

  if (!gateEvaluation.result.passed) {
    repairAttempted = true;

    const repairCall = await callModel(
      modelClient,
      buildRepairModelRequest(
        packet,
        gateEvaluation.result.criticalFailures.map((failure) => failure.code),
        previousOutput,
      ),
      budgetCoordinator,
      config.maxOutputTokens,
    );
    telemetry = mergeTelemetry(telemetry, repairCall.telemetry);

    if (repairCall.result.status === "TIMEOUT") {
      return finish(buildModelUnavailableContent("MODEL_TIMEOUT"), null);
    }

    if (repairCall.result.status === "UNAVAILABLE") {
      return finish(buildModelUnavailableContent("MODEL_UNAVAILABLE"), null);
    }

    previousOutput =
      repairCall.result.status === "OK" ? repairCall.result.outputText : "";
    gateEvaluation = evaluateRuntimeGate({
      rawOutput: previousOutput,
      packet,
      state,
    });

    if (!gateEvaluation.result.passed) {
      return finish(
        buildGateFailureContent("REPAIR_FAILED"),
        gateEvaluation.result,
      );
    }

    repairSucceeded = true;
  }

  const output = gateEvaluation.output;

  if (!output) {
    return finish(
      buildGateFailureContent("MODEL_INVALID_OUTPUT"),
      gateEvaluation.result,
    );
  }

  return finish(
    {
      status: "APPROVED",
      qualityLabel: gateEvaluation.result.qualityLabel ?? "Limited evidence",
      fallbackReason: "NONE",
      evaluationFallbackReason: "NONE",
      directAnswer: output.directAnswer,
      keyPoints: output.keyPoints,
      citedEvidenceIds: output.citedEvidenceIds,
      proposedAction: output.proposedAction,
      followUpQuestion: output.followUpQuestion,
      refusal: output.refusal,
      fallbackUsed: false,
    },
    gateEvaluation.result,
  );
}

export type { AssistantContextPacket };
