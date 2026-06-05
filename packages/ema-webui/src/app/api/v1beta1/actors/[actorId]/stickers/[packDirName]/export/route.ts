import {
  actorStickerHttpStatus,
  exportActorStickerPackService,
} from "@/server/services/actor-stickers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ actorId: string; packDirName: string }> },
) {
  const { actorId, packDirName } = await context.params;
  const result = await exportActorStickerPackService(actorId, packDirName);
  if (!result.ok || !("buffer" in result)) {
    return Response.json(result, { status: actorStickerHttpStatus(result) });
  }

  return new Response(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": buildDownloadDisposition(result.fileName),
    },
  });
}

function buildDownloadDisposition(fileName: string): string {
  const asciiFallback =
    fileName.replace(/[^\w.-]+/g, "_") || "sticker-pack.emapack";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
