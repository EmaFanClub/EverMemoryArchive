import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { GlobalConfig } from "../config";
import type { ImageMIME } from "../llm/schema";
import { formatTimestamp } from "../shared/utils";
import type {
  ActorWorkspaceServiceOptions,
  DeleteFileItemResult,
  DeleteFilesResult,
  ListFilesResult,
  MkdirResult,
  ReadImageDataFileResult,
  MovePathResult,
  ResolvedActorStickerRoot,
  ReadFileResult,
  ResolvedWorkspacePath,
  ResolveWorkspacePathOptions,
  WorkspaceEntry,
  WriteBinaryFileResult,
  WriteFileResult,
} from "./base";
import {
  decodeUtf8Prefix,
  hashBuffer,
  hashFile,
  imageMimeTypeForPath,
  isInside,
  joinVirtualPath,
  normalizeWorkspacePath,
  scanFile,
  workspaceEntryType,
  workspacePathsConflict,
} from "./utils";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const DEFAULT_READ_BYTES = 64 * 1024;
const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 5 * 1024 * 1024;

interface ActivePathLock {
  workspaceDir: string;
  actorId: number;
  virtualPaths: string[];
  done: Promise<void>;
  release: () => void;
}

export class ActorWorkspaceService {
  private static readonly pathLocks: ActivePathLock[] = [];

  private readonly workspaceDir?: string;

  constructor(options: ActorWorkspaceServiceOptions = {}) {
    this.workspaceDir = options.workspaceDir;
  }

  getActorHomeRoot(actorId: number): string {
    this.assertActorId(actorId);
    return path.join(this.getActorRoot(actorId), "home");
  }

  getActorRoot(actorId: number): string {
    this.assertActorId(actorId);
    return path.join(this.getWorkspaceDir(), `actor_${actorId}`);
  }

  getActorStickerRoot(actorId: number): string {
    this.assertActorId(actorId);
    return path.join(this.getActorRoot(actorId), "stickers");
  }

  async ensureActorStickerRoot(
    actorId: number,
  ): Promise<ResolvedActorStickerRoot> {
    const actorRoot = await this.ensureActorRoot(actorId);
    const stickerRoot = this.getActorStickerRoot(actorId);
    await this.ensureDirectoryWithoutSymlink(
      stickerRoot,
      false,
      "actor sticker root",
    );

    return {
      actorId,
      actorRoot,
      stickerRoot,
      stickerRootReal: await fs.realpath(stickerRoot),
    };
  }

  async resolvePath(
    actorId: number,
    modelPath: string,
    options: ResolveWorkspacePathOptions = {},
  ): Promise<ResolvedWorkspacePath> {
    this.assertActorId(actorId);
    const virtualPath = normalizeWorkspacePath(modelPath);
    if (virtualPath === "." && options.allowRoot === false) {
      throw new Error("path must not be the workspace root.");
    }

    const { homeRoot, homeRootReal } = await this.ensureActorHomeRoot(actorId);
    const segments = virtualPath === "." ? [] : virtualPath.split("/");
    const realPath = path.join(homeRoot, ...segments);
    this.assertPathInside(homeRoot, realPath);

    const stat = await this.lstatOrNull(realPath);
    if (stat) {
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to access symlink path: ${virtualPath}`);
      }
      await this.validateExistingPathParents(homeRoot, homeRootReal, segments);
      const targetReal = await fs.realpath(realPath);
      this.assertRealPathInside(homeRootReal, targetReal);
    } else {
      await this.validateMissingPathParents(homeRoot, homeRootReal, segments);
      if (options.mustExist) {
        throw new Error(`File not found: ${virtualPath}`);
      }
    }

    return {
      actorId,
      virtualPath,
      realPath,
      homeRoot,
      homeRootReal,
    };
  }

  async listFiles(
    actorId: number,
    modelPath: string = ".",
    options: {
      recursive?: boolean;
      maxEntries?: number;
    } = {},
  ): Promise<ListFilesResult> {
    const resolved = await this.resolvePath(actorId, modelPath, {
      allowRoot: true,
      mustExist: true,
    });
    const stat = await fs.lstat(resolved.realPath);
    if (!stat.isDirectory()) {
      throw new Error(`path is not a directory: ${resolved.virtualPath}`);
    }

    const maxEntries = this.clampLimit(
      options.maxEntries,
      DEFAULT_LIST_LIMIT,
      MAX_LIST_LIMIT,
    );
    const entries: WorkspaceEntry[] = [];
    const truncated = { value: false };
    await this.collectEntries(
      resolved.realPath,
      resolved.virtualPath,
      Boolean(options.recursive),
      maxEntries,
      entries,
      truncated,
    );

    return {
      operation: "list",
      path: resolved.virtualPath,
      entries,
      truncated: truncated.value,
    };
  }

  async readFile(
    actorId: number,
    modelPath: string,
    options: { maxBytes?: number } = {},
  ): Promise<ReadFileResult> {
    const resolved = await this.resolvePath(actorId, modelPath, {
      allowRoot: false,
      mustExist: true,
    });
    const stat = await fs.lstat(resolved.realPath);
    if (stat.isDirectory()) {
      throw new Error(`path is a directory: ${resolved.virtualPath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`path is not a regular file: ${resolved.virtualPath}`);
    }

    const mimeType = imageMimeTypeForPath(resolved.virtualPath);
    if (mimeType) {
      return await this.readImageFile(resolved, stat.size, mimeType);
    }

    const maxBytes = this.clampLimit(
      options.maxBytes,
      DEFAULT_READ_BYTES,
      MAX_READ_BYTES,
    );
    return await this.readTextOrBinaryFile(resolved, stat.size, maxBytes);
  }

