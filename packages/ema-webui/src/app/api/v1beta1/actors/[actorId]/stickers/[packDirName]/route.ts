import {
  actorStickerHttpStatus,
  deleteActorStickerPackService,
  updateActorStickerPackService,
} from "@/server/services/actor-stickers";
import type { ActorStickerPackPatchRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ actorId: string; packDirName: string }> },
) {
  const { actorId, packDirName } = await context.params;
  const body = ((await request.json().catch(() => ({}))) ??
    {}) as Partial<ActorStickerPackPatchRequest>;
  const result = await updateActorStickerPackService(
    actorId,
    packDirName,
    body,
  );
  return Response.json(result, { status: actorStickerHttpStatus(result) });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ actorId: string; packDirName: string }> },
) {
  const { actorId, packDirName } = await context.params;
  const result = await deleteActorStickerPackService(actorId, packDirName);
  return Response.json(result, { status: actorStickerHttpStatus(result) });
}
