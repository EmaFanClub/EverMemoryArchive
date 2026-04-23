import { describe, expect, test, vi } from "vitest";

vi.mock("../pack", () => ({
  buildAvailableStickersMarkdown: vi
    .fn()
    .mockResolvedValue(
      "- 测试表情包\n  - id: `test_sticker_1`｜名称：测试表情｜说明：用于测试",
    ),
  formatStickerDisplayText: vi.fn(async (id: string) =>
    id === "test_sticker_1"
      ? "[表情：测试表情包/测试表情,id=test_sticker_1]"
      : `[表情：未知表情,id=${id}]`,
  ),
  getStickerById: vi.fn(async (id: string) =>
    id === "test_sticker_1"
      ? {
          id: "test_sticker_1",
          name: "测试表情",
          description: "用于测试",
          file: "test.png",
          pack: "测试表情包",
          packDirName: "test-pack",
          packDirPath: "/mock/stickers/test-pack",
          filePath: "/mock/stickers/test-pack/test.png",
        }
      : null,
  ),
  getStickerPack: vi.fn(async (pack: string) =>
    pack === "测试表情包"
      ? {
          pack: "测试表情包",
          dirName: "test-pack",
          dirPath: "/mock/stickers/test-pack",
          packFilePath: "/mock/stickers/test-pack/pack.json",
          stickers: [],
        }
      : null,
  ),
  getStickerInPack: vi.fn(async (pack: string, id: string) =>
    pack === "测试表情包" && id === "test_sticker_1"
      ? {
          id: "test_sticker_1",
          name: "测试表情",
          description: "用于测试",
          file: "test.png",
          pack: "测试表情包",
          packDirName: "test-pack",
          packDirPath: "/mock/stickers/test-pack",
          filePath: "/mock/stickers/test-pack/test.png",
        }
      : null,
  ),
}));

vi.mock("../utils", () => ({
  createCollectedSticker: vi.fn(),
  stickerPackIdToInlineData: vi.fn().mockResolvedValue({
    type: "inline_data",
    mimeType: "image/png",
    data: "ZmFrZV9zdGlja2Vy",
  }),
  updateStickerMetadata: vi.fn(),
}));

import StickerSkill from "..";

describe("StickerSkill", () => {
  test("preview returns readable content and inline image data", async () => {
    const skill = new StickerSkill("packages/ema/src/skills", "sticker-skill");

    const result = await skill.execute({
      action: "preview",
      pack: "测试表情包",
      id: "test_sticker_1",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe(
      "[表情：测试表情包/测试表情,id=test_sticker_1]",
    );
    expect(result.parts).toEqual([
      expect.objectContaining({
        type: "inline_data",
        mimeType: "image/png",
      }),
    ]);
    expect(result.parts?.[0]?.data.length).toBeGreaterThan(0);
  });

  test("preview rejects unknown sticker ids", async () => {
    const skill = new StickerSkill("packages/ema/src/skills", "sticker-skill");

    const result = await skill.execute({
      action: "preview",
      pack: "测试表情包",
      id: "missing_sticker",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("does not exist");
  });
});
