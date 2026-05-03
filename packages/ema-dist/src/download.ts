import fs from "node:fs/promises";
import path from "node:path";
import { extractArchive } from "./archive";
import { downloadsRoot, portableStageRoot } from "./paths";
import type { Platform } from "./platforms";

interface RuntimeVersions {
  readonly node: string;
  readonly mongodb: string;
  readonly sevenZip: string;
}

interface DownloadedDependency {
  readonly name: "node" | "mongodb" | "7zip";
  readonly url: string;
  readonly bundled: boolean;
  readonly note?: string;
}

export async function downloadPortableDependencies(
  platform: Platform,
): Promise<DownloadedDependency[]> {
  const versions = await resolveRuntimeVersions();
  const stageRoot = portableStageRoot(platform);
  const portablesRoot = path.join(stageRoot, "portables");
  await fs.mkdir(portablesRoot, { recursive: true });

  const dependencies: DownloadedDependency[] = [];
  const node = nodeArtifact(platform, versions.node);
  await downloadAndExtract(
    node.url,
    node.fileName,
    path.join(portablesRoot, "node"),
  );
  dependencies.push({ name: "node", url: node.url, bundled: true });

  if (platform.canBundleMongo) {
    const mongodb = mongodbArtifact(platform, versions.mongodb);
    await downloadAndExtract(
      mongodb.url,
      mongodb.fileName,
      path.join(portablesRoot, "mongodb"),
    );
    dependencies.push({
      name: "mongodb",
      url: mongodb.url,
      bundled: true,
      note: platform.mongoNote,
    });
  } else {
    dependencies.push({
      name: "mongodb",
      url: "",
      bundled: false,
      note: platform.mongoNote,
    });
  }

  const sevenZip = sevenZipArtifact(platform, versions.sevenZip);
  const sevenZipArchive = await downloadFile(sevenZip.url, sevenZip.fileName);
  const sevenZipDest = path.join(portablesRoot, "7zip");
  if (platform.os === "win32") {
    await extractWindowsSevenZip(sevenZipArchive, sevenZipDest);
  } else {
    await extractArchive(sevenZipArchive, sevenZipDest);
    await chmodIfExists(path.join(sevenZipDest, "7zz"), 0o755);
  }
  dependencies.push({ name: "7zip", url: sevenZip.url, bundled: true });

  await fs.writeFile(
    path.join(portablesRoot, "manifest.json"),
    `${JSON.stringify(
      {
        platform: platform.id,
        label: platform.label,
        versions,
        dependencies,
      },
      null,
      2,
    )}\n`,
  );

  await chmodIfExists(path.join(portablesRoot, "node", "bin", "node"), 0o755);
  await chmodIfExists(
    path.join(portablesRoot, "mongodb", "bin", "mongod"),
    0o755,
  );
  return dependencies;
}

export async function resolveRuntimeVersions(): Promise<RuntimeVersions> {
  const requestedNode = process.env.EMA_DIST_NODE_VERSION?.trim() || "22";
  return {
    node: await resolveNodeVersion(requestedNode),
    mongodb: process.env.EMA_DIST_MONGODB_VERSION?.trim() || "8.2.7",
    sevenZip: process.env.EMA_DIST_7ZIP_VERSION?.trim() || "26.01",
  };
}

async function resolveNodeVersion(requested: string): Promise<string> {
  const normalized = requested.replace(/^v/u, "");
  if (/^\d+\.\d+\.\d+$/u.test(normalized)) {
    return normalized;
  }
  if (!/^\d+$/u.test(normalized)) {
    throw new Error(
      `EMA_DIST_NODE_VERSION must be a major version or exact semver, got '${requested}'.`,
    );
  }
  const response = await fetch("https://nodejs.org/dist/index.json");
  if (!response.ok) {
    throw new Error(
      `Failed to resolve Node.js ${requested}: ${response.status} ${response.statusText}`,
    );
  }
  const releases = (await response.json()) as Array<{ version: string }>;
  const major = Number(normalized);
  const matching = releases
    .map((release) => release.version.replace(/^v/u, ""))
    .filter((version) => Number(version.split(".")[0]) === major)
    .sort(compareSemverDesc);
  if (!matching[0]) {
    throw new Error(`No Node.js release found for major ${major}.`);
  }
  return matching[0];
}

