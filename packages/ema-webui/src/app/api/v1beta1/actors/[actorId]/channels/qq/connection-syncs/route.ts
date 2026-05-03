import { syncActorQqServiceConnectionStatus } from "@/server/services/dashboard";
import type { ActorQQConnectionStatusRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  const body = (await request
    .json()
    .catch(() => ({}))) as ActorQQConnectionStatusRequest;
  const result = await syncActorQqServiceConnectionStatus(actorId, body);
  return Response.json(result, { status: 200 });
}
