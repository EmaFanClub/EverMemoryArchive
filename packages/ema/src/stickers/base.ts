import type { ImageMIME, InlineDataItem } from "../llm/schema";

export interface StickerDefinition {
  id: string;
  name: string;
  description: string;
  file: string;
}

export interface StickerPackDefinition {
  pack: string;
  stickers: StickerDefinition[];
}

export interface ResolvedStickerDefinition extends StickerDefinition {
  pack: string;
  packDirName: string;
  packDirPath: string;
  filePath: string;
}

export interface ResolvedStickerPack extends StickerPackDefinition {
  dirName: string;
  dirPath: string;
  packFilePath: string;
  stickers: ResolvedStickerDefinition[];
}

export interface UpdateStickerResult {
  pack: ResolvedStickerPack;
  sticker: ResolvedStickerDefinition;
}

export type UpdateStickerMetadataResult = UpdateStickerResult;

export interface UpdateStickerPackResult {
  pack: ResolvedStickerPack;
}

export interface CreateStickerPackResult {
  pack: ResolvedStickerPack;
}

export interface CreateStickerResult {
  pack: ResolvedStickerPack;
  sticker: ResolvedStickerDefinition;
}

export interface CreateCollectedStickerResult {
  pack: ResolvedStickerPack;
  sticker: ResolvedStickerDefinition;
}

export interface DeleteStickerPackResult {
  deleted: boolean;
}

export interface DeleteStickerResult {
  deleted: boolean;
  pack?: ResolvedStickerPack;
  sticker?: ResolvedStickerDefinition;
}

export interface ImportStickerPackInput {
  fileName: string;
  buffer: Buffer;
}

export interface ImportStickerPackResult {
  pack: ResolvedStickerPack;
}

export interface ExportStickerPackResult {
  pack: ResolvedStickerPack;
  fileName: string;
  buffer: Buffer;
}

export type StickerInlineData = InlineDataItem & { mimeType: ImageMIME };

export class StickerIdConflictError extends Error {
  constructor(readonly stickerIds: string[]) {
    super(
      stickerIds.length === 1
        ? `Sticker id '${stickerIds[0]}' already exists.`
        : `Sticker ids '${stickerIds.join(", ")}' already exist.`,
    );
    this.name = "StickerIdConflictError";
  }
}
