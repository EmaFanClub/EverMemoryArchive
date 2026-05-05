import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  APP_ICON_SOURCE,
  generatePngIcon,
  generateWindowsIcon,
} from "../icons";

const require = createRequire(import.meta.url);
const sharp = require("sharp") as typeof import("sharp");

const EXPECTED_ICON_SIZES = [256, 128, 64, 48, 32, 16] as const;

describe("Windows icon generation", () => {
  test("generates a multi-resolution ICO from the checked-in app logo", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ema-icon-"));
    const iconPath = path.join(tempRoot, "ema-logo.ico");

    try {
      await generateWindowsIcon(APP_ICON_SOURCE, iconPath);
      const icon = await fs.readFile(iconPath);

      expect(icon.readUInt16LE(0)).toBe(0);
      expect(icon.readUInt16LE(2)).toBe(1);
      expect(icon.readUInt16LE(4)).toBe(EXPECTED_ICON_SIZES.length);

      for (const [index, size] of EXPECTED_ICON_SIZES.entries()) {
        const directoryOffset = 6 + index * 16;
        const imageSize = icon[directoryOffset] || 256;
        const imageHeight = icon[directoryOffset + 1] || 256;
        const bytesInResource = icon.readUInt32LE(directoryOffset + 8);
        const imageOffset = icon.readUInt32LE(directoryOffset + 12);

        expect(imageSize).toBe(size);
        expect(imageHeight).toBe(size);
        expect(icon.readUInt16LE(directoryOffset + 4)).toBe(1);
        expect(icon.readUInt16LE(directoryOffset + 6)).toBe(32);
        expect(icon.readUInt32LE(imageOffset)).toBe(40);
        expect(icon.readInt32LE(imageOffset + 4)).toBe(size);
        expect(icon.readInt32LE(imageOffset + 8)).toBe(size * 2);
        expect(icon.readUInt16LE(imageOffset + 12)).toBe(1);
        expect(icon.readUInt16LE(imageOffset + 14)).toBe(32);
        expect(bytesInResource).toBe(
          40 + size * size * 4 + Math.ceil(size / 32) * 4 * size,
        );
        expect(iconAlphaAt(icon, imageOffset, size, 0, 0)).toBe(0);
        expect(iconAlphaAt(icon, imageOffset, size, size - 1, 0)).toBe(0);
        expect(iconAlphaAt(icon, imageOffset, size, 0, size - 1)).toBe(0);
        expect(iconAlphaAt(icon, imageOffset, size, size - 1, size - 1)).toBe(
          0,
        );
        expect(
          iconAlphaAt(icon, imageOffset, size, Math.floor(size / 2), 0),
        ).toBe(255);
        expect(
          iconAlphaAt(icon, imageOffset, size, Math.floor(size / 2), size - 1),
        ).toBe(255);
        expect(
          iconAlphaAt(
            icon,
            imageOffset,
            size,
            Math.floor(size / 2),
            Math.floor(size / 2),
          ),
        ).toBe(255);
      }
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("generates a masked PNG icon for WebUI metadata", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ema-icon-"));
    const iconPath = path.join(tempRoot, "icon.png");

    try {
      await generatePngIcon(APP_ICON_SOURCE, iconPath, 180);
      const { data, info } = await sharp(iconPath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      expect(info.width).toBe(180);
      expect(info.height).toBe(180);
      expect(info.channels).toBe(4);
      expect(rawAlphaAt(data, info.width, 0, 0)).toBe(0);
      expect(rawAlphaAt(data, info.width, info.width - 1, 0)).toBe(0);
      expect(rawAlphaAt(data, info.width, Math.floor(info.width / 2), 0)).toBe(
        255,
      );
      expect(
        rawAlphaAt(
          data,
          info.width,
          Math.floor(info.width / 2),
          Math.floor(info.height / 2),
        ),
      ).toBe(255);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

function iconAlphaAt(
  icon: Buffer,
  imageOffset: number,
  size: number,
  x: number,
  y: number,
): number {
  const dibHeaderLength = 40;
  const storedY = size - 1 - y;
  return icon[imageOffset + dibHeaderLength + (storedY * size + x) * 4 + 3];
}

function rawAlphaAt(rgba: Buffer, width: number, x: number, y: number): number {
  return rgba[(y * width + x) * 4 + 3];
}
