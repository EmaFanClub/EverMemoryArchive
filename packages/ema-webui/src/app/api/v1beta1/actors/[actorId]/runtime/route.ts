import { updateActorActivityService } from "@/server/services/dashboard";
import type { ActorActivityUpdateRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  const body = (await request
    .json()
    .catch(() => ({}))) as ActorActivityUpdateRequest;
  const result = await updateActorActivityService(actorId, body);
  return Response.json(result, { status: 200 });
}
