import { saveActorWebSearchServiceConfig } from "@/server/services/dashboard";
import type { ActorWebSearchSaveRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  const body = (await request
    .json()
    .catch(() => ({}))) as ActorWebSearchSaveRequest;
  const result = await saveActorWebSearchServiceConfig(actorId, body);
  return Response.json(result, { status: 200 });
}
