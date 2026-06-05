import "server-only";

import fs from "node:fs/promises";

import {
  ActorStickerStore,
  GlobalConfig,
  StickerIdConflictError,
  getStickerImageMimeTypeFromFileName,
  type ResolvedStickerPack,
  type StickerInlineData,
} from "ema";

import { toCoreActorId } from "@/server/ema-adapter/ids";
import { ensureEmaServer } from "@/server/ema-server";
import type {
  ActorStickerListResponse,
  ActorStickerMutationErrorCode,
  ActorStickerMutationResponse,
  ActorStickerPack,
  ActorStickerPackPatchRequest,
  ActorStickerPatchRequest,
} from "@/types/dashboard/v1beta1";

const API_VERSION = "v1beta1" as const;

export interface ActorStickerPackCreateInput {
  name?: string | null;
}

export interface ActorStickerCreateInput {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  contentType: string;
  buffer: Buffer;
}

export async function buildActorStickerListResponse(
  actorId: string,
): Promise<ActorStickerListResponse> {
  try {
    const { coreActorId, store } = await getActorStickerContext(actorId);
    await store.ensureActorStickerPacks(coreActorId);
    const packs = await store.listStickerPacks(coreActorId);

    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      packs: await Promise.all(
        packs.map((pack) => toWebStickerPack(actorId, pack)),
      ),
    };
  } catch (error) {
    return actorStickerListError(actorId, classifyStickerError(error), error);
  }
}

export async function deleteActorStickerPackService(
  actorId: string,
  packDirName: string,
): Promise<ActorStickerMutationResponse> {
  try {
    const { coreActorId, store } = await getActorStickerContext(actorId);
    const result = await store.deleteStickerPack(coreActorId, packDirName);
    if (!result.deleted) {
      return actorStickerMutationError(
        actorId,
        "STICKER_NOT_FOUND",
        `Sticker pack '${packDirName}' does not exist.`,
      );
    }

    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      packDirName,
    };
  } catch (error) {
    return actorStickerMutationError(
      actorId,
      classifyStickerError(error),
      messageFromError(error),
    );
  }
}

export async function updateActorStickerPackService(
  actorId: string,
  packDirName: string,
  request: Partial<ActorStickerPackPatchRequest> | null | undefined,
): Promise<ActorStickerMutationResponse> {
  const name = request?.name?.trim() ?? "";
  if (!name) {
    return actorStickerMutationError(
      actorId,
      "INVALID_CONFIG",
      "name is required.",
    );
  }

  try {
    const { coreActorId, store } = await getActorStickerContext(actorId);
    const result = await store.updateStickerPackName(
      coreActorId,
      packDirName,
      name,
    );

    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      pack: await toWebStickerPack(actorId, result.pack),
      packDirName: result.pack.dirName,
    };
  } catch (error) {
    return actorStickerMutationError(
      actorId,
      classifyStickerError(error),
      messageFromError(error),
    );
  }
}

export async function createActorStickerPackService(
  actorId: string,
  request: ActorStickerPackCreateInput | null | undefined,
): Promise<ActorStickerMutationResponse> {
  const name = request?.name?.trim() ?? "";
  if (!name) {
    return actorStickerMutationError(
      actorId,
      "INVALID_CONFIG",
      "name is required.",
    );
  }

  try {
    const { coreActorId, store } = await getActorStickerContext(actorId);
    const result = await store.createStickerPack(coreActorId, name);

    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      pack: await toWebStickerPack(actorId, result.pack),
      packDirName: result.pack.dirName,
    };
  } catch (error) {
    return actorStickerMutationError(
      actorId,
      classifyStickerError(error),
      messageFromError(error),
    );
  }
}

export async function importActorStickerPackService(
  actorId: string,
  input: { fileName: string; buffer: Buffer },
): Promise<ActorStickerMutationResponse> {
  try {
    const { coreActorId, store } = await getActorStickerContext(actorId);
    const result = await store.importStickerPack(coreActorId, input);

    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      pack: await toWebStickerPack(actorId, result.pack),
      packDirName: result.pack.dirName,
    };
  } catch (error) {
    return actorStickerMutationError(
      actorId,
      classifyStickerError(error),
      messageFromError(error),
    );
  }
}

export type ActorStickerExportServiceResponse =
  | {
      ok: true;
      fileName: string;
      buffer: Buffer;
    }
  | ActorStickerMutationResponse;

export async function exportActorStickerPackService(
  actorId: string,
  packDirName: string,
): Promise<ActorStickerExportServiceResponse> {
  try {
    const { coreActorId, store } = await getActorStickerContext(actorId);
    const result = await store.exportStickerPack(coreActorId, packDirName);

    return {
      ok: true,
      fileName: result.fileName,
      buffer: result.buffer,
    };
  } catch (error) {
    return actorStickerMutationError(
      actorId,
      classifyStickerError(error),
      messageFromError(error),
    );
  }
}

