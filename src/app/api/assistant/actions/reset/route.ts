import "server-only";

import { createActionApiHandlers } from "@/lib/assistant/action-api-handler";

export const runtime = "nodejs";

const handlers = createActionApiHandlers();

export async function POST(request: Request): Promise<Response> {
  return handlers.reset(request);
}
