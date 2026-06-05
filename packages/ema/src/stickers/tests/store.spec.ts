import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ActorWorkspaceService } from "../../workspace";
import { buildEmaPack } from "../emapack";
import { ActorStickerStore } from "../store";

const TEST_IMAGE = Buffer.from("fake-image");

describe("ActorStickerStore", () => {
  let workspaceDir: string;
  let workspace: ActorWorkspaceService;
  let store: ActorStickerStore;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ema-stickers-"));
    workspace = new ActorWorkspaceService({ workspaceDir });
    store = new ActorStickerStore({ workspace });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test("initializes only an empty collection sticker pack", async () => {
    await store.ensureActorStickerPacks(1);

    const packs = await store.listStickerPacks(1);

    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      dirName: "收藏",
      pack: "收藏",
      stickers: [],
    });
    await expect(
      fs.access(
        path.join(
          workspaceDir,
          "actor_1",
          "stickers",
          ".default-packs-installed",
        ),
      ),
    ).rejects.toThrow();
  });

  test("keeps actors isolated even when sticker ids match", async () => {
    await store.createCollectedSticker(1, "shared", "一号", "一号表情", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });
    await store.createCollectedSticker(2, "shared", "二号", "二号表情", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });

    await store.updateStickerMetadata(
      1,
      "收藏",
      "shared",
      "角色一",
      "只改角色一",
    );

    await expect(store.getStickerById(1, "shared")).resolves.toMatchObject({
      id: "shared",
      name: "角色一",
      description: "只改角色一",
    });
    await expect(store.getStickerById(2, "shared")).resolves.toMatchObject({
      id: "shared",
      name: "二号",
      description: "二号表情",
    });
  });

  test("rejects duplicate sticker ids within one actor", async () => {
    await store.createCollectedSticker(1, "wave", "挥手", "收藏表情", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });
    await writePack(
      path.join(workspaceDir, "actor_1", "stickers"),
      "duplicate-pack",
      "重复包",
      [
        {
          id: "wave",
          name: "重复",
          description: "重复 id",
          file: "duplicate.png",
        },
      ],
    );

    await expect(store.listStickerPacks(1)).rejects.toThrow(
      /Duplicate sticker id 'wave'/,
    );
  });

  test("rejects unsafe sticker file paths from pack.json", async () => {
    const stickerRoot = workspace.getActorStickerRoot(1);
    await fs.mkdir(path.join(stickerRoot, "bad-pack"), { recursive: true });
    await fs.writeFile(
      path.join(stickerRoot, "bad-pack", "pack.json"),
      JSON.stringify(
        {
          pack: "坏包",
          stickers: [
            {
              id: "escape",
              name: "逃逸",
              description: "不应该允许",
              file: "../secret.png",
            },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    await expect(store.listStickerPacks(1)).rejects.toThrow(
      /safe path segment/,
    );
  });

  test("rejects symlink sticker files", async () => {
    const stickerRoot = workspace.getActorStickerRoot(1);
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "ema-sticker-out-"),
    );
    await fs.mkdir(path.join(stickerRoot, "bad-pack"), { recursive: true });
    await fs.writeFile(path.join(outside, "secret.png"), "secret");
    await fs.symlink(
      path.join(outside, "secret.png"),
      path.join(stickerRoot, "bad-pack", "link.png"),
    );
    await fs.writeFile(
      path.join(stickerRoot, "bad-pack", "pack.json"),
      JSON.stringify(
        {
          pack: "坏包",
          stickers: [
            {
              id: "link",
              name: "链接",
              description: "不应该允许",
              file: "link.png",
            },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    try {
      await expect(store.listStickerPacks(1)).rejects.toThrow(/symlink/i);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  test("creates collected stickers in the current actor only", async () => {
    await store.ensureActorStickerPacks(2);

    await store.createCollectedSticker(
      1,
      "collected",
      "收藏图",
      "当前角色收藏",
      {
        type: "inline_data",
        mimeType: "image/png",
        data: TEST_IMAGE.toString("base64"),
      },
    );

    await expect(store.getStickerById(1, "collected")).resolves.toMatchObject({
      pack: "收藏",
      id: "collected",
      name: "收藏图",
    });
    await expect(store.getStickerById(2, "collected")).resolves.toBeNull();
    await expect(
      fs.readFile(
        path.join(workspaceDir, "actor_1", "stickers", "收藏", "collected.png"),
      ),
    ).resolves.toEqual(TEST_IMAGE);
  });

  test("does not lose collected stickers during collection initialization", async () => {
    const create = store.createCollectedSticker(
      1,
      "collected",
      "收藏图",
      "并发收藏",
      {
        type: "inline_data",
        mimeType: "image/png",
        data: TEST_IMAGE.toString("base64"),
      },
    );

    await Promise.all([create, store.ensureActorStickerPacks(1)]);

    const collection = await store.getStickerPack(1, "收藏");

    expect(collection?.stickers).toHaveLength(1);
    await expect(store.getStickerById(1, "collected")).resolves.toMatchObject({
      id: "collected",
      name: "收藏图",
    });
  });

  test("file tool listing does not expose the sticker directory", async () => {
    await store.ensureActorStickerPacks(1);
    await workspace.writeFile(1, "note.txt", {
      mode: "overwrite",
      content: "visible",
    });

    const result = await workspace.listFiles(1, ".");

    expect(result.entries.map((entry) => entry.path)).toEqual(["note.txt"]);
  });

  test("converts stickers to file paths, base64, inline data, and display text", async () => {
    await store.createCollectedSticker(1, "wave", "挥手", "打招呼", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });

    await expect(store.resolveStickerFilePath(1, "wave")).resolves.toBe(
      path.join(workspaceDir, "actor_1", "stickers", "收藏", "wave.png"),
    );
    await expect(store.stickerIdToBase64(1, "wave")).resolves.toBe(
      TEST_IMAGE.toString("base64"),
    );
    await expect(store.stickerIdToInlineData(1, "wave")).resolves.toEqual({
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });
    await expect(store.formatStickerDisplayText(1, "wave")).resolves.toBe(
      "[表情：收藏/挥手,id=wave]",
    );
  });

  test("updates sticker id, name, and description in one actor", async () => {
    await store.createCollectedSticker(1, "wave", "挥手", "打招呼", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });

    await expect(
      store.updateSticker(1, "收藏", "wave", "hello", "问候", "新的说明"),
    ).resolves.toMatchObject({
      sticker: {
        id: "hello",
        name: "问候",
        description: "新的说明",
      },
    });

    await expect(store.getStickerById(1, "wave")).resolves.toBeNull();
    await expect(store.getStickerById(1, "hello")).resolves.toMatchObject({
      id: "hello",
      file: "wave.png",
      name: "问候",
      description: "新的说明",
    });
    await expect(store.resolveStickerFilePath(1, "hello")).resolves.toBe(
      path.join(workspaceDir, "actor_1", "stickers", "收藏", "wave.png"),
    );
  });

  test("rejects sticker id conflicts across packs in one actor", async () => {
    await store.createCollectedSticker(1, "wave", "挥手", "打招呼", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });
    await writePack(
      path.join(workspaceDir, "actor_1", "stickers"),
      "custom-pack",
      "自定义包",
      [
        {
          id: "taken",
          name: "已占用",
          description: "另一个表情",
          file: "taken.png",
        },
      ],
    );

    await expect(
      store.updateSticker(1, "收藏", "wave", "taken", "冲突", "冲突说明"),
    ).rejects.toThrow(/already exists/);
  });

  test("rejects sticker ids outside letters numbers and underscores", async () => {
    await expect(
      store.createCollectedSticker(1, "bad-id", "非法", "非法 id", {
        type: "inline_data",
        mimeType: "image/png",
        data: TEST_IMAGE.toString("base64"),
      }),
    ).rejects.toThrow(/letters, numbers, and underscores/);

    await store.createCollectedSticker(1, "wave", "挥手", "打招呼", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });
    await expect(
      store.updateSticker(1, "收藏", "wave", "bad-id", "非法", "非法 id"),
    ).rejects.toThrow(/letters, numbers, and underscores/);
  });

  test("rejects sticker ids outside letters numbers and underscores from pack json", async () => {
    await writePack(
      path.join(workspaceDir, "actor_1", "stickers"),
      "bad-pack",
      "坏包",
      [
        {
          id: "bad-id",
          name: "非法",
          description: "非法 id",
          file: "bad.png",
        },
      ],
    );

    await expect(store.listStickerPacks(1)).rejects.toThrow(
      /letters, numbers, and underscores/,
    );
  });

  test("creates empty custom sticker packs", async () => {
    await expect(store.createStickerPack(1, "自定义包")).resolves.toMatchObject(
      {
        pack: {
          dirName: "自定义包",
          pack: "自定义包",
          stickers: [],
        },
      },
    );

    await expect(store.getStickerPack(1, "自定义包")).resolves.toMatchObject({
      dirName: "自定义包",
      stickers: [],
    });
    await expect(
      fs.readFile(
        path.join(workspaceDir, "actor_1", "stickers", "自定义包", "pack.json"),
        "utf-8",
      ),
    ).resolves.toContain('"stickers": []');
  });

  test("rejects duplicate custom sticker pack names", async () => {
    await store.createStickerPack(1, "自定义包");

    await expect(store.createStickerPack(1, "自定义包")).rejects.toThrow(
      /already used/,
    );
    await expect(store.createStickerPack(1, "收藏")).rejects.toThrow(
      /already used/,
    );
  });

  test("adds image stickers to collection and custom packs", async () => {
    await store.createStickerPack(1, "自定义包");

    await expect(
      store.createSticker(1, "自定义包", "custom", "自定义图", "自定义表情", {
        type: "inline_data",
        mimeType: "image/png",
        data: TEST_IMAGE.toString("base64"),
      }),
    ).resolves.toMatchObject({
      pack: {
        dirName: "自定义包",
        stickers: [
          {
            id: "custom",
            name: "自定义图",
            description: "自定义表情",
            file: "custom.png",
          },
        ],
      },
      sticker: {
        id: "custom",
      },
    });
    await expect(
      store.createSticker(1, "收藏", "saved", "收藏图", "收藏表情", {
        type: "inline_data",
        mimeType: "image/png",
        data: TEST_IMAGE.toString("base64"),
      }),
    ).resolves.toMatchObject({
      pack: {
        dirName: "收藏",
      },
      sticker: {
        id: "saved",
      },
    });

    await expect(store.getStickerById(1, "custom")).resolves.toMatchObject({
      pack: "自定义包",
    });
    await expect(store.getStickerById(1, "saved")).resolves.toMatchObject({
      pack: "收藏",
    });
  });

  test("rejects added sticker id conflicts across packs", async () => {
    await store.createStickerPack(1, "自定义包");
    await store.createCollectedSticker(1, "wave", "挥手", "收藏表情", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });

    await expect(
      store.createSticker(1, "自定义包", "wave", "冲突", "重复 id", {
        type: "inline_data",
        mimeType: "image/png",
        data: TEST_IMAGE.toString("base64"),
      }),
    ).rejects.toThrow(/already exists/);
  });

  test("deletes a sticker item from collection pack", async () => {
    await store.createCollectedSticker(1, "wave", "挥手", "打招呼", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });
    const filePath = path.join(
      workspaceDir,
      "actor_1",
      "stickers",
      "收藏",
      "wave.png",
    );

    await expect(store.deleteSticker(1, "收藏", "wave")).resolves.toMatchObject(
      {
        deleted: true,
        pack: {
          dirName: "收藏",
          stickers: [],
        },
      },
    );

    await expect(store.getStickerById(1, "wave")).resolves.toBeNull();
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  test("deletes one actor sticker pack without affecting another actor", async () => {
    await store.ensureActorStickerPacks(1);
    await store.ensureActorStickerPacks(2);
    await writePack(
      path.join(workspaceDir, "actor_1", "stickers"),
      "custom-pack",
      "自定义包",
      [
        {
          id: "actor_one",
          name: "一号",
          description: "一号表情",
          file: "one.png",
        },
      ],
    );
    await writePack(
      path.join(workspaceDir, "actor_2", "stickers"),
      "custom-pack",
      "自定义包",
      [
        {
          id: "actor_two",
          name: "二号",
          description: "二号表情",
          file: "two.png",
        },
      ],
    );

    await expect(store.deleteStickerPack(1, "custom-pack")).resolves.toEqual({
      deleted: true,
    });

    await expect(store.getStickerPack(1, "自定义包")).resolves.toBeNull();
    await expect(store.getStickerPack(2, "自定义包")).resolves.toMatchObject({
      pack: "自定义包",
    });
  });

  test("rejects deleting the system collection pack", async () => {
    await store.ensureActorStickerPacks(1);

    await expect(store.deleteStickerPack(1, "收藏")).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(store.getStickerPack(1, "收藏")).resolves.toMatchObject({
      pack: "收藏",
      stickers: [],
    });
  });

  test("renames a custom sticker pack without moving its directory", async () => {
    await store.ensureActorStickerPacks(1);
    await writePack(
      path.join(workspaceDir, "actor_1", "stickers"),
      "custom-pack",
      "自定义包",
      [
        {
          id: "wave",
          name: "挥手",
          description: "打招呼",
          file: "wave.png",
        },
      ],
    );

    await expect(
      store.updateStickerPackName(1, "custom-pack", "新表情包"),
    ).resolves.toMatchObject({
      pack: {
        dirName: "custom-pack",
        pack: "新表情包",
      },
    });

    await expect(store.getStickerPack(1, "新表情包")).resolves.toMatchObject({
      dirName: "custom-pack",
      stickers: [
        {
          id: "wave",
          file: "wave.png",
        },
      ],
    });
    await expect(
      fs.access(
        path.join(
          workspaceDir,
          "actor_1",
          "stickers",
          "custom-pack",
          "wave.png",
        ),
      ),
    ).resolves.toBeUndefined();
  });

  test("rejects renaming the system collection pack", async () => {
    await store.ensureActorStickerPacks(1);

    await expect(
      store.updateStickerPackName(1, "收藏", "新收藏"),
    ).rejects.toThrow(/cannot be renamed/);
  });

  test("rejects empty and duplicate sticker pack names", async () => {
    await store.ensureActorStickerPacks(1);
    await writePack(
      path.join(workspaceDir, "actor_1", "stickers"),
      "first-pack",
      "第一个包",
      [],
    );
    await writePack(
      path.join(workspaceDir, "actor_1", "stickers"),
      "second-pack",
      "第二个包",
      [],
    );

    await expect(
      store.updateStickerPackName(1, "first-pack", " "),
    ).rejects.toThrow(/non-empty string/);
    await expect(
      store.updateStickerPackName(1, "first-pack", "第二个包"),
    ).rejects.toThrow(/already used/);
  });

  test("exports a pack and imports it into another actor", async () => {
    await store.ensureActorStickerPacks(1);
    await writePack(
      path.join(workspaceDir, "actor_1", "stickers"),
      "custom-pack",
      "自定义包",
      [
        {
          id: "wave",
          name: "挥手",
          description: "打招呼",
          file: "wave.png",
        },
      ],
    );

    const exported = await store.exportStickerPack(1, "custom-pack");
    const imported = await store.importStickerPack(2, {
      fileName: exported.fileName,
      buffer: exported.buffer,
    });

    expect(exported.fileName).toBe("自定义包.emapack");
    expect(imported.pack).toMatchObject({
      dirName: "自定义包",
      pack: "自定义包",
      stickers: [
        {
          id: "wave",
          name: "挥手",
          description: "打招呼",
          file: "wave.png",
        },
      ],
    });
    await expect(store.getStickerById(2, "wave")).resolves.toMatchObject({
      id: "wave",
      pack: "自定义包",
    });
  });

  test("imports exported collection backups into the system collection pack", async () => {
    await store.createCollectedSticker(1, "wave", "挥手", "收藏表情", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });

    const exported = await store.exportStickerPack(1, "收藏");
    const imported = await store.importStickerPack(2, {
      fileName: exported.fileName,
      buffer: exported.buffer,
    });

    expect(imported.pack).toMatchObject({
      dirName: "收藏",
      pack: "收藏",
      stickers: [
        {
          id: "wave",
          name: "挥手",
          description: "收藏表情",
          file: "wave.png",
        },
      ],
    });
    await expect(store.getStickerPack(2, "收藏")).resolves.toMatchObject({
      dirName: "收藏",
      stickers: [
        {
          id: "wave",
          name: "挥手",
          description: "收藏表情",
          file: "wave.png",
        },
      ],
    });
  });

  test("rejects collection backup imports whose sticker ids already exist", async () => {
    await store.createCollectedSticker(1, "wave", "挥手", "已有表情", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });
    const archive = await buildEmaPack({
      pack: { name: "收藏" },
      stickers: [
        {
          id: "wave",
          name: "冲突",
          description: "重复 id",
          file: "stickers/wave.png",
          data: TEST_IMAGE,
        },
      ],
    });

    await expect(
      store.importStickerPack(1, {
        fileName: "collection.emapack",
        buffer: archive,
      }),
    ).rejects.toThrow(/wave.*already exists/);
  });

  test("does not list leftover import temp directories as packs", async () => {
    await store.ensureActorStickerPacks(1);
    const stickerRoot = workspace.getActorStickerRoot(1);
    const tempDir = path.join(stickerRoot, ".import-custom-pack-leftover");
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "pack.json"),
      JSON.stringify(
        {
          pack: "临时包",
          stickers: [],
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    await expect(store.listStickerPacks(1)).resolves.toEqual([
      expect.objectContaining({
        dirName: "收藏",
        pack: "收藏",
      }),
    ]);
  });

  test("rejects importing sticker ids that already exist in the actor", async () => {
    await store.createCollectedSticker(1, "wave", "挥手", "已有表情", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });
    const archive = await buildEmaPack({
      pack: { name: "导入包" },
      stickers: [
        {
          id: "wave",
          name: "冲突",
          description: "重复 id",
          file: "stickers/wave.png",
          data: TEST_IMAGE,
        },
      ],
    });

    await expect(
      store.importStickerPack(1, {
        fileName: "conflict.emapack",
        buffer: archive,
      }),
    ).rejects.toThrow(/wave.*already exists/);
  });

  test("adds suffixes when importing a pack with an existing name", async () => {
    await store.ensureActorStickerPacks(1);
    await writePack(
      path.join(workspaceDir, "actor_1", "stickers"),
      "自定义包",
      "自定义包",
      [
        {
          id: "existing",
          name: "已有",
          description: "已有表情",
          file: "existing.png",
        },
      ],
    );
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

    const result = await store.importStickerPack(1, {
      fileName: "custom.emapack",
      buffer: archive,
    });

    expect(result.pack).toMatchObject({
      dirName: "自定义包-2",
      pack: "自定义包 (2)",
    });
    await expect(
      fs.readFile(
        path.join(
          workspaceDir,
          "actor_1",
          "stickers",
          "自定义包-2",
          "wave.png",
        ),
      ),
    ).resolves.toEqual(TEST_IMAGE);
  });
});

async function writePack(
  root: string,
  dirName: string,
  pack: string,
  stickers: Array<{
    id: string;
    name: string;
    description: string;
    file: string;
  }>,
): Promise<void> {
  const dirPath = path.join(root, dirName);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(
    path.join(dirPath, "pack.json"),
    JSON.stringify({ pack, stickers }, null, 2) + "\n",
    "utf-8",
  );
  for (const sticker of stickers) {
    await fs.writeFile(path.join(dirPath, sticker.file), TEST_IMAGE);
  }
}