export async function updateActorStickerService(
  actorId: string,
  packDirName: string,
  stickerId: string,
  request: Partial<ActorStickerPatchRequest> | null | undefined,
): Promise<ActorStickerMutationResponse> {
  const id = request?.id?.trim() ?? "";
  const name = request?.name?.trim() ?? "";
  const description = request?.description?.trim() ?? "";
  if (!id || !name || !description) {
    return actorStickerMutationError(
      actorId,
      "INVALID_CONFIG",
      "id, name and description are required.",
    );
  }

  try {
    const { coreActorId, store } = await getActorStickerContext(actorId);
    const result = await store.updateSticker(
      coreActorId,
      packDirName,
      stickerId,
      id,
      name,
      description,
    );

    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      pack: await toWebStickerPack(actorId, result.pack),
      packDirName,
    };
  } catch (error) {
    return actorStickerMutationError(
      actorId,
      classifyStickerError(error),
      messageFromError(error),
    );
  }
}

export async function createActorStickerService(
  actorId: string,
  packDirName: string,
  input: ActorStickerCreateInput,
): Promise<ActorStickerMutationResponse> {
  const id = input.id?.trim() ?? "";
  const name = input.name?.trim() ?? "";
  const description = input.description?.trim() ?? "";
  if (!id || !name || !description) {
    return actorStickerMutationError(
      actorId,
      "INVALID_CONFIG",
      "id, name and description are required.",
    );
  }

  try {
    const { coreActorId, store } = await getActorStickerContext(actorId);
    const inline: StickerInlineData = {
      type: "inline_data",
      mimeType: input.contentType as StickerInlineData["mimeType"],
      data: input.buffer.toString("base64"),
    };
    const result = await store.createSticker(
      coreActorId,
      packDirName,
      id,
      name,
      description,
      inline,
    );

    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      pack: await toWebStickerPack(actorId, result.pack),
      packDirName: result.pack.dirName,
    };
  } catch (error) {
    return actorStickerMutationError(
      actorId,
      classifyStickerError(error),
      messageFromError(error),
    );
  }
}

export async function deleteActorStickerService(
  actorId: string,
  packDirName: string,
  stickerId: string,
): Promise<ActorStickerMutationResponse> {
  try {
    const { coreActorId, store } = await getActorStickerContext(actorId);
    const result = await store.deleteSticker(
      coreActorId,
      packDirName,
      stickerId,
    );
    if (!result.deleted || !result.pack) {
      return actorStickerMutationError(
        actorId,
        "STICKER_NOT_FOUND",
        `Sticker '${stickerId}' does not exist in pack '${packDirName}'.`,
      );
    }

    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      pack: await toWebStickerPack(actorId, result.pack),
      packDirName,
    };
  } catch (error) {
    return actorStickerMutationError(
      actorId,
      classifyStickerError(error),
      messageFromError(error),
    );
  }
}

export type ActorStickerPreviewServiceResponse =
  | {
      ok: true;
      contentType: string;
      buffer: Buffer;
    }
  | ActorStickerMutationResponse;

export async function getActorStickerPreviewService(
  actorId: string,
  packDirName: string,
  stickerId: string,
): Promise<ActorStickerPreviewServiceResponse> {
  try {
    const { coreActorId, store } = await getActorStickerContext(actorId);
    const packs = await store.listStickerPacks(coreActorId);
    const pack = packs.find((item) => item.dirName === packDirName);
    if (!pack) {
      return actorStickerMutationError(
        actorId,
        "STICKER_NOT_FOUND",
        `Sticker pack '${packDirName}' does not exist.`,
      );
    }
    const sticker = pack.stickers.find((item) => item.id === stickerId);
    if (!sticker) {
      return actorStickerMutationError(
        actorId,
        "STICKER_NOT_FOUND",
        `Sticker '${stickerId}' does not exist in pack '${packDirName}'.`,
      );
    }

    return {
      ok: true,
      contentType: getStickerImageMimeTypeFromFileName(sticker.file),
      buffer: await fs.readFile(sticker.filePath),
    };
  } catch (error) {
    const code = classifyStickerError(error);
    return actorStickerMutationError(
      actorId,
      code,
      stickerPreviewErrorMessage(code),
    );
  }
}

