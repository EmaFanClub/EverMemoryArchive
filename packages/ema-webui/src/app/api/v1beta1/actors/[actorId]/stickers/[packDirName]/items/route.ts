import {
  actorStickerHttpStatus,
  createActorStickerService,
} from "@/server/services/actor-stickers";
import { EMAPACK_MAX_STICKER_BYTES } from "ema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ actorId: string; packDirName: string }> },
) {
  const { actorId, packDirName } = await context.params;
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    const result = {
      apiVersion: "v1beta1" as const,
      ok: false,
      actorId,
      error: {
        code: "INVALID_CONFIG" as const,
        retryable: false,
        message: "Sticker image is too large or invalid.",
      },
    };
    return Response.json(result, { status: actorStickerHttpStatus(result) });
  }

  const file = formData.get("file");
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
  if (file.size > EMAPACK_MAX_STICKER_BYTES) {
    const result = {
      apiVersion: "v1beta1" as const,
      ok: false,
      actorId,
      error: {
        code: "INVALID_CONFIG" as const,
        retryable: false,
        message: "Sticker image is too large.",
      },
    };
    return Response.json(result, { status: actorStickerHttpStatus(result) });
  }

  const result = await createActorStickerService(actorId, packDirName, {
    id: stringFromForm(formData, "id"),
    name: stringFromForm(formData, "name"),
    description: stringFromForm(formData, "description"),
    contentType: file.type,
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  return Response.json(result, { status: actorStickerHttpStatus(result) });
}

function isUploadedFile(
  value: FormDataEntryValue | null | undefined,
): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function stringFromForm(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}
