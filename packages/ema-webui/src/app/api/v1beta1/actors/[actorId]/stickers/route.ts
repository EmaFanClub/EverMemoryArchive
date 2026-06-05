import {
  actorStickerHttpStatus,
  buildActorStickerListResponse,
} from "@/server/services/actor-stickers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  const result = await buildActorStickerListResponse(actorId);
  return Response.json(result, { status: actorStickerHttpStatus(result) });
}
