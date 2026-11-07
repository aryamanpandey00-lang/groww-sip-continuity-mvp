import "server-only";

import { createAssistantApiHandler } from "@/lib/ai/api-handler";
import { createNeonAssistantRuntimeAdapters } from "@/lib/db/runtime-adapters";

export const runtime = "nodejs";

// Production uses deployment-shared PostgreSQL coordinators. The pipeline
// still fails closed until SHARED_RUNTIME_VERIFIED is explicitly verified.
const assistantRuntime = process.env.NODE_ENV === "production"
  ? createNeonAssistantRuntimeAdapters()
  : null;
const handleAssistantPost = createAssistantApiHandler(
  assistantRuntime
    ? {
        budgetCoordinator: assistantRuntime.tokenBudgetCoordinator,
        demoQuotaCoordinator: assistantRuntime.demoQuotaCoordinator,
      }
    : undefined,
);

export async function POST(request: Request): Promise<Response> {
  return handleAssistantPost(request);
}
