import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { workspaceRoot } from "./paths";

const require = createRequire(import.meta.url);
const sharp = require("sharp") as typeof import("sharp");

const WINDOWS_ICON_SIZES = [256, 128, 64, 48, 32, 16] as const;

interface IconImage {
  readonly size: number;
  readonly rgba: Buffer;
}

export const APP_ICON_SOURCE = path.join(
  workspaceRoot(),
  ".github",
  "assets",
  "ema-logo-min.jpg",
);
export const WINDOWS_ICON_ASSET = path.join(
  workspaceRoot(),
  "packages",
  "ema-dist",
  "assets",
  "ema-logo.ico",
);

export async function ensureWindowsIconAsset(): Promise<string> {
  try {
    const [sourceStat, iconStat] = await Promise.all([
      fs.stat(APP_ICON_SOURCE),
      fs.stat(WINDOWS_ICON_ASSET),
    ]);
    if (iconStat.mtimeMs >= sourceStat.mtimeMs) {
      return WINDOWS_ICON_ASSET;
    }
  } catch {
    // Missing or stale generated icon: rebuild it from the checked-in jpg.
  }
  return generateWindowsIconAsset();
}

export async function generateWindowsIconAsset(): Promise<string> {
  await generateWindowsIcon(APP_ICON_SOURCE, WINDOWS_ICON_ASSET);
  return WINDOWS_ICON_ASSET;
}

export async function generateWindowsIcon(
  sourcePath: string,
  outputPath: string,
): Promise<void> {
  const images = await Promise.all(
    WINDOWS_ICON_SIZES.map(async (size) => ({
      size,
      rgba: await renderIconImage(sourcePath, size),
    })),
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buildIco(images));
}

async function renderIconImage(
  sourcePath: string,
  size: number,
): Promise<Buffer> {
  const { data, info } = await sharp(sourcePath)
    .resize(size, size, { fit: "cover" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== size || info.height !== size || info.channels !== 4) {
    throw new Error(
      `Unexpected ${size}px icon render: ${info.width}x${info.height}x${info.channels}.`,
    );
  }
  return data;
}

function buildIco(images: readonly IconImage[]): Buffer {
  const headerLength = 6;
  const directoryLength = images.length * 16;
  const imageBuffers = images.map((image) => buildDib(image));
  const output = Buffer.alloc(
    headerLength +
      directoryLength +
      imageBuffers.reduce((total, image) => total + image.length, 0),
  );

  output.writeUInt16LE(0, 0);
  output.writeUInt16LE(1, 2);
  output.writeUInt16LE(images.length, 4);

  let imageOffset = headerLength + directoryLength;
  for (const [index, image] of images.entries()) {
    const directoryOffset = headerLength + index * 16;
    const imageBuffer = imageBuffers[index];
    output[directoryOffset] = image.size === 256 ? 0 : image.size;
    output[directoryOffset + 1] = image.size === 256 ? 0 : image.size;
    output[directoryOffset + 2] = 0;
    output[directoryOffset + 3] = 0;
    output.writeUInt16LE(1, directoryOffset + 4);
    output.writeUInt16LE(32, directoryOffset + 6);
    output.writeUInt32LE(imageBuffer.length, directoryOffset + 8);
    output.writeUInt32LE(imageOffset, directoryOffset + 12);
    imageBuffer.copy(output, imageOffset);
    imageOffset += imageBuffer.length;
  }

  return output;
}

function buildDib(image: IconImage): Buffer {
  const { size, rgba } = image;
  const headerLength = 40;
  const pixelLength = size * size * 4;
  const maskStride = Math.ceil(size / 32) * 4;
  const output = Buffer.alloc(headerLength + pixelLength + maskStride * size);

  output.writeUInt32LE(headerLength, 0);
  output.writeInt32LE(size, 4);
  output.writeInt32LE(size * 2, 8);
  output.writeUInt16LE(1, 12);
  output.writeUInt16LE(32, 14);
  output.writeUInt32LE(0, 16);
  output.writeUInt32LE(pixelLength, 20);
  output.writeInt32LE(0, 24);
  output.writeInt32LE(0, 28);
  output.writeUInt32LE(0, 32);
  output.writeUInt32LE(0, 36);

  let outputOffset = headerLength;
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const inputOffset = (y * size + x) * 4;
      output[outputOffset] = rgba[inputOffset + 2];
      output[outputOffset + 1] = rgba[inputOffset + 1];
      output[outputOffset + 2] = rgba[inputOffset];
      output[outputOffset + 3] = rgba[inputOffset + 3];
      outputOffset += 4;
    }
  }

  return output;
}
