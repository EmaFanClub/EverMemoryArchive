import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { InlineDataItem } from "../llm/schema";
import { ActorWorkspaceService } from "../workspace";
import {
  type CreateCollectedStickerResult,
  type CreateStickerPackResult,
  type CreateStickerResult,
  type DeleteStickerResult,
  type DeleteStickerPackResult,
  type ExportStickerPackResult,
  type ImportStickerPackInput,
  type ImportStickerPackResult,
  type ResolvedStickerDefinition,
  type ResolvedStickerPack,
  StickerIdConflictError,
  type StickerDefinition,
  type StickerInlineData,
  type StickerPackDefinition,
  type UpdateStickerPackResult,
  type UpdateStickerMetadataResult,
  type UpdateStickerResult,
} from "./base";
import {
  buildEmaPack,
  getStickerImageMimeTypeFromFileName,
  type ParsedEmaSticker,
  parseEmaPack,
} from "./emapack";

const COLLECTION_PACK_NAME = "收藏";
const STICKER_ID_PATTERN = /^[A-Za-z0-9_]+$/;

export interface ActorStickerStoreOptions {
  workspace?: ActorWorkspaceService;
}

export class ActorStickerStore {
  private static readonly actorLocks = new Map<string, Promise<void>>();

  private readonly workspace: ActorWorkspaceService;

  constructor(options: ActorStickerStoreOptions = {}) {
    this.workspace = options.workspace ?? new ActorWorkspaceService();
  }

  async ensureActorStickerPacks(actorId: number): Promise<void> {
    await this.withActorStickerLock(actorId, async () => {
      const { stickerRoot } =
        await this.workspace.ensureActorStickerRoot(actorId);
      await this.ensureCollectionPackInRoot(stickerRoot);
    });
  }

