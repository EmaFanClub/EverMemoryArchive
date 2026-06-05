import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ensureEmaServer = vi.hoisted(() => vi.fn());

vi.mock("../ema-server", () => ({
  ensureEmaServer,
}));

import { createBootstrapConfig, GlobalConfig } from "ema";
import { buildEmaPack } from "ema";
import {
  actorStickerHttpStatus,
  buildActorStickerListResponse,
  createActorStickerPackService,
  createActorStickerService,
  deleteActorStickerPackService,
  deleteActorStickerService,
  exportActorStickerPackService,
  getActorStickerPreviewService,
  importActorStickerPackService,
  updateActorStickerPackService,
  updateActorStickerService,
} from "./actor-stickers";

const TEST_IMAGE = Buffer.from("fake-sticker");

describe("actor sticker service", () => {
  let dataRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ema-web-stickers-"));
    GlobalConfig.resetForTests();
    await GlobalConfig.load(undefined, {
      bootstrap: createBootstrapConfig({
        mode: "dev",
        mongoKind: "memory",
        dataRoot,
      }),
    });
    ensureEmaServer.mockResolvedValue({
      dbService: {
        actorDB: {
          getActor: vi.fn(async (id: number) => ({ id })),
        },
      },
    });
  });

  afterEach(async () => {
    await fs.rm(dataRoot, { recursive: true, force: true });
    GlobalConfig.resetForTests();
  });

  test("lists only the empty collection pack after actor initialization", async () => {
    const response = await buildActorStickerListResponse("1");

    expect(response.ok).toBe(true);
    expect(response.packs).toHaveLength(1);
    expect(response.packs[0]).toMatchObject({
      dirName: "收藏",
      name: "收藏",
      stickerCount: 0,
      stickers: [],
    });
    expect(response).not.toHaveProperty("installableDefaultPacks");
  });

  test("lists stickers with preview urls instead of inline preview data", async () => {
    await buildActorStickerListResponse("1");
    await writeActorPack(1, "custom-pack", "自定义包", [
      {
        id: "wave",
        name: "挥手",
        description: "打招呼",
        file: "wave.png",
      },
    ]);

    const response = await buildActorStickerListResponse("1");
    const pack = response.packs.find((item) => item.dirName === "custom-pack");

    expect(pack?.stickers[0]).toMatchObject({
      id: "wave",
      previewUrl:
        "/api/v1beta1/actors/1/stickers/custom-pack/items/wave/preview",
    });
    expect(pack?.stickers[0]).not.toHaveProperty("previewDataUrl");
  });

  test("does not expose local paths in sticker list errors", async () => {
    await buildActorStickerListResponse("1");
    const badPackDir = path.join(
      GlobalConfig.paths.workspaceDir,
      "actor_1",
      "stickers",
      "bad-pack",
    );
    await fs.mkdir(badPackDir, { recursive: true });
    await fs.writeFile(
      path.join(badPackDir, "pack.json"),
      JSON.stringify({ stickers: [] }, null, 2) + "\n",
      "utf-8",
    );

    const response = await buildActorStickerListResponse("1");

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_CONFIG",
      },
    });
    expect(response.error?.message).not.toContain(
      GlobalConfig.paths.workspaceDir,
    );
    expect(response.error?.message).toContain("<local>");
  });

  test("deletes custom packs only for the selected actor", async () => {
    await buildActorStickerListResponse("1");
    await buildActorStickerListResponse("2");
    await writeActorPack(1, "custom-pack", "自定义包", [
      {
        id: "actor_one",
        name: "一号",
        description: "一号表情",
        file: "one.png",
      },
    ]);
    await writeActorPack(2, "custom-pack", "自定义包", [
      {
        id: "actor_two",
        name: "二号",
        description: "二号表情",
        file: "two.png",
      },
    ]);

    await expect(
      deleteActorStickerPackService("1", "custom-pack"),
    ).resolves.toMatchObject({
      ok: true,
      packDirName: "custom-pack",
    });

    const actorOneAfterDelete = await buildActorStickerListResponse("1");
    expect(
      actorOneAfterDelete.packs.some((pack) => pack.dirName === "custom-pack"),
    ).toBe(false);
    const actorTwoAfterDelete = await buildActorStickerListResponse("2");
    expect(
      actorTwoAfterDelete.packs.some((pack) => pack.dirName === "custom-pack"),
    ).toBe(true);
  });

  test("rejects deleting the system collection pack", async () => {
    const response = await deleteActorStickerPackService("1", "收藏");

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_CONFIG",
      },
    });
    expect(actorStickerHttpStatus(response)).toBe(400);
  });

  test("renames a custom pack without changing its directory", async () => {
    await buildActorStickerListResponse("1");
    await writeActorPack(1, "custom-pack", "自定义包", [
      {
        id: "wave",
        name: "挥手",
        description: "打招呼",
        file: "wave.png",
      },
    ]);

    const response = await updateActorStickerPackService("1", "custom-pack", {
      name: "新表情包",
    });

    expect(response).toMatchObject({
      ok: true,
      packDirName: "custom-pack",
      pack: {
        dirName: "custom-pack",
        name: "新表情包",
      },
    });
    const list = await buildActorStickerListResponse("1");
    expect(
      list.packs.find((pack) => pack.dirName === "custom-pack"),
    ).toMatchObject({
      name: "新表情包",
    });
  });

  test("rejects protected collection pack rename as invalid config", async () => {
    const response = await updateActorStickerPackService("1", "收藏", {
      name: "新收藏",
    });

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_CONFIG",
      },
    });
    expect(actorStickerHttpStatus(response)).toBe(400);
  });

  test("creates an empty custom sticker pack", async () => {
    const response = await createActorStickerPackService("1", {
      name: "自定义包",
    });

    expect(response).toMatchObject({
      ok: true,
      packDirName: "自定义包",
      pack: {
        dirName: "自定义包",
        name: "自定义包",
        stickerCount: 0,
        stickers: [],
      },
    });
  });

  test("rejects duplicate custom sticker pack creation", async () => {
    await createActorStickerPackService("1", { name: "自定义包" });

    const response = await createActorStickerPackService("1", {
      name: "自定义包",
    });

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_CONFIG",
      },
    });
    expect(actorStickerHttpStatus(response)).toBe(400);
  });

  test("updates sticker id and metadata in one actor pack", async () => {
    await buildActorStickerListResponse("1");
    await writeActorPack(1, "custom-pack", "自定义包", [
      {
        id: "wave",
        name: "挥手",
        description: "打招呼",
        file: "wave.png",
      },
    ]);

    const response = await updateActorStickerService(
      "1",
      "custom-pack",
      "wave",
      {
        id: "hello",
        name: "新名称",
        description: "新的说明",
      },
    );

    expect(response.ok).toBe(true);
    expect(
      response.pack?.stickers.find((item) => item.id === "hello"),
    ).toMatchObject({
      name: "新名称",
      description: "新的说明",
      file: "wave.png",
    });
  });

  test("keeps conflict status when duplicate id contains invalid keyword", async () => {
    await buildActorStickerListResponse("1");
    await writeActorPack(1, "custom-pack", "自定义包", [
      {
        id: "wave",
        name: "挥手",
        description: "打招呼",
        file: "wave.png",
      },
      {
        id: "invalid_sticker",
        name: "占用",
        description: "已存在",
        file: "invalid.png",
      },
    ]);

    const response = await updateActorStickerService(
      "1",
      "custom-pack",
      "wave",
      {
        id: "invalid_sticker",
        name: "新名称",
        description: "新的说明",
      },
    );

    expect(response.error?.code).toBe("STICKER_ID_CONFLICT");
    expect(actorStickerHttpStatus(response)).toBe(409);
  });

  test("keeps not-found status when missing sticker id contains required keyword", async () => {
    await buildActorStickerListResponse("1");
    await writeActorPack(1, "custom-pack", "自定义包", [
      {
        id: "wave",
        name: "挥手",
        description: "打招呼",
        file: "wave.png",
      },
    ]);

    const response = await updateActorStickerService(
      "1",
      "custom-pack",
      "required_missing",
      {
        id: "required_missing",
        name: "新名称",
        description: "新的说明",
      },
    );

    expect(response.error?.code).toBe("STICKER_NOT_FOUND");
    expect(actorStickerHttpStatus(response)).toBe(404);
  });

  test("deletes one sticker item", async () => {
    await buildActorStickerListResponse("1");
    await writeActorPack(1, "custom-pack", "自定义包", [
      {
        id: "wave",
        name: "挥手",
        description: "打招呼",
        file: "wave.png",
      },
    ]);

    const response = await deleteActorStickerService(
      "1",
      "custom-pack",
      "wave",
    );

    expect(response.ok).toBe(true);
    expect(response.pack?.stickers).toEqual([]);
    await expect(
      fs.access(
        path.join(
          GlobalConfig.paths.workspaceDir,
          "actor_1",
          "stickers",
          "custom-pack",
          "wave.png",
        ),
      ),
    ).rejects.toThrow();
  });

  test("returns sticker preview bytes and content type", async () => {
    await buildActorStickerListResponse("1");
    await writeActorPack(1, "custom-pack", "自定义包", [
      {
        id: "wave",
        name: "挥手",
        description: "打招呼",
        file: "wave.png",
      },
    ]);

    const response = await getActorStickerPreviewService(
      "1",
      "custom-pack",
      "wave",
    );

    expect(response).toMatchObject({
      ok: true,
      contentType: "image/png",
    });
    expect(response.buffer).toEqual(TEST_IMAGE);
  });

  test("returns 404 for missing sticker preview targets", async () => {
    await buildActorStickerListResponse("1");
    await writeActorPack(1, "custom-pack", "自定义包", [
      {
        id: "wave",
        name: "挥手",
        description: "打招呼",
        file: "wave.png",
      },
    ]);

    const missingPack = await getActorStickerPreviewService(
      "1",
      "missing-pack",
      "wave",
    );
    const missingSticker = await getActorStickerPreviewService(
      "1",
      "custom-pack",
      "missing",
    );

    expect(missingPack).toMatchObject({
      ok: false,
      error: {
        code: "STICKER_NOT_FOUND",
      },
    });
    expect(actorStickerHttpStatus(missingPack)).toBe(404);
    expect(missingSticker).toMatchObject({
      ok: false,
      error: {
        code: "STICKER_NOT_FOUND",
      },
    });
    expect(actorStickerHttpStatus(missingSticker)).toBe(404);
  });

  test("adds an image sticker to the collection pack", async () => {
    await buildActorStickerListResponse("1");

    const response = await createActorStickerService("1", "收藏", {
      id: "uploaded",
      name: "上传图",
      description: "上传表情",
      fileName: "uploaded.png",
      contentType: "image/png",
      buffer: TEST_IMAGE,
    });

    expect(response).toMatchObject({
      ok: true,
      packDirName: "收藏",
      pack: {
        dirName: "收藏",
        stickers: [
          {
            id: "uploaded",
            name: "上传图",
            description: "上传表情",
          },
        ],
      },
    });
  });

  test("does not expose local paths when sticker preview loading fails", async () => {
    await buildActorStickerListResponse("1");
    const badPackDir = path.join(
      GlobalConfig.paths.workspaceDir,
      "actor_1",
      "stickers",
      "bad-pack",
    );
    await fs.mkdir(badPackDir, { recursive: true });
    await fs.writeFile(
      path.join(badPackDir, "pack.json"),
      JSON.stringify({ stickers: [] }, null, 2) + "\n",
      "utf-8",
    );

    const response = await getActorStickerPreviewService(
      "1",
      "bad-pack",
      "wave",
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_CONFIG",
        message: "Sticker preview request is invalid.",
      },
    });
    expect(response.error?.message).not.toContain(
      GlobalConfig.paths.workspaceDir,
    );
  });

  test("imports a sticker pack and returns the imported pack", async () => {
    const archive = await buildEmaPack({
      pack: { name: "导入包" },
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

    const response = await importActorStickerPackService("1", {
      fileName: "pack.emapack",
      buffer: archive,
    });

    expect(response.ok).toBe(true);
    expect(response.pack).toMatchObject({
      name: "导入包",
      stickers: [
        {
          id: "wave",
          name: "挥手",
          description: "打招呼",
        },
      ],
    });
  });

  test("maps imported sticker id conflicts to 409 with conflict ids", async () => {
    await buildActorStickerListResponse("1");
    await writeActorPack(1, "custom-pack", "自定义包", [
      {
        id: "wave",
        name: "已有",
        description: "已有表情",
        file: "wave.png",
      },
      {
        id: "smile",
        name: "已有笑脸",
        description: "另一个已有表情",
        file: "smile.png",
      },
    ]);
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
        {
          id: "smile",
          name: "笑脸冲突",
          description: "第二个重复 id",
          file: "stickers/smile.png",
          data: TEST_IMAGE,
        },
      ],
    });

    const response = await importActorStickerPackService("1", {
      fileName: "pack.emapack",
      buffer: archive,
    });

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "STICKER_ID_CONFLICT",
      },
    });
    expect(response.error?.message).toContain("wave");
    expect(response.error?.message).toContain("smile");
    expect(actorStickerHttpStatus(response)).toBe(409);
  });

  test("exports a sticker pack as an emapack buffer", async () => {
    await buildActorStickerListResponse("1");
    await writeActorPack(1, "custom-pack", "自定义包", [
      {
        id: "wave",
        name: "挥手",
        description: "打招呼",
        file: "wave.png",
      },
    ]);

    const response = await exportActorStickerPackService("1", "custom-pack");

    expect(response.ok).toBe(true);
    expect(response.fileName).toBe("自定义包.emapack");
    expect(Buffer.isBuffer(response.buffer)).toBe(true);
  });

  test("rejects empty sticker metadata", async () => {
    const response = await updateActorStickerService(
      "1",
      "custom-pack",
      "wave",
      { id: "", name: "名称", description: "说明" },
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_CONFIG",
      },
    });
  });
});

async function writeActorPack(
  actorId: number,
  dirName: string,
  pack: string,
  stickers: Array<{
    id: string;
    name: string;
    description: string;
    file: string;
  }>,
): Promise<void> {
  const dirPath = path.join(
    GlobalConfig.paths.workspaceDir,
    `actor_${actorId}`,
    "stickers",
    dirName,
  );
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
