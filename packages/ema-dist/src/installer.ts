import fs from "node:fs/promises";
import path from "node:path";
import {
  installerFileName,
  packageFileName,
  platformDistRoot,
  portableStageRoot,
} from "./paths";
import type { PackageKind, Platform } from "./platforms";
import installerCmdTemplate from "./templates/installer.cmd?raw";
import installerShTemplate from "./templates/installer.sh?raw";
import { renderTemplate } from "./templates";

export async function createSelfInstaller(
  platform: Platform,
  kind: PackageKind,
  revision: string,
): Promise<string> {
  const outDir = platformDistRoot(platform);
  const archivePath = path.join(
    outDir,
    packageFileName(platform, kind, revision, "7z"),
  );
  const sevenZipPath = installerSevenZipPath(platform);
  const outputPath = path.join(
    outDir,
    installerFileName(platform, kind, revision),
  );

  const [archive, sevenZip] = await Promise.all([
    fs.readFile(archivePath),
    fs.readFile(sevenZipPath),
  ]);
  const script =
    platform.os === "win32"
      ? windowsInstaller(platform, kind, archive, sevenZip)
      : posixInstaller(platform, kind, archive, sevenZip);
  await fs.writeFile(outputPath, script, {
    mode: platform.os === "win32" ? 0o644 : 0o755,
  });
  if (platform.os !== "win32") {
    await fs.chmod(outputPath, 0o755);
  }
  return outputPath;
}

function installerSevenZipPath(platform: Platform): string {
  const binary = platform.os === "win32" ? "7za.exe" : "7zz";
  return path.join(portableStageRoot(platform), "portables", "7zip", binary);
}

function posixInstaller(
  platform: Platform,
  kind: PackageKind,
  archive: Buffer,
  sevenZip: Buffer,
): string {
  return renderInstallerTemplate(installerShTemplate, {
    archive,
    kind,
    platform,
    sevenZip,
  });
}

function windowsInstaller(
  platform: Platform,
  kind: PackageKind,
  archive: Buffer,
  sevenZip: Buffer,
): string {
  return renderInstallerTemplate(installerCmdTemplate, {
    archive,
    kind,
    platform,
    sevenZip,
  });
}

function renderInstallerTemplate(
  template: string,
  options: {
    readonly archive: Buffer;
    readonly kind: PackageKind;
    readonly platform: Platform;
    readonly sevenZip: Buffer;
  },
): string {
  return renderTemplate(template, {
    archiveBase64: wrapBase64(options.archive),
    kind: options.kind,
    platformId: options.platform.id,
    sevenZipBase64: wrapBase64(options.sevenZip),
  });
}

function wrapBase64(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/.{1,76}/gu, (chunk) => `${chunk}\n`)
    .trimEnd();
}