  async listStickerPacks(actorId: number): Promise<ResolvedStickerPack[]> {
    const { stickerRoot } =
      await this.workspace.ensureActorStickerRoot(actorId);
    const entries = await fs.readdir(stickerRoot, { withFileTypes: true });
    const seenPackNames = new Set<string>();
    const seenStickerIds = new Set<string>();
    const packs: ResolvedStickerPack[] = [];

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing to load symlink sticker pack: ${entry.name}`);
      }
      if (!entry.isDirectory() || entry.name.startsWith(".import-")) {
        continue;
      }

      const pack = await this.readPack(stickerRoot, entry.name);
      if (seenPackNames.has(pack.pack)) {
        throw new Error(`Duplicate sticker pack name '${pack.pack}'.`);
      }
      seenPackNames.add(pack.pack);
      for (const sticker of pack.stickers) {
        if (seenStickerIds.has(sticker.id)) {
          throw new Error(`Duplicate sticker id '${sticker.id}'.`);
        }
        seenStickerIds.add(sticker.id);
      }
      packs.push(pack);
    }

    return packs;
  }

  async getStickerPack(
    actorId: number,
    pack: string,
  ): Promise<ResolvedStickerPack | null> {
    return (
      (await this.listStickerPacks(actorId)).find(
        (item) => item.pack === pack,
      ) ?? null
    );
  }

  async getStickerById(
    actorId: number,
    id: string,
  ): Promise<ResolvedStickerDefinition | null> {
    for (const pack of await this.listStickerPacks(actorId)) {
      const sticker = pack.stickers.find((item) => item.id === id);
      if (sticker) {
        return sticker;
      }
    }
    return null;
  }

  async getStickerInPack(
    actorId: number,
    pack: string,
    id: string,
  ): Promise<ResolvedStickerDefinition | null> {
    return (
      (await this.getStickerPack(actorId, pack))?.stickers.find(
        (item) => item.id === id,
      ) ?? null
    );
  }

  async formatStickerDisplayText(actorId: number, id: string): Promise<string> {
    const sticker = await this.getStickerById(actorId, id);
    if (!sticker) {
      return `[表情：未知表情,id=${id}]`;
    }
    return `[表情：${sticker.pack}/${sticker.name},id=${sticker.id}]`;
  }

  async resolveStickerFilePath(actorId: number, id: string): Promise<string> {
    const sticker = await this.getStickerById(actorId, id);
    if (!sticker) {
      throw new Error(`Unknown sticker id: ${id}`);
    }
    return sticker.filePath;
  }

  async stickerIdToBase64(actorId: number, id: string): Promise<string> {
    const filePath = await this.resolveStickerFilePath(actorId, id);
    return (await fs.readFile(filePath)).toString("base64");
  }

  async stickerIdToInlineData(
    actorId: number,
    id: string,
  ): Promise<StickerInlineData> {
    const sticker = await this.getStickerById(actorId, id);
    if (!sticker) {
      throw new Error(`Unknown sticker id: ${id}`);
    }
    return {
      type: "inline_data",
      mimeType: getStickerImageMimeTypeFromFileName(sticker.file),
      data: await this.stickerIdToBase64(actorId, id),
    };
  }

  async updateStickerMetadata(
    actorId: number,
    packName: string,
    id: string,
    name: string,
    description: string,
  ): Promise<UpdateStickerMetadataResult> {
    const currentPack = await this.getStickerPack(actorId, packName);
    if (!currentPack) {
      throw new Error(`Sticker pack '${packName}' does not exist.`);
    }
    return await this.updateSticker(
      actorId,
      currentPack.dirName,
      id,
      id,
      name,
      description,
    );
  }

  async updateStickerPackName(
    actorId: number,
    packDirName: string,
    name: string,
  ): Promise<UpdateStickerPackResult> {
    const dirName = assertPathSegment(
      assertString(packDirName, "packDirName"),
      "packDirName",
    );
    const nextName = assertString(name, "name");
    if (dirName === COLLECTION_PACK_NAME) {
      throw new Error("System sticker pack '收藏' cannot be renamed.");
    }

    return await this.withActorStickerLock(actorId, async () => {
      const { stickerRoot } =
        await this.workspace.ensureActorStickerRoot(actorId);
      const dirPath = path.join(stickerRoot, dirName);
      if (!(await pathExists(dirPath))) {
        throw new Error(`Sticker pack '${dirName}' does not exist.`);
      }

      const pack = await this.readPack(stickerRoot, dirName);
      if (pack.pack !== nextName) {
        const existingPacks = await this.listStickerPacks(actorId);
        if (
          existingPacks.some(
            (item) => item.dirName !== dirName && item.pack === nextName,
          )
        ) {
          throw new Error(`Sticker pack name '${nextName}' is already used.`);
        }
      }

      await writePackJson(
        pack.packFilePath,
        nextName,
        pack.stickers.map(({ id, name, description, file }) => ({
          id,
          name,
          description,
          file,
        })),
      );

      return {
        pack: await this.readPack(stickerRoot, dirName),
      };
    });
  }

  async createStickerPack(
    actorId: number,
    name: string,
  ): Promise<CreateStickerPackResult> {
    const packName = assertString(name, "name");

    return await this.withActorStickerLock(actorId, async () => {
      const { stickerRoot } =
        await this.workspace.ensureActorStickerRoot(actorId);
      await this.ensureCollectionPackInRoot(stickerRoot);
      const existingPacks = await this.listStickerPacks(actorId);
      if (existingPacks.some((pack) => pack.pack === packName)) {
        throw new Error(`Sticker pack name '${packName}' is already used.`);
      }

      const dirName = toSafePackDirName(packName);
      const dirPath = path.join(stickerRoot, dirName);
      assertInside(stickerRoot, dirPath, "Sticker pack path is outside actor.");
      if (await pathExists(dirPath)) {
        throw new Error(`Sticker pack path '${dirName}' is already used.`);
      }

      await fs.mkdir(dirPath);
      try {
        await writePackJson(path.join(dirPath, "pack.json"), packName, []);
        return {
          pack: await this.readPack(stickerRoot, dirName),
        };
      } catch (error) {
        await fs.rm(dirPath, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async updateSticker(
    actorId: number,
    packDirName: string,
    currentStickerId: string,
    nextId: string,
    name: string,
    description: string,
  ): Promise<UpdateStickerResult> {
    const dirName = assertPathSegment(
      assertString(packDirName, "packDirName"),
      "packDirName",
    );
    const currentId = assertString(currentStickerId, "stickerId");
    const nextStickerId = assertStickerId(assertString(nextId, "id"), "id");
    const nextName = assertString(name, "name");
    const nextDescription = assertString(description, "description");

    return await this.withActorStickerLock(actorId, async () => {
      const { stickerRoot } =
        await this.workspace.ensureActorStickerRoot(actorId);
      const dirPath = path.join(stickerRoot, dirName);
      if (!(await pathExists(dirPath))) {
        throw new Error(`Sticker pack '${dirName}' does not exist.`);
      }

      const pack = await this.readPack(stickerRoot, dirName);
      const stickers = pack.stickers.map(({ id, name, description, file }) => ({
        id,
        name,
        description,
        file,
      }));
      const index = stickers.findIndex((item) => item.id === currentId);
      if (index === -1) {
        throw new Error(
          `Sticker '${currentId}' does not exist in pack '${pack.pack}'.`,
        );
      }

      if (nextStickerId !== currentId) {
        const conflict = await this.getStickerById(actorId, nextStickerId);
        if (conflict) {
          throw new Error(`Sticker id '${nextStickerId}' already exists.`);
        }
      }

      stickers[index] = {
        ...stickers[index],
        id: nextStickerId,
        name: nextName,
        description: nextDescription,
      };
      await writePackJson(pack.packFilePath, pack.pack, stickers);

      const updatedPack = await this.readPack(stickerRoot, dirName);
      const updatedSticker = updatedPack.stickers.find(
        (item) => item.id === nextStickerId,
      );
      if (!updatedSticker) {
        throw new Error(`Failed to reload sticker '${nextStickerId}'.`);
      }
      return { pack: updatedPack, sticker: updatedSticker };
    });
  }

  async createCollectedSticker(
    actorId: number,
    id: string,
    name: string,
    description: string,
    inline: InlineDataItem,
  ): Promise<CreateCollectedStickerResult> {
    return await this.createSticker(
      actorId,
      COLLECTION_PACK_NAME,
      id,
      name,
      description,
      inline,
    );
  }

  async createSticker(
    actorId: number,
    packDirName: string,
    id: string,
    name: string,
    description: string,
    inline: InlineDataItem,
  ): Promise<CreateStickerResult> {
    const dirName = assertPathSegment(
      assertString(packDirName, "packDirName"),
      "packDirName",
    );
    const stickerId = assertStickerId(assertString(id, "id"), "id");
    const stickerName = assertString(name, "name");
    const stickerDescription = assertString(description, "description");
    if (!inline.mimeType.startsWith("image/")) {
      throw new Error("Only image media can be collected as stickers.");
    }

    return await this.withActorStickerLock(actorId, async () => {
      if (await this.getStickerById(actorId, stickerId)) {
        throw new Error(`Sticker id '${stickerId}' already exists.`);
      }
      const { stickerRoot } =
        await this.workspace.ensureActorStickerRoot(actorId);
      const pack =
        dirName === COLLECTION_PACK_NAME
          ? await this.ensureCollectionPackInRoot(stickerRoot)
          : await this.readPack(stickerRoot, dirName);
      const fileName = await this.nextAvailableStickerFileName(
        pack,
        stickerId,
        getImageExtensionFromMimeType(inline.mimeType),
      );
      const filePath = path.join(pack.dirPath, fileName);
      assertInside(
        pack.dirPath,
        filePath,
        "Sticker file path is outside pack.",
      );

      await writeFileAtomic(filePath, Buffer.from(inline.data, "base64"));
      await writePackJson(pack.packFilePath, pack.pack, [
        ...pack.stickers.map(({ id, name, description, file }) => ({
          id,
          name,
          description,
          file,
        })),
        {
          id: stickerId,
          name: stickerName,
          description: stickerDescription,
          file: fileName,
        },
      ]);

      const updatedPack = await this.readPack(
        path.dirname(pack.dirPath),
        pack.dirName,
      );
      const sticker = updatedPack.stickers.find(
        (item) => item.id === stickerId,
      );
      if (!sticker) {
        throw new Error(`Failed to reload sticker '${stickerId}'.`);
      }
      return { pack: updatedPack, sticker };
    });
  }

  private async nextAvailableStickerFileName(
    pack: ResolvedStickerPack,
    stickerId: string,
    extension: string,
  ): Promise<string> {
    const reserved = new Set(pack.stickers.map((item) => item.file));
    for (let index = 0; ; index += 1) {
      const fileName =
        index === 0
          ? `${stickerId}${extension}`
          : `${stickerId}-${index + 1}${extension}`;
      if (reserved.has(fileName)) {
        continue;
      }
      const filePath = path.join(pack.dirPath, fileName);
      assertInside(
        pack.dirPath,
        filePath,
        "Sticker file path is outside pack.",
      );
      if (!(await pathExists(filePath))) {
        return fileName;
      }
    }
  }

  async importStickerPack(
    actorId: number,
    input: ImportStickerPackInput,
  ): Promise<ImportStickerPackResult> {
    const fileName = assertString(input.fileName, "fileName");
    if (path.extname(fileName).toLowerCase() !== ".emapack") {
      throw new Error("Sticker pack import file must use .emapack extension.");
    }

    const parsed = await parseEmaPack(input.buffer);
    const importedPackName = parsed.manifest.pack.name;

    return await this.withActorStickerLock(actorId, async () => {
      const { stickerRoot } =
        await this.workspace.ensureActorStickerRoot(actorId);
      await this.ensureCollectionPackInRoot(stickerRoot);
      const existingPacks = await this.listStickerPacks(actorId);
      const existingIds = new Set(
        existingPacks.flatMap((pack) =>
          pack.stickers.map((sticker) => sticker.id),
        ),
      );
      const conflicts = parsed.stickers
        .map((sticker) => sticker.id)
        .filter((id) => existingIds.has(id));
      if (conflicts.length > 0) {
        throw new StickerIdConflictError([...new Set(conflicts)]);
      }

      if (importedPackName === COLLECTION_PACK_NAME) {
        return {
          pack: await this.importIntoCollectionPack(
            stickerRoot,
            parsed.stickers,
          ),
        };
      }

      const identity = await this.nextImportedPackIdentity(
        stickerRoot,
        existingPacks,
        importedPackName,
      );
      const tempDir = await fs.mkdtemp(
        path.join(stickerRoot, `.import-${identity.dirName}-`),
      );

      try {
        const stickers: StickerDefinition[] = [];
        const usedFileNames = new Set<string>();
        for (const sticker of parsed.stickers) {
          const stickerFileName = nextUniqueFileName(
            assertPathSegment(
              path.posix.basename(sticker.file),
              `Sticker file for '${sticker.id}'`,
            ),
            usedFileNames,
          );
          const stickerFilePath = path.join(tempDir, stickerFileName);
          assertInside(
            tempDir,
            stickerFilePath,
            "Sticker file path is outside imported pack.",
          );
          await writeFileAtomic(stickerFilePath, sticker.data);
          stickers.push({
            id: sticker.id,
            name: sticker.name,
            description: sticker.description,
            file: stickerFileName,
          });
        }

        await writePackJson(
          path.join(tempDir, "pack.json"),
          identity.packName,
          stickers,
        );
        const finalDir = path.join(stickerRoot, identity.dirName);
        assertInside(
          stickerRoot,
          finalDir,
          "Sticker pack path is outside actor.",
        );
        await fs.rename(tempDir, finalDir);
      } catch (error) {
        await fs.rm(tempDir, { recursive: true, force: true });
        throw error;
      }

      return {
        pack: await this.readPack(stickerRoot, identity.dirName),
      };
    });
  }

  private async importIntoCollectionPack(
    stickerRoot: string,
    importedStickers: ParsedEmaSticker[],
  ): Promise<ResolvedStickerPack> {
    const pack = await this.readPack(stickerRoot, COLLECTION_PACK_NAME);
    const stickers = pack.stickers.map(({ id, name, description, file }) => ({
      id,
      name,
      description,
      file,
    }));
    const usedFileNames = new Set(stickers.map((sticker) => sticker.file));
    const writtenFilePaths: string[] = [];

    try {
      for (const sticker of importedStickers) {
        const stickerFileName = await nextAvailableImportedStickerFileName(
          pack.dirPath,
          assertPathSegment(
            path.posix.basename(sticker.file),
            `Sticker file for '${sticker.id}'`,
          ),
          usedFileNames,
        );
        const stickerFilePath = path.join(pack.dirPath, stickerFileName);
        assertInside(
          pack.dirPath,
          stickerFilePath,
          "Sticker file path is outside collection pack.",
        );
        await writeFileAtomic(stickerFilePath, sticker.data);
        writtenFilePaths.push(stickerFilePath);
        stickers.push({
          id: sticker.id,
          name: sticker.name,
          description: sticker.description,
          file: stickerFileName,
        });
      }

      await writePackJson(pack.packFilePath, pack.pack, stickers);
    } catch (error) {
      await Promise.all(
        writtenFilePaths.map((filePath) =>
          fs.rm(filePath, { force: true }).catch(() => undefined),
        ),
      );
      throw error;
    }

    return await this.readPack(stickerRoot, COLLECTION_PACK_NAME);
  }

  async exportStickerPack(
    actorId: number,
    packDirName: string,
  ): Promise<ExportStickerPackResult> {
    const dirName = assertPathSegment(
      assertString(packDirName, "packDirName"),
      "packDirName",
    );

    return await this.withActorStickerLock(actorId, async () => {
      const { stickerRoot } =
        await this.workspace.ensureActorStickerRoot(actorId);
      const dirPath = path.join(stickerRoot, dirName);
      if (!(await pathExists(dirPath))) {
        throw new Error(`Sticker pack '${dirName}' does not exist.`);
      }
      const pack = await this.readPack(stickerRoot, dirName);
      const buffer = await buildEmaPack({
        pack: { name: pack.pack },
        stickers: await Promise.all(
          pack.stickers.map(async (sticker) => ({
            id: sticker.id,
            name: sticker.name,
            description: sticker.description,
            file: `stickers/${sticker.file}`,
            data: await fs.readFile(sticker.filePath),
          })),
        ),
      });

      return {
        pack,
        fileName: `${toSafeDownloadFileName(pack.pack)}.emapack`,
        buffer,
      };
    });
  }

  async deleteStickerPack(
    actorId: number,
    packDirName: string,
  ): Promise<DeleteStickerPackResult> {
    const dirName = assertPathSegment(
      assertString(packDirName, "packDirName"),
      "packDirName",
    );
    if (dirName === COLLECTION_PACK_NAME) {
      throw new Error("System sticker pack '收藏' cannot be deleted.");
    }
    return await this.withActorStickerLock(actorId, async () => {
      const { stickerRoot } =
        await this.workspace.ensureActorStickerRoot(actorId);
      const dirPath = path.join(stickerRoot, dirName);
      assertInside(stickerRoot, dirPath, "Sticker pack path is outside actor.");
      const stat = await lstatOrNull(dirPath);
      if (!stat) {
        return { deleted: false };
      }
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to delete symlink sticker pack: ${dirName}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Sticker pack '${dirName}' is not a directory.`);
      }
      await fs.rm(dirPath, { recursive: true, force: false });
      return { deleted: true };
    });
  }

  async deleteSticker(
    actorId: number,
    packDirName: string,
    stickerId: string,
  ): Promise<DeleteStickerResult> {
    const dirName = assertPathSegment(
      assertString(packDirName, "packDirName"),
      "packDirName",
    );
    const currentId = assertString(stickerId, "stickerId");

    return await this.withActorStickerLock(actorId, async () => {
      const { stickerRoot } =
        await this.workspace.ensureActorStickerRoot(actorId);
      const dirPath = path.join(stickerRoot, dirName);
      if (!(await pathExists(dirPath))) {
        return { deleted: false };
      }

      const pack = await this.readPackDefinition(stickerRoot, dirName);
      const index = pack.stickers.findIndex((item) => item.id === currentId);
      if (index === -1) {
        return { deleted: false };
      }
      const sticker = pack.stickers[index]!;
      const filePath = path.join(pack.dirPath, sticker.file);

      const fileStat = await lstatOrNull(filePath);
      if (fileStat?.isSymbolicLink()) {
        throw new Error(
          `Refusing to delete symlink sticker file: ${currentId}`,
        );
      }
      if (!fileStat?.isFile()) {
        throw new Error(
          `Sticker '${currentId}' in pack '${pack.pack}' is missing file '${sticker.file}'.`,
        );
      }

      await writePackJson(
        pack.packFilePath,
        pack.pack,
        pack.stickers
          .filter((item) => item.id !== currentId)
          .map(({ id, name, description, file }) => ({
            id,
            name,
            description,
            file,
          })),
      );
      await fs.rm(filePath, { force: false });

      return {
        deleted: true,
        pack: await this.readPack(stickerRoot, dirName),
        sticker: {
          ...sticker,
          pack: pack.pack,
          packDirName: pack.dirName,
          packDirPath: pack.dirPath,
          filePath,
        },
      };
    });
  }

  private async ensureCollectionPack(
    actorId: number,
  ): Promise<ResolvedStickerPack> {
    const existing = await this.getStickerPack(actorId, COLLECTION_PACK_NAME);
    if (existing) {
      return existing;
    }

    const { stickerRoot } =
      await this.workspace.ensureActorStickerRoot(actorId);
    return await this.ensureCollectionPackInRoot(stickerRoot);
  }

  private async ensureCollectionPackInRoot(
    stickerRoot: string,
  ): Promise<ResolvedStickerPack> {
    const dirPath = path.join(stickerRoot, COLLECTION_PACK_NAME);
    const stat = await lstatOrNull(dirPath);
    if (stat?.isSymbolicLink()) {
      throw new Error(
        "Refusing to initialize symlink collection sticker pack.",
      );
    }
    if (stat && !stat.isDirectory()) {
      throw new Error("Collection sticker pack path is not a directory.");
    }
    if (stat && (await pathExists(path.join(dirPath, "pack.json")))) {
      return await this.readPack(stickerRoot, COLLECTION_PACK_NAME);
    }
    await fs.mkdir(dirPath, { recursive: true });
    await writePackJson(
      path.join(dirPath, "pack.json"),
      COLLECTION_PACK_NAME,
      [],
    );
    return await this.readPack(stickerRoot, COLLECTION_PACK_NAME);
  }

  private async readPack(
    stickerRoot: string,
    dirName: string,
  ): Promise<ResolvedStickerPack> {
    const packDefinition = await this.readPackDefinition(stickerRoot, dirName);
    const stickers: ResolvedStickerDefinition[] = [];
    for (const sticker of packDefinition.stickers) {
      const filePath = path.join(packDefinition.dirPath, sticker.file);
      const fileStat = await fs.lstat(filePath);
      if (fileStat.isSymbolicLink()) {
        throw new Error(`Refusing to load symlink sticker file: ${sticker.id}`);
      }
      if (!fileStat.isFile()) {
        throw new Error(
          `Sticker '${sticker.id}' in pack '${packDefinition.pack}' is missing file '${sticker.file}'.`,
        );
      }
      stickers.push({
        ...sticker,
        pack: packDefinition.pack,
        packDirName: packDefinition.dirName,
        packDirPath: packDefinition.dirPath,
        filePath,
      });
    }

    return {
      ...packDefinition,
      stickers,
    };
  }

  private async readPackDefinition(
    stickerRoot: string,
    dirName: string,
  ): Promise<
    Omit<ResolvedStickerPack, "stickers"> & { stickers: StickerDefinition[] }
  > {
    const safeDirName = assertPathSegment(dirName, "packDirName");
    const dirPath = path.join(stickerRoot, safeDirName);
    assertInside(stickerRoot, dirPath, "Sticker pack path is outside actor.");
    const dirStat = await fs.lstat(dirPath);
    if (dirStat.isSymbolicLink()) {
      throw new Error(`Refusing to load symlink sticker pack: ${safeDirName}`);
    }
    if (!dirStat.isDirectory()) {
      throw new Error(`Sticker pack '${safeDirName}' is not a directory.`);
    }

    const packFilePath = path.join(dirPath, "pack.json");
    const packStat = await fs.lstat(packFilePath);
    if (packStat.isSymbolicLink()) {
      throw new Error(`Refusing to load symlink pack.json: ${safeDirName}`);
    }
    if (!packStat.isFile()) {
      throw new Error(`Sticker pack '${safeDirName}' is missing pack.json.`);
    }

    const raw = await fs.readFile(packFilePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StickerPackDefinition>;
    const pack = assertString(parsed.pack, `${packFilePath}:pack`);
    if (!Array.isArray(parsed.stickers)) {
      throw new Error(`${packFilePath}:stickers must be an array.`);
    }

    const stickers: StickerDefinition[] = [];
    for (const [index, value] of parsed.stickers.entries()) {
      if (!value || typeof value !== "object") {
        throw new Error(
          `${packFilePath}:stickers[${index}] must be an object.`,
        );
      }
      const item = value as Partial<StickerDefinition>;
      const sticker = {
        id: assertStickerId(
          assertString(item.id, `${packFilePath}:stickers[${index}].id`),
          `${packFilePath}:stickers[${index}].id`,
        ),
        name: assertString(
          item.name,
          `${packFilePath}:stickers[${index}].name`,
        ),
        description: assertString(
          item.description,
          `${packFilePath}:stickers[${index}].description`,
        ),
        file: assertPathSegment(
          assertString(item.file, `${packFilePath}:stickers[${index}].file`),
          `${packFilePath}:stickers[${index}].file`,
        ),
      } satisfies StickerDefinition;
      const filePath = path.join(dirPath, sticker.file);
      assertInside(
        dirPath,
        filePath,
        `Sticker '${sticker.id}' file path is outside pack.`,
      );
      stickers.push(sticker);
    }

    return {
      pack,
      stickers,
      dirName: safeDirName,
      dirPath,
      packFilePath,
    };
  }

  private async nextImportedPackIdentity(
    stickerRoot: string,
    existingPacks: ResolvedStickerPack[],
    packName: string,
  ): Promise<{ dirName: string; packName: string }> {
    const baseDirName = toSafePackDirName(packName);
    const existingPackNames = new Set(existingPacks.map((pack) => pack.pack));

    for (let suffix = 1; ; suffix += 1) {
      const dirName = suffix === 1 ? baseDirName : `${baseDirName}-${suffix}`;
      const displayName = suffix === 1 ? packName : `${packName} (${suffix})`;
      const dirPath = path.join(stickerRoot, dirName);
      assertInside(stickerRoot, dirPath, "Sticker pack path is outside actor.");
      if (!existingPackNames.has(displayName) && !(await pathExists(dirPath))) {
        return { dirName, packName: displayName };
      }
    }
  }

  private async withActorStickerLock<T>(
    actorId: number,
    callback: () => Promise<T>,
  ): Promise<T> {
    const key = this.actorLockKey(actorId);
    const previous = ActorStickerStore.actorLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    ActorStickerStore.actorLocks.set(key, queued);

    await previous;
    try {
      return await callback();
    } finally {
      release();
      if (ActorStickerStore.actorLocks.get(key) === queued) {
        ActorStickerStore.actorLocks.delete(key);
      }
    }
  }

  private actorLockKey(actorId: number): string {
    return `${path.resolve(this.workspace.getActorRoot(actorId), "..")}:${actorId}`;
  }
}

