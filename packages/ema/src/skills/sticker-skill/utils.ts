import fs from "node:fs/promises";
import path from "node:path";
import type { ImageMIME, InlineDataItem } from "../../shared/schema";
import { resolveEmaSourcePath } from "../../shared/package_path";
import {
  getStickerById,
  getStickerInPack,
  getStickerPack,
  type StickerDefinition,
} from "./pack";

const COLLECTION_PACK_NAME = "收藏";
const STICKER_ASSETS_DIR = resolveEmaSourcePath(
  "skills",
  "sticker-skill",
  "assets",
);

function getImageMimeTypeFromFileName(fileName: string): ImageMIME {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".heic") {
    return "image/heic";
  }
  if (ext === ".heif") {
    return "image/heif";
  }
  throw new Error(`Unsupported sticker image extension '${ext || fileName}'.`);
}

function getImageExtensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/png") {
    return ".png";
  }
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  if (mimeType === "image/heic") {
    return ".heic";
  }
  if (mimeType === "image/heif") {
    return ".heif";
  }
  throw new Error(`Unsupported image mime type '${mimeType}'.`);
}

async function writePackJson(
  packFilePath: string,
  pack: string,
  stickers: StickerDefinition[],
): Promise<void> {
  await fs.writeFile(
    packFilePath,
    JSON.stringify({ pack, stickers }, null, 2) + "\n",
    "utf-8",
  );
}

async function ensureCollectionPack(): Promise<{
  pack: string;
  dirPath: string;
  packFilePath: string;
  stickers: StickerDefinition[];
}> {
  let pack = await getStickerPack(COLLECTION_PACK_NAME);
  if (pack) {
    return {
      pack: pack.pack,
      dirPath: pack.dirPath,
      packFilePath: pack.packFilePath,
      stickers: pack.stickers.map(({ id, name, description, file }) => ({
        id,
        name,
        description,
        file,
      })),
    };
  }

  await fs.mkdir(STICKER_ASSETS_DIR, { recursive: true });
  const dirPath = path.join(STICKER_ASSETS_DIR, COLLECTION_PACK_NAME);
  const packFilePath = path.join(dirPath, "pack.json");
  await fs.mkdir(dirPath, { recursive: true });
  await writePackJson(packFilePath, COLLECTION_PACK_NAME, []);
  pack = await getStickerPack(COLLECTION_PACK_NAME);
  if (!pack) {
    throw new Error("Failed to initialize 收藏 sticker pack.");
  }
  return {
    pack: pack.pack,
    dirPath: pack.dirPath,
    packFilePath: pack.packFilePath,
    stickers: [],
  };
}

/**
 * Resolves the absolute sticker asset path for the given sticker identifier.
 * @param id - Sticker identifier.
 * @returns Absolute image file path.
 */
export async function resolveStickerFilePath(id: string): Promise<string> {
  const sticker = await getStickerById(id);
  if (!sticker) {
    throw new Error(`Unknown sticker id: ${id}`);
  }
  return sticker.filePath;
}

/**
 * Resolves the absolute sticker asset path for one sticker inside one specific pack.
 * @param pack - Pack name.
 * @param id - Sticker identifier.
 * @returns Absolute image file path.
 */
export async function resolveStickerFilePathInPack(
  pack: string,
  id: string,
): Promise<string> {
  const sticker = await getStickerInPack(pack, id);
  if (!sticker) {
    throw new Error(`Sticker '${id}' does not exist in pack '${pack}'.`);
  }
  return sticker.filePath;
}

/**
 * Reads one sticker image and encodes it as base64 data.
 * @param id - Sticker identifier.
 * @returns Base64-encoded payload without any data URI prefix.
 */
export async function stickerIdToBase64(id: string): Promise<string> {
  const filePath = await resolveStickerFilePath(id);
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}

/**
 * Reads one sticker image inside one specific pack and encodes it as base64 data.
 * @param pack - Pack name.
 * @param id - Sticker identifier.
 * @returns Base64-encoded payload without any data URI prefix.
 */
export async function stickerPackIdToBase64(
  pack: string,
  id: string,
): Promise<string> {
  const filePath = await resolveStickerFilePathInPack(pack, id);
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}

/**
 * Reads one sticker image and converts it to an inline_data content part.
 * @param id - Sticker identifier.
 * @returns Inline image part for multimodal tool responses.
 */
export async function stickerIdToInlineData(
  id: string,
): Promise<InlineDataItem> {
  const sticker = await getStickerById(id);
  if (!sticker) {
    throw new Error(`Unknown sticker id: ${id}`);
  }
  return {
    type: "inline_data",
    mimeType: getImageMimeTypeFromFileName(sticker.file),
    data: await stickerIdToBase64(id),
  };
}

/**
 * Reads one sticker image from one specific pack and converts it to an inline_data part.
 * @param pack - Pack name.
 * @param id - Sticker identifier.
 * @returns Inline image part for multimodal tool responses.
 */
export async function stickerPackIdToInlineData(
  pack: string,
  id: string,
): Promise<InlineDataItem> {
  const sticker = await getStickerInPack(pack, id);
  if (!sticker) {
    throw new Error(`Sticker '${id}' does not exist in pack '${pack}'.`);
  }
  return {
    type: "inline_data",
    mimeType: getImageMimeTypeFromFileName(sticker.file),
    data: await stickerPackIdToBase64(pack, id),
  };
}

/**
 * Updates one sticker's visible metadata inside a specific pack.
 * @param packName - Pack name.
 * @param id - Sticker identifier.
 * @param name - New sticker name.
 * @param description - New sticker description.
 */
export async function updateStickerMetadata(
  packName: string,
  id: string,
  name: string,
  description: string,
): Promise<void> {
  const pack = await getStickerPack(packName);
  if (!pack) {
    throw new Error(`Sticker pack '${packName}' does not exist.`);
  }
  const stickers = pack.stickers.map(({ id, name, description, file }) => ({
    id,
    name,
    description,
    file,
  }));
  const index = stickers.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error(`Sticker '${id}' does not exist in pack '${packName}'.`);
  }
  stickers[index] = {
    ...stickers[index],
    name: name.trim(),
    description: description.trim(),
  };
  await writePackJson(pack.packFilePath, pack.pack, stickers);
}

/**
 * Saves one inline image as a sticker inside the 收藏 pack and updates pack.json.
 * @param id - New sticker identifier.
 * @param name - New sticker name.
 * @param description - New sticker description.
 * @param inline - Source inline image data.
 */
export async function createCollectedSticker(
  id: string,
  name: string,
  description: string,
  inline: InlineDataItem,
): Promise<void> {
  if (!inline.mimeType.startsWith("image/")) {
    throw new Error("Only image media can be collected as stickers.");
  }
  if (await getStickerById(id)) {
    throw new Error(`Sticker id '${id}' already exists.`);
  }
  const collectionPack = await ensureCollectionPack();
  const ext = getImageExtensionFromMimeType(inline.mimeType);
  const fileName = `${id}${ext}`;
  const filePath = path.join(collectionPack.dirPath, fileName);
  await fs.writeFile(filePath, Buffer.from(inline.data, "base64"));
  const nextStickers = [
    ...collectionPack.stickers,
    {
      id: id.trim(),
      name: name.trim(),
      description: description.trim(),
      file: fileName,
    },
  ];
  await writePackJson(
    collectionPack.packFilePath,
    collectionPack.pack,
    nextStickers,
  );
}
