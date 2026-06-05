import {
  actorStickerHttpStatus,
  getActorStickerPreviewService,
} from "@/server/services/actor-stickers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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
  const result = await getActorStickerPreviewService(
    actorId,
    packDirName,
    stickerId,
  );
  if (!result.ok || !("buffer" in result)) {
    return Response.json(result, { status: actorStickerHttpStatus(result) });
  }

  return new Response(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "no-store",
    },
  });
}
