import {
  actorStickerHttpStatus,
  importActorStickerPackService,
} from "@/server/services/actor-stickers";
import { EMAPACK_MAX_ARCHIVE_BYTES } from "ema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!isUploadedFile(file)) {
    const result = {
      apiVersion: "v1beta1" as const,
      ok: false,
      actorId,
      error: {
        code: "INVALID_CONFIG" as const,
        retryable: false,
        message: "file is required.",
      },
    };
    return Response.json(result, { status: actorStickerHttpStatus(result) });
  }
  if (file.size > EMAPACK_MAX_ARCHIVE_BYTES) {
    const result = {
      apiVersion: "v1beta1" as const,
      ok: false,
      actorId,
      error: {
        code: "INVALID_CONFIG" as const,
        retryable: false,
        message: "Sticker pack archive is too large.",
      },
    };
    return Response.json(result, { status: actorStickerHttpStatus(result) });
  }

  const result = await importActorStickerPackService(actorId, {
    fileName: file.name,
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  return Response.json(result, { status: actorStickerHttpStatus(result) });
}

function isUploadedFile(
  value: FormDataEntryValue | null | undefined,
): value is File {
  return typeof File !== "undefined" && value instanceof File;
}