export function actorStickerHttpStatus(
  result:
    | ActorStickerListResponse
    | ActorStickerMutationResponse
    | ActorStickerExportServiceResponse
    | ActorStickerPreviewServiceResponse,
): number {
  if (result.ok) {
    return 200;
  }
  switch (result.error?.code) {
    case "ACTOR_NOT_FOUND":
    case "STICKER_NOT_FOUND":
      return 404;
    case "STICKER_ID_CONFLICT":
      return 409;
    case "STICKER_STORE_FAILED":
      return 500;
    default:
      return 400;
  }
}

async function getActorStickerContext(actorId: string): Promise<{
  coreActorId: number;
  store: ActorStickerStore;
}> {
  const server = await ensureEmaServer();
  const coreActorId = toCoreActorId(actorId);
  const actor = await server.dbService.actorDB.getActor(coreActorId);
  if (!actor) {
    throw new Error("Actor not found.");
  }
  return {
    coreActorId,
    store: new ActorStickerStore(),
  };
}

async function toWebStickerPack(
  actorId: string,
  pack: ResolvedStickerPack,
): Promise<ActorStickerPack> {
  return {
    dirName: pack.dirName,
    name: pack.pack,
    stickerCount: pack.stickers.length,
    stickers: pack.stickers.map((sticker) => ({
      id: sticker.id,
      name: sticker.name,
      description: sticker.description,
      file: sticker.file,
      previewUrl: buildStickerPreviewUrl(actorId, pack.dirName, sticker.id),
    })),
  };
}

function buildStickerPreviewUrl(
  actorId: string,
  packDirName: string,
  stickerId: string,
): string {
  return `/api/v1beta1/actors/${encodeURIComponent(actorId)}/stickers/${encodeURIComponent(packDirName)}/items/${encodeURIComponent(stickerId)}/preview`;
}

function actorStickerListError(
  actorId: string,
  code: ActorStickerMutationErrorCode,
  error: unknown,
): ActorStickerListResponse {
  return {
    apiVersion: API_VERSION,
    ok: false,
    actorId,
    packs: [],
    error: {
      code,
      retryable: code === "STICKER_STORE_FAILED",
      message: messageFromError(error),
    },
  };
}

function actorStickerMutationError(
  actorId: string,
  code: ActorStickerMutationErrorCode,
  message: string,
): ActorStickerMutationResponse {
  return {
    apiVersion: API_VERSION,
    ok: false,
    actorId,
    error: {
      code,
      retryable: code === "STICKER_STORE_FAILED",
      message,
    },
  };
}

function stickerPreviewErrorMessage(
  code: ActorStickerMutationErrorCode,
): string {
  switch (code) {
    case "INVALID_ACTOR":
      return "Invalid actor id.";
    case "ACTOR_NOT_FOUND":
      return "Actor not found.";
    case "INVALID_CONFIG":
      return "Sticker preview request is invalid.";
    default:
      return "Sticker preview is unavailable.";
  }
}

function classifyStickerError(error: unknown): ActorStickerMutationErrorCode {
  if (error instanceof StickerIdConflictError) {
    return "STICKER_ID_CONFLICT";
  }
  const message = messageFromError(error).toLowerCase();
  if (message.includes("invalid actor id")) {
    return "INVALID_ACTOR";
  }
  if (message.includes("actor not found")) {
    return "ACTOR_NOT_FOUND";
  }
  if (message.includes("already exists")) {
    return "STICKER_ID_CONFLICT";
  }
  if (
    message.includes("does not exist") ||
    message.includes("unknown sticker") ||
    message.includes("missing file")
  ) {
    return "STICKER_NOT_FOUND";
  }
  if (
    message.includes("required") ||
    message.includes("safe path segment") ||
    message.includes("safe zip path") ||
    message.includes("non-empty string") ||
    message.includes("invalid") ||
    message.includes("cannot be deleted") ||
    message.includes("cannot be renamed") ||
    message.includes("already used") ||
    message.includes("cannot be imported") ||
    message.includes(".emapack") ||
    message.includes("unsupported emapack") ||
    message.includes("only image media") ||
    message.includes("unsupported image mime") ||
    message.includes("unsupported sticker image") ||
    message.includes("too large") ||
    message.includes("too many entries")
  ) {
    return "INVALID_CONFIG";
  }
  return "STICKER_STORE_FAILED";
}

function messageFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeLocalPaths(message);
}

function sanitizeLocalPaths(message: string): string {
  let sanitized = message;
  for (const root of getKnownLocalRoots()) {
    sanitized = sanitized.split(root).join("<local>");
  }
  return sanitized;
}

function getKnownLocalRoots(): string[] {
  try {
    const { dataRoot, logsDir, workspaceDir } = GlobalConfig.paths;
    return [dataRoot, logsDir, workspaceDir]
      .filter((item) => item.length > 0)
      .sort((a, b) => b.length - a.length);
  } catch {
    return [];
  }
}
