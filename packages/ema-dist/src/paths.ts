import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageKind, Platform } from "./platforms";

export function workspaceRoot(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
}

export function distRoot(): string {
  return path.join(workspaceRoot(), "dist");
}

export function platformDistRoot(platform: Platform): string {
  return path.join(distRoot(), platform.id);
}

export function portableStageRoot(platform: Platform): string {
  return path.join(platformDistRoot(platform), "EverMemoryArchive");
}

export function minimalStageRoot(platform: Platform): string {
  return path.join(platformDistRoot(platform), ".minimal", "EverMemoryArchive");
}

export function debugSymbolsStageRoot(platform: Platform): string {
  return path.join(
    platformDistRoot(platform),
    ".debug-symbols",
    "EverMemoryArchive",
  );
}

export function stageRoot(platform: Platform, kind: PackageKind): string {
  return kind === "portable"
    ? portableStageRoot(platform)
    : minimalStageRoot(platform);
}

export function downloadsRoot(): string {
  return path.join(distRoot(), ".downloads");
}

export function packageFileName(
  platform: Platform,
  kind: PackageKind,
  revision: string,
  extension: "7z" | "zip",
): string {
  return `ema-${platform.id}-${kind}-${revision}.${extension}`;
}

export function debugSymbolsPackageFileName(
  platform: Platform,
  revision: string,
  extension: "7z",
): string {
  return `ema-${platform.id}-portable-debug-symbols-${revision}.${extension}`;
}

export function installerFileName(
  platform: Platform,
  kind: PackageKind,
  revision: string,
): string {
  return `ema-${platform.id}-${kind}-${revision}-installer${platform.installerExt}`;
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
