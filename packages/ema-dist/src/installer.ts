import { once } from "node:events";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
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

  await writeSelfInstaller({
    archivePath,
    kind,
    mode: platform.os === "win32" ? 0o644 : 0o755,
    outputPath,
    platform,
    sevenZipPath,
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

async function writeSelfInstaller(options: {
  readonly archivePath: string;
  readonly kind: PackageKind;
  readonly mode: number;
  readonly outputPath: string;
  readonly platform: Platform;
  readonly sevenZipPath: string;
}): Promise<void> {
  const template =
    options.platform.os === "win32"
      ? installerCmdTemplate
      : installerShTemplate;
  const writer = createWriteStream(options.outputPath, { mode: options.mode });
  try {
    await writeRenderedTemplate(writer, template, {
      archiveBase64: options.archivePath,
      kind: options.kind,
      platformId: options.platform.id,
      sevenZipBase64: options.sevenZipPath,
    });
    writer.end();
    await once(writer, "finish");
  } catch (error) {
    writer.destroy();
    await fs.rm(options.outputPath, { force: true });
    throw error;
  }
}

async function writeRenderedTemplate(
  writer: WriteStream,
  template: string,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  let cursor = 0;
  const sections = [
    { key: "sevenZipBase64", token: "{{sevenZipBase64}}" },
    { key: "archiveBase64", token: "{{archiveBase64}}" },
  ];
  const seen = new Set<string>();

  while (cursor < template.length) {
    const next = sections
      .map((section) => ({
        ...section,
        index: template.indexOf(section.token, cursor),
      }))
      .filter((section) => section.index >= 0)
      .sort((left, right) => left.index - right.index)[0];

    if (!next) {
      await writeString(writer, renderTemplate(template.slice(cursor), values));
      break;
    }

    await writeString(
      writer,
      renderTemplate(template.slice(cursor, next.index), values),
    );
    await writeBase64File(writer, values[next.key]);
    seen.add(next.key);
    cursor = next.index + next.token.length;
  }

  for (const section of sections) {
    if (!seen.has(section.key)) {
      throw new Error(`Missing installer template section ${section.token}.`);
    }
  }
}

async function writeBase64File(
  writer: WriteStream,
  filePath: string,
): Promise<void> {
  let carry: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let wroteLine = false;
  for await (const chunk of createReadStream(filePath, {
    highWaterMark: 57 * 8192,
  })) {
    const buffer = carry.length
      ? Buffer.concat([carry, chunk as Buffer])
      : (chunk as Buffer);
    const byteLength = buffer.length - (buffer.length % 57);
    if (byteLength > 0) {
      wroteLine = await writeWrappedBase64(
        writer,
        buffer.subarray(0, byteLength),
        wroteLine,
      );
    }
    carry = buffer.subarray(byteLength);
  }
  if (carry.length > 0) {
    await writeWrappedBase64(writer, carry, wroteLine);
  }
}

async function writeWrappedBase64(
  writer: WriteStream,
  value: Buffer,
  wroteLine: boolean,
): Promise<boolean> {
  const encoded = value.toString("base64");
  if (wroteLine) {
    await writeString(writer, "\n");
  }
  await writeString(writer, encoded.match(/.{1,76}/gu)?.join("\n") ?? "");
  return encoded.length > 0;
}

async function writeString(writer: WriteStream, value: string): Promise<void> {
  if (writer.write(value)) {
    return;
  }
  await once(writer, "drain");
}
