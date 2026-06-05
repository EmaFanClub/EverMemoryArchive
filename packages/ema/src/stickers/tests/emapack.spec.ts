import JSZip from "jszip";
import { describe, expect, test } from "vitest";

import { buildEmaPack, parseEmaPack } from "../emapack";

const TEST_IMAGE = Buffer.from("fake-image");

describe("emapack", () => {
  test("builds and parses a sticker pack archive", async () => {
    const archive = await buildEmaPack({
      pack: { name: "自定义包" },
      stickers: [
        {
          id: "wave",
          name: "挥手",
          description: "打招呼",
          file: "stickers/wave.png",
          data: TEST_IMAGE,
        },
      ],
    });

    const parsed = await parseEmaPack(archive);

    expect(parsed.manifest).toMatchObject({
      format: "ema.sticker-pack",
      version: 1,
      pack: { name: "自定义包" },
      stickers: [
        {
          id: "wave",
          name: "挥手",
          description: "打招呼",
          file: "stickers/wave.png",
        },
      ],
    });
    expect(parsed.stickers[0]?.data).toEqual(TEST_IMAGE);
  });

  test("rejects sticker files outside the stickers directory", async () => {
    const archive = await buildRawEmaPack({
      pack: { name: "坏包" },
      stickers: [
        {
          id: "escape",
          name: "逃逸",
          description: "不应该允许",
          file: "../escape.png",
          data: TEST_IMAGE,
        },
      ],
    });

    await expect(parseEmaPack(archive)).rejects.toThrow(/safe zip path/i);
  });

  test("rejects unsafe original zip entry paths normalized by JSZip", async () => {
    const zip = new JSZip();
    zip.file(
      "emapack.json",
      JSON.stringify({
        format: "ema.sticker-pack",
        version: 1,
        pack: { name: "坏包" },
        stickers: [
          {
            id: "evil",
            name: "逃逸",
            description: "不应该允许",
            file: "stickers/evil.png",
          },
        ],
      }),
    );
    zip.file("../stickers/evil.png", TEST_IMAGE);
    const archive = Buffer.from(
      await zip.generateAsync({ type: "uint8array" }),
    );

    await expect(parseEmaPack(archive)).rejects.toThrow(/safe zip path/i);
  });

  test("rejects stickers whose files are missing from the archive", async () => {
    const archive = await buildRawEmaPack({
      pack: { name: "坏包" },
      stickers: [
        {
          id: "missing",
          name: "缺失",
          description: "不应该允许",
          file: "stickers/missing.png",
          data: null,
        },
      ],
    });

    await expect(parseEmaPack(archive)).rejects.toThrow(/missing.png.*missing/);
  });

  test("rejects sticker ids outside letters numbers and underscores", async () => {
    const archive = await buildRawEmaPack({
      pack: { name: "坏包" },
      stickers: [
        {
          id: "bad-id",
          name: "非法",
          description: "非法 id",
          file: "stickers/bad.png",
          data: TEST_IMAGE,
        },
      ],
    });

    await expect(parseEmaPack(archive)).rejects.toThrow(
      /letters, numbers, and underscores/,
    );
  });

  test("rejects archives whose total sticker payload is too large", async () => {
    const archive = await buildRawEmaPack({
      pack: { name: "大包" },
      stickers: [
        {
          id: "large_one",
          name: "过大一",
          description: "不应该允许",
          file: "stickers/large-one.png",
          data: TEST_IMAGE,
        },
        {
          id: "large_two",
          name: "过大二",
          description: "不应该允许",
          file: "stickers/large-two.png",
          data: TEST_IMAGE,
        },
      ],
    });

    await expect(
      parseEmaPack(archive, { maxTotalStickerBytes: TEST_IMAGE.length }),
    ).rejects.toThrow(/too large/i);
  });
});

async function buildRawEmaPack(input: {
  pack: { name: string };
  stickers: Array<{
    id: string;
    name: string;
    description: string;
    file: string;
    data: Buffer | null;
  }>;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "emapack.json",
    JSON.stringify(
      {
        format: "ema.sticker-pack",
        version: 1,
        pack: input.pack,
        stickers: input.stickers.map(({ data: _data, ...sticker }) => sticker),
      },
      null,
      2,
    ),
  );
  for (const sticker of input.stickers) {
    if (sticker.data) {
      zip.file(sticker.file, sticker.data);
    }
  }
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}
