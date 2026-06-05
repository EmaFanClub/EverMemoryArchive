import {
  actorStickerHttpStatus,
  buildActorStickerListResponse,
  createActorStickerPackService,
} from "@/server/services/actor-stickers";
import type { ActorStickerPackCreateRequest } from "@/types/dashboard/v1beta1";

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

export async function POST(
  request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  const body = ((await request.json().catch(() => ({}))) ??
    {}) as Partial<ActorStickerPackCreateRequest>;
  const result = await createActorStickerPackService(actorId, body);
  return Response.json(result, { status: actorStickerHttpStatus(result) });
}
