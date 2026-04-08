import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One sticker entry inside one sticker pack.
 */
export interface StickerDefinition {
  /** Stable machine-readable sticker identifier. */
  id: string;
  /** Human-readable sticker name. */
  name: string;
  /** Short description shown to the model. */
  description: string;
  /** Relative file name inside the pack directory. */
  file: string;
}

/**
 * Raw sticker pack definition loaded from one pack.json file.
 */
export interface StickerPackDefinition {
  /** Human-readable pack name. */
  pack: string;
  /** Sticker list defined by this pack. */
  stickers: StickerDefinition[];
}

/**
 * Sticker entry resolved with its containing pack and absolute file path.
 */
export interface ResolvedStickerDefinition extends StickerDefinition {
  /** Human-readable pack name. */
  pack: string;
  /** Directory name under assets/. */
  packDirName: string;
  /** Absolute pack directory path. */
  packDirPath: string;
  /** Absolute image file path. */
  filePath: string;
}

/**
 * Sticker pack resolved with file-system metadata.
 */
export interface ResolvedStickerPack extends StickerPackDefinition {
  /** Directory name under assets/. */
  dirName: string;
  /** Absolute pack directory path. */
  dirPath: string;
  /** Absolute pack.json path. */
  packFilePath: string;
  /** Sticker list resolved with pack metadata. */
  stickers: ResolvedStickerDefinition[];
}

const STICKER_ASSETS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "assets",
);

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readStickerPackFile(
  packFilePath: string,
): Promise<StickerPackDefinition> {
  const raw = await fs.readFile(packFilePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<StickerPackDefinition>;
  const pack = assertString(parsed.pack, `${packFilePath}:pack`);
  if (!Array.isArray(parsed.stickers)) {
    throw new Error(`${packFilePath}:stickers must be an array.`);
  }
  const stickers = parsed.stickers.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`${packFilePath}:stickers[${index}] must be an object.`);
    }
    const record = item as Partial<StickerDefinition>;
    return {
      id: assertString(record.id, `${packFilePath}:stickers[${index}].id`),
      name: assertString(
        record.name,
        `${packFilePath}:stickers[${index}].name`,
      ),
      description: assertString(
        record.description,
        `${packFilePath}:stickers[${index}].description`,
      ),
      file: assertString(
        record.file,
        `${packFilePath}:stickers[${index}].file`,
      ),
    } satisfies StickerDefinition;
  });
  return { pack, stickers };
}

async function loadStickerPacks(): Promise<ResolvedStickerPack[]> {
  if (!(await pathExists(STICKER_ASSETS_DIR))) {
    return [];
  }

  const entries = (
    await fs.readdir(STICKER_ASSETS_DIR, { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const seenPackNames = new Set<string>();
  const seenStickerIds = new Set<string>();
  const packs: ResolvedStickerPack[] = [];
  for (const dirName of entries) {
    const dirPath = path.join(STICKER_ASSETS_DIR, dirName);
    const packFilePath = path.join(dirPath, "pack.json");
    if (!(await pathExists(packFilePath))) {
      throw new Error(`Sticker pack '${dirName}' is missing pack.json.`);
    }
    const pack = await readStickerPackFile(packFilePath);
    if (seenPackNames.has(pack.pack)) {
      throw new Error(`Duplicate sticker pack name '${pack.pack}'.`);
    }
    seenPackNames.add(pack.pack);

    const stickers: ResolvedStickerDefinition[] = [];
    for (const item of pack.stickers) {
      if (seenStickerIds.has(item.id)) {
        throw new Error(`Duplicate sticker id '${item.id}'.`);
      }
      seenStickerIds.add(item.id);
      const filePath = path.join(dirPath, item.file);
      if (!(await pathExists(filePath))) {
        throw new Error(
          `Sticker '${item.id}' in pack '${pack.pack}' is missing file '${item.file}'.`,
        );
      }
      stickers.push({
        ...item,
        pack: pack.pack,
        packDirName: dirName,
        packDirPath: dirPath,
        filePath,
      });
    }

    packs.push({
      ...pack,
      dirName,
      dirPath,
      packFilePath,
      stickers,
    });
  }

  return packs;
}

/**
 * Lists all available sticker packs discovered under assets/.
 * This is intentionally reloaded from disk on each call so pack.json changes
 * can take effect immediately without restarting the server.
 * @returns All resolved sticker packs.
 */
export async function listStickerPacks(): Promise<ResolvedStickerPack[]> {
  return loadStickerPacks();
}

/**
 * Looks up one pack by its pack name.
 * @param pack - Pack name.
 * @returns The matching pack, or null when absent.
 */
export async function getStickerPack(
  pack: string,
): Promise<ResolvedStickerPack | null> {
  return (await loadStickerPacks()).find((item) => item.pack === pack) ?? null;
}

/**
 * Looks up a sticker by its stable global identifier.
 * @param id - Sticker identifier.
 * @returns The matching sticker, or null when absent.
 */
export async function getStickerById(
  id: string,
): Promise<ResolvedStickerDefinition | null> {
  for (const pack of await loadStickerPacks()) {
    const sticker = pack.stickers.find((item) => item.id === id);
    if (sticker) {
      return sticker;
    }
  }
  return null;
}

/**
 * Looks up a sticker by pack name and id.
 * @param pack - Pack name.
 * @param id - Sticker identifier.
 * @returns The matching sticker, or null when absent.
 */
export async function getStickerInPack(
  pack: string,
  id: string,
): Promise<ResolvedStickerDefinition | null> {
  return (
    (await getStickerPack(pack))?.stickers.find((item) => item.id === id) ??
    null
  );
}

/**
 * Renders the available sticker list for prompt injection.
 * @returns Markdown list grouped by pack.
 */
export async function buildAvailableStickersMarkdown(): Promise<string> {
  const packs = await loadStickerPacks();
  if (packs.length === 0) {
    return "- None.";
  }
  return packs
    .map((pack) =>
      [
        `- ${pack.pack}`,
        ...pack.stickers.map(
          (item) =>
            `  - id: \`${item.id}\`｜名称：${item.name}｜说明：${item.description}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
}

/**
 * Formats a readable proxy text stored in history for one sticker send.
 * @param id - Sticker identifier.
 * @returns Display text used in persisted history and previews.
 */
export async function formatStickerDisplayText(id: string): Promise<string> {
  const sticker = await getStickerById(id);
  if (!sticker) {
    return `[表情：未知表情,id=${id}]`;
  }
  return `[表情：${sticker.pack}/${sticker.name},id=${sticker.id}]`;
}
