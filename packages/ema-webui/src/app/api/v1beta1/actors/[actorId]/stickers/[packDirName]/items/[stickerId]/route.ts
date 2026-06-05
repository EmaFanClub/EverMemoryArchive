import {
  actorStickerHttpStatus,
  deleteActorStickerService,
  updateActorStickerService,
} from "@/server/services/actor-stickers";
import type { ActorStickerPatchRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      actorId: string;
      packDirName: string;
      stickerId: string;
    }>;
  },
) {
  const { actorId, packDirName, stickerId } = await context.params;
  const body = ((await request.json().catch(() => ({}))) ??
    {}) as Partial<ActorStickerPatchRequest>;
  const result = await updateActorStickerService(
    actorId,
    packDirName,
    stickerId,
    body,
  );
  return Response.json(result, { status: actorStickerHttpStatus(result) });
}

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{
      actorId: string;
      packDirName: string;
      stickerId: string;
    }>;
  },
) {
  const { actorId, packDirName, stickerId } = await context.params;
  const result = await deleteActorStickerService(
    actorId,
    packDirName,
    stickerId,
  );
  return Response.json(result, { status: actorStickerHttpStatus(result) });
}
