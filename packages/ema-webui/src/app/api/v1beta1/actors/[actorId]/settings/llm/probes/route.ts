import { runActorLlmServiceCheck } from "@/server/services/dashboard";
import type { ActorLlmCheckRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as ActorLlmCheckRequest;
  const result = await runActorLlmServiceCheck(actorId, body);
  return Response.json(result, { status: 200 });
}