function compareSemverDesc(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const delta = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function nodeArtifact(
  platform: Platform,
  version: string,
): { url: string; fileName: string } {
  let target: string;
  let extension: "zip" | "tar.gz" | "tar.xz";
  if (platform.os === "win32") {
    target = platform.arch === "arm64" ? "win-arm64" : "win-x64";
    extension = "zip";
  } else if (platform.os === "darwin") {
    target = platform.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
    extension = "tar.gz";
  } else if (platform.id === "linux-armhf") {
    target = "linux-armv7l";
    extension = "tar.xz";
  } else if (platform.id === "alpine-x64") {
    target = "linux-x64-musl";
    extension = "tar.xz";
    const fileName = `node-v${version}-${target}.${extension}`;
    return {
      fileName,
      url: `https://unofficial-builds.nodejs.org/download/release/v${version}/${fileName}`,
    };
  } else {
    target = platform.arch === "arm64" ? "linux-arm64" : "linux-x64";
    extension = "tar.xz";
  }
  const fileName = `node-v${version}-${target}.${extension}`;
  return {
    fileName,
    url: `https://nodejs.org/dist/v${version}/${fileName}`,
  };
}

function mongodbArtifact(
  platform: Platform,
  version: string,
): { url: string; fileName: string } {
  let fileName: string;
  if (platform.os === "win32") {
    fileName = `mongodb-windows-x86_64-${version}.zip`;
    return {
      fileName,
      url: `https://fastdl.mongodb.org/windows/${fileName}`,
    };
  }
  if (platform.os === "darwin") {
    const arch = platform.arch === "arm64" ? "arm64" : "x86_64";
    fileName = `mongodb-macos-${arch}-${version}.tgz`;
    return {
      fileName,
      url: `https://fastdl.mongodb.org/osx/${fileName}`,
    };
  }
  if (platform.arch === "arm64") {
    fileName = `mongodb-linux-aarch64-ubuntu2204-${version}.tgz`;
  } else {
    fileName = `mongodb-linux-x86_64-debian12-${version}.tgz`;
  }
  return {
    fileName,
    url: `https://fastdl.mongodb.org/linux/${fileName}`,
  };
}

function sevenZipArtifact(
  platform: Platform,
  version: string,
): { url: string; fileName: string } {
  const shortVersion = version.replace(/\D/gu, "");
  if (platform.os === "win32") {
    const fileName = `7z${shortVersion}-extra.7z`;
    return {
      fileName,
      url: `https://www.7-zip.org/a/${fileName}`,
    };
  }
  if (platform.os === "darwin") {
    const fileName = `7z${shortVersion}-mac.tar.xz`;
    return {
      fileName,
      url: `https://www.7-zip.org/a/${fileName}`,
    };
  }
  const arch =
    platform.arch === "arm64"
      ? "arm64"
      : platform.arch === "armhf"
        ? "arm"
        : "x64";
  const fileName = `7z${shortVersion}-linux-${arch}.tar.xz`;
  return {
    fileName,
    url: `https://www.7-zip.org/a/${fileName}`,
  };
}

async function downloadAndExtract(
  url: string,
  fileName: string,
  destination: string,
): Promise<void> {
  const archivePath = await downloadFile(url, fileName);
  await extractArchive(archivePath, destination);
}

async function downloadFile(url: string, fileName: string): Promise<string> {
  const destination = path.join(downloadsRoot(), fileName);
  const existing = await fileExists(destination);
  if (existing) {
    return destination;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  process.stdout.write(`Downloading ${url}\n`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await fs.writeFile(destination, bytes);
  return destination;
}

async function extractWindowsSevenZip(
  archivePath: string,
  destination: string,
): Promise<void> {
  const scratch = `${destination}.extracting`;
  await extractArchive(archivePath, scratch);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  const candidate =
    (await findFile(scratch, (filePath) =>
      filePath.toLowerCase().endsWith(`${path.sep}x64${path.sep}7za.exe`),
    )) ??
    (await findFile(scratch, (filePath) =>
      filePath.toLowerCase().endsWith(`${path.sep}7za.exe`),
    ));
  if (!candidate) {
    throw new Error(`Could not find 7za.exe in ${archivePath}.`);
  }
  await fs.copyFile(candidate, path.join(destination, "7za.exe"));
  await fs.rm(scratch, { recursive: true, force: true });
}

async function findFile(
  root: string,
  predicate: (filePath: string) => boolean,
): Promise<string | null> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(entryPath, predicate);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (predicate(entryPath)) {
      return entryPath;
    }
  }
  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size > 0;
  } catch {
    return false;
  }
}

async function chmodIfExists(filePath: string, mode: number): Promise<void> {
  try {
    await fs.chmod(filePath, mode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