  async readImageDataFile(
    actorId: number,
    modelPath: string,
    options: { maxBytes?: number } = {},
  ): Promise<ReadImageDataFileResult> {
    const resolved = await this.resolvePath(actorId, modelPath, {
      allowRoot: false,
      mustExist: true,
    });
    const stat = await fs.lstat(resolved.realPath);
    if (stat.isDirectory()) {
      throw new Error(`path is a directory: ${resolved.virtualPath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`path is not a regular file: ${resolved.virtualPath}`);
    }

    const mimeType = imageMimeTypeForPath(resolved.virtualPath);
    if (!mimeType) {
      throw new Error(`path is not a supported image: ${resolved.virtualPath}`);
    }
    if (options.maxBytes !== undefined && stat.size > options.maxBytes) {
      throw new Error(`image exceeds ${options.maxBytes} bytes.`);
    }

    const data = await fs.readFile(resolved.realPath);
    if (options.maxBytes !== undefined && data.byteLength > options.maxBytes) {
      throw new Error(`image exceeds ${options.maxBytes} bytes.`);
    }

    return {
      path: resolved.virtualPath,
      size: data.byteLength,
      sha256: hashBuffer(data),
      mimeType,
      data,
    };
  }

  async writeFile(
    actorId: number,
    modelPath: string,
    options: {
      mode: "overwrite" | "append";
      content: string;
      expectedSha256?: string;
    },
  ): Promise<WriteFileResult> {
    const virtualPath = normalizeWorkspacePath(modelPath);
    return await this.withPathLock(actorId, virtualPath, async () => {
      const resolved = await this.resolvePath(actorId, virtualPath, {
        allowRoot: false,
      });
      const contentBuffer = Buffer.from(options.content, "utf-8");
      if (contentBuffer.byteLength > MAX_WRITE_BYTES) {
        throw new Error(`content exceeds ${MAX_WRITE_BYTES} bytes.`);
      }

      const existing = await this.lstatOrNull(resolved.realPath);
      if (existing && !existing.isFile()) {
        throw new Error(
          `path already exists and is not a file: ${resolved.virtualPath}`,
        );
      }

      if (options.expectedSha256 !== undefined) {
        const currentHash = existing ? await hashFile(resolved.realPath) : "";
        if (currentHash !== options.expectedSha256) {
          throw new Error(
            "Current file sha256 does not match expected_sha256.",
          );
        }
      }

      await fs.mkdir(path.dirname(resolved.realPath), { recursive: true });
      const writeResolved = await this.resolvePath(
        actorId,
        resolved.virtualPath,
        {
          allowRoot: false,
        },
      );
      if (options.mode === "overwrite") {
        let tmpFile: string | null =
          `${writeResolved.realPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
        try {
          await fs.writeFile(tmpFile, contentBuffer);
          await fs.rename(tmpFile, writeResolved.realPath);
          tmpFile = null;
        } finally {
          if (tmpFile) {
            await fs.rm(tmpFile, { force: true }).catch(() => undefined);
          }
        }
      } else {
        await fs.appendFile(writeResolved.realPath, contentBuffer);
      }

      const finalStat = await fs.lstat(writeResolved.realPath);
      return {
        operation: "write",
        path: writeResolved.virtualPath,
        mode: options.mode,
        size: finalStat.size,
        sha256: await hashFile(writeResolved.realPath),
      };
    });
  }

