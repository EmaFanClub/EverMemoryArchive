import fs from "node:fs/promises";
import path from "node:path";
import { createArchiveFile } from "./archive";
import {
  debugSymbolsPackageFileName,
  debugSymbolsStageRoot,
  platformDistRoot,
  portableStageRoot,
  toPosixPath,
} from "./paths";
import type { Platform } from "./platforms";

export interface PortableDebugSymbolsStageResult {
  readonly root: string;
  readonly count: number;
}

interface StagePortableDebugSymbolsOptions {
  readonly reset?: boolean;
}

export async function stagePortableDebugSymbols(
  platform: Platform,
  options: StagePortableDebugSymbolsOptions = {},
): Promise<PortableDebugSymbolsStageResult> {
  const sourceRoot = portableStageRoot(platform);
  const targetRoot = debugSymbolsStageRoot(platform);
  if (options.reset) {
    await fs.rm(targetRoot, { recursive: true, force: true });
  }

  if (await exists(sourceRoot)) {
    await moveDebugSymbolFiles(sourceRoot, sourceRoot, targetRoot);
  }

  const files = await listDebugSymbolRelativePaths(targetRoot, targetRoot);
  if (files.length === 0) {
    if (options.reset) {
      await fs.rm(targetRoot, { recursive: true, force: true });
    }
    return { root: targetRoot, count: 0 };
  }

  await writeDebugSymbolsMetadata(targetRoot, platform, files);
  return { root: targetRoot, count: files.length };
}

export async function createPortableDebugSymbolsArchive(
  platform: Platform,
  revision: string,
): Promise<string | null> {
  const sourceRoot = debugSymbolsStageRoot(platform);
  if ((await listDebugSymbolFiles(sourceRoot)).length === 0) {
    return null;
  }
  return createArchiveFile(
    sourceRoot,
    path.join(
      platformDistRoot(platform),
      debugSymbolsPackageFileName(platform, revision, "7z"),
    ),
    "7z",
  );
}

async function moveDebugSymbolFiles(
  sourceRoot: string,
  currentRoot: string,
  targetRoot: string,
): Promise<void> {
  const entries = await fs.readdir(currentRoot, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(currentRoot, entry.name);
    if (entry.isDirectory()) {
      await moveDebugSymbolFiles(sourceRoot, sourcePath, targetRoot);
      continue;
    }

    if (!isDebugSymbolFile(entry.name)) {
      continue;
    }

    const relativePath = path.relative(sourceRoot, sourcePath);
    const targetPath = path.join(targetRoot, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await moveFile(sourcePath, targetPath);
  }
}

async function listDebugSymbolFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) {
    return [];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listDebugSymbolFiles(entryPath)));
      continue;
    }
    if (isDebugSymbolFile(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

async function listDebugSymbolRelativePaths(
  root: string,
  currentRoot: string,
): Promise<string[]> {
  if (!(await exists(currentRoot))) {
    return [];
  }
  const entries = await fs.readdir(currentRoot, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(currentRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listDebugSymbolRelativePaths(root, entryPath)));
      continue;
    }
    if (isDebugSymbolFile(entry.name)) {
      files.push(toPosixPath(path.relative(root, entryPath)));
    }
  }

  return files.sort();
}

async function writeDebugSymbolsMetadata(
  root: string,
  platform: Platform,
  files: readonly string[],
): Promise<void> {
  await fs.writeFile(
    path.join(root, "DEBUG-SYMBOLS.txt"),
    [
      "EverMemoryArchive portable debug symbols",
      "",
      `Platform: ${platform.id} (${platform.label})`,
      "",
      "This archive contains .pdb files removed from the portable package.",
      "Extract it over the matching portable package, or add the extracted directory to the debugger symbol path.",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "debug-symbols-manifest.json"),
    `${JSON.stringify(
      {
        name: "EverMemoryArchive portable debug symbols",
        platform: platform.id,
        platformLabel: platform.label,
        files,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

async function moveFile(source: string, target: string): Promise<void> {
  try {
    await fs.rm(target, { force: true });
    await fs.rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    await fs.copyFile(source, target);
    await fs.rm(source, { force: true });
  }
}

function isDebugSymbolFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".pdb");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