async function writePackJson(
  packFilePath: string,
  pack: string,
  stickers: StickerDefinition[],
): Promise<void> {
  await writeFileAtomic(
    packFilePath,
    Buffer.from(JSON.stringify({ pack, stickers }, null, 2) + "\n", "utf-8"),
  );
}

async function writeFileAtomic(
  filePath: string,
  data: Buffer | string,
): Promise<void> {
  const tmpFile = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  );
  try {
    await fs.writeFile(tmpFile, data);
    await fs.rename(tmpFile, filePath);
  } finally {
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
  }
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

function toSafePackDirName(packName: string): string {
  const safeName = packName
    .trim()
    .replace(/[\\/:\0]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "");
  if (!safeName || safeName === "." || safeName === "..") {
    return "pack";
  }
  return assertPathSegment(safeName, "pack name");
}

function toSafeDownloadFileName(packName: string): string {
  const safeName = packName
    .trim()
    .replace(/[\\/:\0]/g, "_")
    .replace(/\s+/g, " ");
  return safeName && safeName !== "." && safeName !== ".." ? safeName : "pack";
}

function nextUniqueFileName(fileName: string, usedFileNames: Set<string>) {
  const ext = path.extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  for (let index = 0; ; index += 1) {
    const candidate = index === 0 ? fileName : `${stem}-${index + 1}${ext}`;
    if (!usedFileNames.has(candidate)) {
      usedFileNames.add(candidate);
      return candidate;
    }
  }
}

async function nextAvailableImportedStickerFileName(
  packDirPath: string,
  fileName: string,
  usedFileNames: Set<string>,
): Promise<string> {
  const ext = path.extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  for (let index = 0; ; index += 1) {
    const candidate = index === 0 ? fileName : `${stem}-${index + 1}${ext}`;
    if (usedFileNames.has(candidate)) {
      continue;
    }

    const filePath = path.join(packDirPath, candidate);
    assertInside(packDirPath, filePath, "Sticker file path is outside pack.");
    if (!(await pathExists(filePath))) {
      usedFileNames.add(candidate);
      return candidate;
    }
  }
}

function assertInside(root: string, target: string, message: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(message);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  return (await lstatOrNull(filePath)) !== null;
}

async function lstatOrNull(filePath: string) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
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
  if (mimeType === "image/bmp") {
    return ".bmp";
  }
  if (mimeType === "image/gif") {
    return ".gif";
  }
  throw new Error(`Unsupported image mime type '${mimeType}'.`);
}
