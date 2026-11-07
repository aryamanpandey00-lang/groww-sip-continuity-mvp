import "server-only";

import { createPostgresAssistantDemoQuotaCoordinator } from "@/lib/ai/postgres-demo-quota";
import { createPostgresAssistantTokenBudgetCoordinator } from "@/lib/ai/postgres-token-budget";
import { createPostgresActionSessionStore } from "@/lib/assistant/action-session-store";
import { createPostgresEvidenceRegistry } from "@/lib/evidence/postgres-registry";
import {
  createNeonPostgresQueryable,
  type NeonHttpClientFactory,
} from "./neon";

/** Creates only the shared AI budget adapters; it does not configure routes. */
export function createNeonAssistantRuntimeAdapters(
  env: Record<string, string | undefined> = process.env,
  createClient?: NeonHttpClientFactory,
) {
  const database = createNeonPostgresQueryable({ env, createClient });
  return {
    database,
    tokenBudgetCoordinator: createPostgresAssistantTokenBudgetCoordinator(database),
    demoQuotaCoordinator: createPostgresAssistantDemoQuotaCoordinator(database),
  };
}

/**
 * Creates the complete server-only adapter set using DATABASE_RUNTIME_URL.
 * This deliberately does not set SHARED_RUNTIME_VERIFIED.
 */
export function createNeonSharedRuntimeAdapters(
  env: Record<string, string | undefined> = process.env,
  createClient?: NeonHttpClientFactory,
) {
  const assistant = createNeonAssistantRuntimeAdapters(env, createClient);
  return {
    ...assistant,
    actionSessionStore: createPostgresActionSessionStore(assistant.database),
    evidenceRegistry: createPostgresEvidenceRegistry(assistant.database),
  };
}
