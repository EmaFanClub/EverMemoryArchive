import fs from "node:fs/promises";
import path from "node:path";
import { commandExists, execFile } from "./shell";
import { packageFileName, platformDistRoot } from "./paths";
import type { PackageKind, Platform } from "./platforms";

export async function findSevenZip(): Promise<string> {
  const configured = process.env.EMA_DIST_7Z?.trim();
  if (configured) {
    return configured;
  }
  for (const command of ["7z", "7zz", "7za"]) {
    if (await commandExists(command)) {
      return command;
    }
  }
  throw new Error(
    "7-Zip was not found. Install 7z/7zz/7za or set EMA_DIST_7Z.",
  );
}

export async function extractArchive(
  archivePath: string,
  destination: string,
): Promise<void> {
  const sevenZip = await findSevenZip();
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  const scratch = `${destination}.extracting`;
  await fs.rm(scratch, { recursive: true, force: true });
  await fs.mkdir(scratch, { recursive: true });

  await execFile(sevenZip, ["x", archivePath, `-o${scratch}`, "-y"]);
  const innerTar = await findFirstFile(scratch, (fileName) =>
    fileName.endsWith(".tar"),
  );
  if (innerTar) {
    await execFile(sevenZip, ["x", innerTar, `-o${scratch}`, "-y"]);
    await fs.rm(innerTar, { force: true });
  }

  await copySingleRootContents(scratch, destination);
  await fs.rm(scratch, { recursive: true, force: true });
}

export async function createPackageArchives(
  platform: Platform,
  kind: PackageKind,
  revision: string,
  sourceRoot: string,
): Promise<string[]> {
  const sevenZip = await findSevenZip();
  const outDir = platformDistRoot(platform);
  await fs.mkdir(outDir, { recursive: true });
  await removeDanglingSymlinks(sourceRoot);
  const parent = path.dirname(sourceRoot);
  const rootName = path.basename(sourceRoot);
  const outputs = [
    path.join(outDir, packageFileName(platform, kind, revision, "7z")),
    path.join(outDir, packageFileName(platform, kind, revision, "zip")),
  ];

  for (const output of outputs) {
    await fs.rm(output, { force: true });
  }

  await execFile(sevenZip, ["a", "-t7z", "-mx=9", outputs[0], rootName], {
    cwd: parent,
  });
  await execFile(sevenZip, ["a", "-tzip", "-mx=9", outputs[1], rootName], {
    cwd: parent,
  });

  return outputs;
}

async function findFirstFile(
  root: string,
  predicate: (fileName: string) => boolean,
): Promise<string | null> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFirstFile(entryPath, predicate);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (predicate(entry.name)) {
      return entryPath;
    }
  }
  return null;
}

async function copySingleRootContents(
  source: string,
  destination: string,
): Promise<void> {
  const entries = await fs.readdir(source, { withFileTypes: true });
  const visibleEntries = entries.filter((entry) => entry.name !== "__MACOSX");
  if (visibleEntries.length === 1 && visibleEntries[0].isDirectory()) {
    await fs.cp(path.join(source, visibleEntries[0].name), destination, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    return;
  }
  for (const entry of visibleEntries) {
    await fs.cp(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      {
        recursive: true,
        force: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      },
    );
  }
}

async function removeDanglingSymlinks(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await removeDanglingSymlinks(entryPath);
      continue;
    }
    if (!entry.isSymbolicLink()) {
      continue;
    }
    try {
      await fs.stat(entryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await fs.rm(entryPath, { force: true });
      process.stderr.write(`Removed dangling staged symlink: ${entryPath}\n`);
    }
  }
}
