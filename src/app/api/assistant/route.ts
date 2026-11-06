import "server-only";

import { createAssistantApiHandler } from "@/lib/ai/api-handler";

export const runtime = "nodejs";

const handleAssistantPost = createAssistantApiHandler();

export async function POST(request: Request): Promise<Response> {
  return handleAssistantPost(request);
}
