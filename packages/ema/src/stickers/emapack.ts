import path from "node:path";

import JSZip from "jszip";

import type { ImageMIME } from "../llm/schema";
import type { StickerDefinition } from "./base";

export const EMAPACK_FORMAT = "ema.sticker-pack";
export const EMAPACK_VERSION = 1;
export const EMAPACK_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const EMAPACK_MAX_ENTRIES = 512;
export const EMAPACK_MAX_STICKER_BYTES = 5 * 1024 * 1024;
export const EMAPACK_MAX_TOTAL_STICKER_BYTES = 64 * 1024 * 1024;
const STICKER_ID_PATTERN = /^[A-Za-z0-9_]+$/;

export interface EmaStickerPackManifest {
  format: typeof EMAPACK_FORMAT;
  version: typeof EMAPACK_VERSION;
  pack: {
    name: string;
  };
  stickers: StickerDefinition[];
}

export interface ParsedEmaSticker extends StickerDefinition {
  data: Buffer;
}

export interface ParsedEmaPack {
  manifest: EmaStickerPackManifest;
  stickers: ParsedEmaSticker[];
}

export interface BuildEmaPackInput {
  pack: {
    name: string;
  };
  stickers: Array<StickerDefinition & { data: Buffer | Uint8Array }>;
}

export interface EmaPackParseLimits {
  maxArchiveBytes?: number;
  maxEntries?: number;
  maxStickerBytes?: number;
  maxTotalStickerBytes?: number;
}

export async function parseEmaPack(
  buffer: Buffer,
  limits: EmaPackParseLimits = {},
): Promise<ParsedEmaPack> {
  const resolvedLimits = {
    maxArchiveBytes: limits.maxArchiveBytes ?? EMAPACK_MAX_ARCHIVE_BYTES,
    maxEntries: limits.maxEntries ?? EMAPACK_MAX_ENTRIES,
    maxStickerBytes: limits.maxStickerBytes ?? EMAPACK_MAX_STICKER_BYTES,
    maxTotalStickerBytes:
      limits.maxTotalStickerBytes ?? EMAPACK_MAX_TOTAL_STICKER_BYTES,
  };
  if (buffer.byteLength > resolvedLimits.maxArchiveBytes) {
    throw new Error("Sticker pack archive is too large.");
  }

  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length > resolvedLimits.maxEntries) {
    throw new Error("Sticker pack archive has too many entries.");
  }
  for (const entry of entries) {
    assertSafeZipPath(
      entry.unsafeOriginalName ?? entry.name,
      "zip entry path",
      {
        allowDirectory: true,
      },
    );
    assertSafeZipPath(entry.name, "zip entry path", { allowDirectory: true });
    if (isZipEntrySymlink(entry)) {
      throw new Error(`Refusing to load symlink zip entry: ${entry.name}.`);
    }
  }

  const manifestFile = zip.file("emapack.json");
  if (!manifestFile) {
    throw new Error("emapack.json is required.");
  }

  const manifest = parseManifest(
    JSON.parse(await manifestFile.async("string")) as unknown,
  );
  const stickers: ParsedEmaSticker[] = [];
  let totalStickerBytes = 0;

  for (const sticker of manifest.stickers) {
    const file = zip.file(sticker.file);
    if (!file) {
      throw new Error(`Sticker file '${sticker.file}' is missing.`);
    }
    if (isZipEntrySymlink(file)) {
      throw new Error(`Refusing to load symlink sticker file: ${sticker.id}.`);
    }
    const declaredSize = getZipEntryUncompressedSize(file);
    if (
      declaredSize !== null &&
      declaredSize > resolvedLimits.maxStickerBytes
    ) {
      throw new Error(`Sticker file '${sticker.file}' is too large.`);
    }
    const data = Buffer.from(await file.async("uint8array"));
    if (data.byteLength > resolvedLimits.maxStickerBytes) {
      throw new Error(`Sticker file '${sticker.file}' is too large.`);
    }
    totalStickerBytes += data.byteLength;
    if (totalStickerBytes > resolvedLimits.maxTotalStickerBytes) {
      throw new Error("Sticker pack payload is too large.");
    }
    stickers.push({
      ...sticker,
      data,
    });
  }

  return {
    manifest,
    stickers,
  };
}