  async writeBinaryFile(
    actorId: number,
    modelPath: string,
    content: Buffer,
    options: { overwrite?: boolean; maxBytes?: number } = {},
  ): Promise<WriteBinaryFileResult> {
    const virtualPath = normalizeWorkspacePath(modelPath);
    return await this.withPathLock(actorId, virtualPath, async () => {
      if (
        options.maxBytes !== undefined &&
        content.byteLength > options.maxBytes
      ) {
        throw new Error(`content exceeds ${options.maxBytes} bytes.`);
      }

      const resolved = await this.resolvePath(actorId, virtualPath, {
        allowRoot: false,
      });
      this.assertBinaryWriteTarget(
        await this.lstatOrNull(resolved.realPath),
        resolved.virtualPath,
        Boolean(options.overwrite),
      );

      await fs.mkdir(path.dirname(resolved.realPath), { recursive: true });
      const writeResolved = await this.resolvePath(
        actorId,
        resolved.virtualPath,
        {
          allowRoot: false,
        },
      );
      const overwritten = this.assertBinaryWriteTarget(
        await this.lstatOrNull(writeResolved.realPath),
        writeResolved.virtualPath,
        Boolean(options.overwrite),
      );

      let tmpFile: string | null =
        `${writeResolved.realPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
      try {
        await fs.writeFile(tmpFile, content);
        await fs.rename(tmpFile, writeResolved.realPath);
        tmpFile = null;
      } finally {
        if (tmpFile) {
          await fs.rm(tmpFile, { force: true }).catch(() => undefined);
        }
      }

      const finalStat = await fs.lstat(writeResolved.realPath);
      return {
        path: writeResolved.virtualPath,
        size: finalStat.size,
        sha256: await hashFile(writeResolved.realPath),
        overwritten,
      };
    });
  }

  async mkdir(actorId: number, modelPath: string): Promise<MkdirResult> {
    const virtualPath = normalizeWorkspacePath(modelPath);
    return await this.withPathLock(actorId, virtualPath, async () => {
      const resolved = await this.resolvePath(actorId, virtualPath, {
        allowRoot: false,
      });
      const existing = await this.lstatOrNull(resolved.realPath);
      if (existing) {
        if (!existing.isDirectory()) {
          throw new Error(
            `path already exists and is not a directory: ${virtualPath}`,
          );
        }
        return {
          operation: "mkdir",
          path: resolved.virtualPath,
          created: false,
        };
      }

      await fs.mkdir(resolved.realPath, { recursive: true });
      const created = await this.resolvePath(actorId, resolved.virtualPath, {
        allowRoot: false,
        mustExist: true,
      });
      const stat = await fs.lstat(created.realPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to access symlink path: ${virtualPath}`);
      }
      return {
        operation: "mkdir",
        path: created.virtualPath,
        created: true,
      };
    });
  }

  async movePath(
    actorId: number,
    sourceModelPath: string,
    targetModelPath: string,
    options: { overwrite?: boolean } = {},
  ): Promise<MovePathResult> {
    const sourceVirtualPath = normalizeWorkspacePath(sourceModelPath);
    const targetVirtualPath = normalizeWorkspacePath(targetModelPath);

    return await this.withPathLocks(
      actorId,
      [sourceVirtualPath, targetVirtualPath],
      async () => {
        if (sourceVirtualPath === ".") {
          throw new Error("source_path must not be the workspace root.");
        }
        if (targetVirtualPath === ".") {
          throw new Error("target_path must not be the workspace root.");
        }
        if (sourceVirtualPath === targetVirtualPath) {
          throw new Error("source_path and target_path must be different.");
        }
        if (targetVirtualPath.startsWith(`${sourceVirtualPath}/`)) {
          throw new Error("Cannot move a path into itself.");
        }

        const source = await this.resolvePath(actorId, sourceVirtualPath, {
          allowRoot: false,
          mustExist: true,
        });
        const sourceStat = await fs.lstat(source.realPath);
        const sourceType = workspaceEntryType(sourceStat);

        const target = await this.resolvePath(actorId, targetVirtualPath, {
          allowRoot: false,
        });
        await this.validateMoveTarget(sourceType, target, options);

        await fs.mkdir(path.dirname(target.realPath), { recursive: true });
        const moveTarget = await this.resolvePath(actorId, target.virtualPath, {
          allowRoot: false,
        });
        const overwritten = Boolean(
          await this.validateMoveTarget(sourceType, moveTarget, options),
        );
        const moveSource = await this.resolvePath(actorId, source.virtualPath, {
          allowRoot: false,
          mustExist: true,
        });

        await fs.rename(moveSource.realPath, moveTarget.realPath);
        const movedStat = await fs.lstat(moveTarget.realPath);
        return {
          operation: "move",
          sourcePath: moveSource.virtualPath,
          targetPath: moveTarget.virtualPath,
          type: workspaceEntryType(movedStat),
          overwritten,
        };
      },
    );
  }

  async deleteFiles(
    actorId: number,
    modelPaths: string[],
    options: { recursive?: boolean; dryRun?: boolean } = {},
  ): Promise<DeleteFilesResult> {
    const planned: Array<
      { ok: true; path: string } | { ok: false; result: DeleteFileItemResult }
    > = [];
    const lockPaths: string[] = [];

    for (const modelPath of modelPaths) {
      try {
        const virtualPath = normalizeWorkspacePath(modelPath);
        planned.push({ ok: true, path: virtualPath });
        lockPaths.push(virtualPath);
      } catch (error) {
        planned.push({
          ok: false,
          result: {
            path: String(modelPath),
            status: "rejected",
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    return await this.withPathLocks(actorId, lockPaths, async () => {
      const results: DeleteFileItemResult[] = [];
      for (const item of planned) {
        results.push(
          item.ok
            ? await this.deleteOne(actorId, item.path, options)
            : item.result,
        );
      }
      return {
        operation: "delete",
        results,
      };
    });
  }

  private async deleteOne(
    actorId: number,
    virtualPath: string,
    options: { recursive?: boolean; dryRun?: boolean },
  ): Promise<DeleteFileItemResult> {
    if (virtualPath === ".") {
      return {
        path: virtualPath,
        status: "rejected",
        reason: "Refusing to delete workspace root.",
      };
    }

    let resolved: ResolvedWorkspacePath;
    try {
      resolved = await this.resolvePath(actorId, virtualPath, {
        allowRoot: false,
      });
    } catch (error) {
      return {
        path: virtualPath,
        status: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    const stat = await this.lstatOrNull(resolved.realPath);
    if (!stat) {
      return {
        path: resolved.virtualPath,
        status: "not_found",
      };
    }

    const type = workspaceEntryType(stat);
    if (stat.isDirectory()) {
      const children = await fs.readdir(resolved.realPath);
      if (children.length > 0 && !options.recursive) {
        return {
          path: resolved.virtualPath,
          status: "rejected",
          type,
          reason: "directory is not empty; set recursive=true",
        };
      }
    }

    if (options.dryRun) {
      return {
        path: resolved.virtualPath,
        status: "would_delete",
        type,
        ...(stat.isDirectory()
          ? { recursive: Boolean(options.recursive) }
          : {}),
      };
    }

    await fs.rm(resolved.realPath, {
      recursive: Boolean(options.recursive),
      force: false,
    });
    return {
      path: resolved.virtualPath,
      status: "deleted",
      type,
      ...(stat.isDirectory() ? { recursive: Boolean(options.recursive) } : {}),
    };
  }

  private async collectEntries(
    directoryPath: string,
    directoryVirtualPath: string,
    recursive: boolean,
    maxEntries: number,
    entries: WorkspaceEntry[],
    truncated: { value: boolean },
  ): Promise<void> {
    if (truncated.value) {
      return;
    }
    const dirents = await fs.readdir(directoryPath, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      if (entries.length >= maxEntries) {
        truncated.value = true;
        return;
      }
      const realPath = path.join(directoryPath, dirent.name);
      const stat = await fs.lstat(realPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to list symlink path: ${dirent.name}`);
      }
      const virtualPath = joinVirtualPath(directoryVirtualPath, dirent.name);
      const type = workspaceEntryType(stat);
      entries.push({
        path: virtualPath,
        type,
        ...(stat.isFile() ? { size: stat.size } : {}),
        modifiedAt: formatTimestamp("YYYY-MM-DD HH:mm:ss", stat.mtimeMs),
      });
      if (recursive && stat.isDirectory()) {
        await this.collectEntries(
          realPath,
          virtualPath,
          recursive,
          maxEntries,
          entries,
          truncated,
        );
      }
    }
  }

  private async readImageFile(
    resolved: ResolvedWorkspacePath,
    size: number,
    mimeType: ImageMIME,
  ): Promise<ReadFileResult> {
    if (size > MAX_IMAGE_PREVIEW_BYTES) {
      return {
        operation: "read",
        path: resolved.virtualPath,
        type: "image",
        size,
        sha256: await hashFile(resolved.realPath),
        mimeType,
      };
    }

    const buffer = await fs.readFile(resolved.realPath);
    return {
      operation: "read",
      path: resolved.virtualPath,
      type: "image",
      size: buffer.byteLength,
      sha256: hashBuffer(buffer),
      mimeType,
      images: [
        {
          type: "inline_data",
          mimeType,
          data: buffer.toString("base64"),
        },
      ],
    };
  }

  private async readTextOrBinaryFile(
    resolved: ResolvedWorkspacePath,
    size: number,
    maxBytes: number,
  ): Promise<ReadFileResult> {
    const scan = await scanFile(resolved.realPath, maxBytes);
    if (scan.isUtf8) {
      const content = decodeUtf8Prefix(scan.prefix);
      return {
        operation: "read",
        path: resolved.virtualPath,
        type: "text",
        size,
        sha256: scan.sha256,
        content,
        truncated: Buffer.byteLength(content, "utf-8") < size,
      };
    }

    return {
      operation: "read",
      path: resolved.virtualPath,
      type: "binary",
      size,
      sha256: scan.sha256,
    };
  }

  private async validateMissingPathParents(
    homeRoot: string,
    homeRootReal: string,
    segments: string[],
  ): Promise<void> {
    let currentPath = homeRoot;
    for (const segment of segments.slice(0, -1)) {
      currentPath = path.join(currentPath, segment);
      const stat = await this.lstatOrNull(currentPath);
      if (!stat) {
        return;
      }
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to access symlink parent: ${segment}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Parent path is not a directory: ${segment}`);
      }
      const realPath = await fs.realpath(currentPath);
      this.assertRealPathInside(homeRootReal, realPath);
    }
  }

  private async validateExistingPathParents(
    homeRoot: string,
    homeRootReal: string,
    segments: string[],
  ): Promise<void> {
    let currentPath = homeRoot;
    for (const segment of segments.slice(0, -1)) {
      currentPath = path.join(currentPath, segment);
      const stat = await fs.lstat(currentPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to access symlink parent: ${segment}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Parent path is not a directory: ${segment}`);
      }
      const realPath = await fs.realpath(currentPath);
      this.assertRealPathInside(homeRootReal, realPath);
    }
  }

  private async withPathLock<T>(
    actorId: number,
    virtualPath: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    return await this.withPathLocks(actorId, [virtualPath], callback);
  }

  private async withPathLocks<T>(
    actorId: number,
    virtualPaths: string[],
    callback: () => Promise<T>,
  ): Promise<T> {
    const lockPaths = Array.from(new Set(virtualPaths));
    if (lockPaths.length === 0) {
      return await callback();
    }

    const workspaceDir = path.resolve(this.getWorkspaceDir());
    while (true) {
      const blockers = ActorWorkspaceService.pathLocks
        .filter(
          (lock) =>
            lock.workspaceDir === workspaceDir &&
            lock.actorId === actorId &&
            lock.virtualPaths.some((lockedPath) =>
              lockPaths.some((virtualPath) =>
                workspacePathsConflict(lockedPath, virtualPath),
              ),
            ),
        )
        .map((lock) => lock.done);
      if (blockers.length === 0) {
        break;
      }
      await Promise.all(blockers);
    }

    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entry: ActivePathLock = {
      workspaceDir,
      actorId,
      virtualPaths: lockPaths,
      done,
      release,
    };
    ActorWorkspaceService.pathLocks.push(entry);

    try {
      return await callback();
    } finally {
      release();
      const index = ActorWorkspaceService.pathLocks.indexOf(entry);
      if (index >= 0) {
        ActorWorkspaceService.pathLocks.splice(index, 1);
      }
    }
  }

  private async validateMoveTarget(
    sourceType: WorkspaceEntry["type"],
    target: ResolvedWorkspacePath,
    options: { overwrite?: boolean },
  ): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
    const targetStat = await this.lstatOrNull(target.realPath);
    if (!targetStat) {
      return null;
    }
    if (!options.overwrite) {
      throw new Error(`target path already exists: ${target.virtualPath}`);
    }
    if (sourceType !== "file" || !targetStat.isFile()) {
      throw new Error("overwrite only supports replacing files.");
    }
    return targetStat;
  }

  private assertBinaryWriteTarget(
    stat: Awaited<ReturnType<typeof fs.lstat>> | null,
    virtualPath: string,
    overwrite: boolean,
  ): boolean {
    if (!stat) {
      return false;
    }
    if (!stat.isFile()) {
      throw new Error(`path already exists and is not a file: ${virtualPath}`);
    }
    if (!overwrite) {
      throw new Error(`path already exists: ${virtualPath}`);
    }
    return true;
  }

  private async ensureActorHomeRoot(
    actorId: number,
  ): Promise<{ homeRoot: string; homeRootReal: string }> {
    const actorRoot = await this.ensureActorRoot(actorId);
    const homeRoot = this.getActorHomeRoot(actorId);
    await this.ensureDirectoryWithoutSymlink(
      homeRoot,
      false,
      "actor home root",
    );

    return {
      homeRoot,
      homeRootReal: await fs.realpath(homeRoot),
    };
  }

  private async ensureActorRoot(actorId: number): Promise<string> {
    this.assertActorId(actorId);
    const workspaceDir = this.getWorkspaceDir();
    await this.ensureDirectoryWithoutSymlink(
      workspaceDir,
      true,
      "workspace root",
    );

    const actorRoot = this.getActorRoot(actorId);
    await this.ensureDirectoryWithoutSymlink(actorRoot, false, "actor root");
    return actorRoot;
  }

  private async ensureDirectoryWithoutSymlink(
    directoryPath: string,
    recursive: boolean,
    label: string,
  ): Promise<void> {
    try {
      await fs.mkdir(directoryPath, { recursive });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }

    const stat = await fs.lstat(directoryPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to use symlink ${label}.`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Workspace ${label} is not a directory.`);
    }
  }

  private assertActorId(actorId: number): void {
    if (!Number.isInteger(actorId) || actorId <= 0) {
      throw new Error("actorId must be a positive integer.");
    }
  }

  private assertPathInside(root: string, target: string): void {
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(target);
    if (!isInside(resolvedRoot, resolvedTarget)) {
      throw new Error("Resolved path is outside actor workspace.");
    }
  }

  private assertRealPathInside(rootReal: string, targetReal: string): void {
    if (!isInside(rootReal, targetReal)) {
      throw new Error("Resolved path is outside actor workspace.");
    }
  }

  private async lstatOrNull(filePath: string) {
    try {
      return await fs.lstat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private clampLimit(
    value: number | undefined,
    defaultValue: number,
    maxValue: number,
  ): number {
    if (value === undefined) {
      return defaultValue;
    }
    return Math.max(1, Math.min(value, maxValue));
  }

  private getWorkspaceDir(): string {
    return this.workspaceDir ?? GlobalConfig.paths.workspaceDir;
  }
}