export async function buildEmaPack(input: BuildEmaPackInput): Promise<Buffer> {
  const manifest = parseManifest({
    format: EMAPACK_FORMAT,
    version: EMAPACK_VERSION,
    pack: {
      name: input.pack.name,
    },
    stickers: input.stickers.map(({ data: _data, ...sticker }) => sticker),
  });

  const zip = new JSZip();
  zip.file("emapack.json", JSON.stringify(manifest, null, 2) + "\n");
  for (const sticker of input.stickers) {
    zip.file(sticker.file, sticker.data);
  }

  return Buffer.from(
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
}

export function getStickerImageMimeTypeFromFileName(
  fileName: string,
): ImageMIME {
  const ext = path.posix.extname(fileName).toLowerCase();
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
  if (ext === ".bmp") {
    return "image/bmp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  throw new Error(`Unsupported sticker image extension '${ext || fileName}'.`);
}

function parseManifest(value: unknown): EmaStickerPackManifest {
  if (!value || typeof value !== "object") {
    throw new Error("emapack.json must be an object.");
  }
  const record = value as Partial<EmaStickerPackManifest>;
  if (record.format !== EMAPACK_FORMAT) {
    throw new Error(`Unsupported emapack format '${String(record.format)}'.`);
  }
  if (record.version !== EMAPACK_VERSION) {
    throw new Error(`Unsupported emapack version '${String(record.version)}'.`);
  }
  if (!record.pack || typeof record.pack !== "object") {
    throw new Error("emapack.json:pack must be an object.");
  }

  const pack = {
    name: assertString(record.pack.name, "emapack.json:pack.name"),
  };
  if (!Array.isArray(record.stickers)) {
    throw new Error("emapack.json:stickers must be an array.");
  }

  const seenIds = new Set<string>();
  const stickers = record.stickers.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`emapack.json:stickers[${index}] must be an object.`);
    }
    const stickerRecord = item as Partial<StickerDefinition>;
    const sticker = {
      id: assertStickerId(
        assertString(stickerRecord.id, `emapack.json:stickers[${index}].id`),
        `emapack.json:stickers[${index}].id`,
      ),
      name: assertString(
        stickerRecord.name,
        `emapack.json:stickers[${index}].name`,
      ),
      description: assertString(
        stickerRecord.description,
        `emapack.json:stickers[${index}].description`,
      ),
      file: assertStickerZipFilePath(
        assertString(
          stickerRecord.file,
          `emapack.json:stickers[${index}].file`,
        ),
        `emapack.json:stickers[${index}].file`,
      ),
    } satisfies StickerDefinition;

    if (seenIds.has(sticker.id)) {
      throw new Error(`Duplicate sticker id '${sticker.id}' in emapack.`);
    }
    seenIds.add(sticker.id);
    getStickerImageMimeTypeFromFileName(sticker.file);
    return sticker;
  });

  return {
    format: EMAPACK_FORMAT,
    version: EMAPACK_VERSION,
    pack,
    stickers,
  };
}

function assertStickerZipFilePath(value: string, field: string): string {
  const safePath = assertSafeZipPath(value, field);
  if (!safePath.startsWith("stickers/")) {
    throw new Error(`${field} must be inside stickers/.`);
  }
  return safePath;
}

function assertSafeZipPath(
  value: string,
  field: string,
  options: { allowDirectory?: boolean } = {},
): string {
  if (
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value)
  ) {
    throw new Error(`${field} must be a safe zip path.`);
  }

  const pathValue =
    options.allowDirectory && value.endsWith("/") ? value.slice(0, -1) : value;
  if (!pathValue || pathValue.endsWith("/")) {
    throw new Error(`${field} must be a safe zip path.`);
  }

  for (const segment of pathValue.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error(`${field} must be a safe zip path.`);
    }
  }
  return value;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function assertPathSegment(value: string, field: string): string {
  if (
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new Error(`${field} must be a safe path segment.`);
  }
  return value;
}

function assertStickerId(value: string, field: string): string {
  if (!STICKER_ID_PATTERN.test(value)) {
    throw new Error(
      `${field} must contain only letters, numbers, and underscores.`,
    );
  }
  return value;
}

function isZipEntrySymlink(entry: JSZip.JSZipObject): boolean {
  const unixPermissions = entry.unixPermissions;
  return (
    typeof unixPermissions === "number" &&
    (unixPermissions & 0o170000) === 0o120000
  );
}

function getZipEntryUncompressedSize(entry: JSZip.JSZipObject): number | null {
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })
    ._data;
  return typeof data?.uncompressedSize === "number"
    ? data.uncompressedSize
    : null;
}
