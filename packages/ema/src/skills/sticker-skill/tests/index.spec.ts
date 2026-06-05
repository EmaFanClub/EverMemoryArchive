import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ActorStickerStore } from "../../../stickers";
import { ActorWorkspaceService } from "../../../workspace";
import StickerSkill from "..";

const TEST_IMAGE = Buffer.from("fake-sticker");
const skillsRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("StickerSkill", () => {
  let workspaceDir: string;
  let store: ActorStickerStore;
  let skill: StickerSkill;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "ema-sticker-skill-"),
    );
    store = new ActorStickerStore({
      workspace: new ActorWorkspaceService({ workspaceDir }),
    });
    await store.createCollectedSticker(1, "wave", "挥手", "打招呼", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });
    await store.createCollectedSticker(2, "wave", "二号挥手", "只属于二号", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });
    skill = new StickerSkill(skillsRoot, "sticker-skill", store);
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test("playbook frames stickers as a chat response option without actor-specific sticker ids", async () => {
    const playbook = await skill.getPlaybook();

    expect(playbook).toContain("聊天中选择合适表情回应");
    expect(playbook).toContain('exec_skill(sticker-skill, { action: "list" })');
    expect(playbook).not.toContain("id: `wave`");
    expect(playbook).not.toContain("{AVAILABLE_STICKERS}");
  });

  test("list returns the current actor sticker inventory as markdown", async () => {
    const result = await skill.execute({ action: "list" }, { actorId: 2 });

    expect(result.success).toBe(true);
    expect(result.content).toContain("- 收藏");
    expect(result.content).toContain(
      "  - id: `wave`｜名称：二号挥手｜说明：只属于二号",
    );
    expect(result.content).not.toContain("名称：挥手");
  });

  test("list sanitizes store errors before returning them", async () => {
    const badPackDir = path.join(workspaceDir, "actor_1", "stickers", "bad");
    await fs.mkdir(badPackDir, { recursive: true });
    await fs.writeFile(
      path.join(badPackDir, "pack.json"),
      JSON.stringify({ stickers: [] }, null, 2) + "\n",
      "utf-8",
    );

    const result = await skill.execute({ action: "list" }, { actorId: 1 });

    expect(result.success).toBe(false);
    expect(result.content).toContain("[path]");
    expect(result.content).not.toContain(workspaceDir);
  });

  test("list requires actor context", async () => {
    const result = await skill.execute({ action: "list" });

    expect(result.success).toBe(false);
    expect(result.content).toContain("actorId");
  });

  test("preview returns readable content and inline image data from the actor store", async () => {
    const result = await skill.execute(
      {
        action: "preview",
        pack: "收藏",
        id: "wave",
      },
      { actorId: 2 },
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("[表情：收藏/二号挥手,id=wave]");
    expect(result.images).toEqual([
      expect.objectContaining({
        type: "inline_data",
        mimeType: "image/png",
        data: TEST_IMAGE.toString("base64"),
      }),
    ]);
  });

  test("preview rejects missing actor context", async () => {
    const result = await skill.execute({
      action: "preview",
      pack: "收藏",
      id: "wave",
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("actorId");
  });

  test("preview rejects unknown actor-scoped sticker ids", async () => {
    const result = await skill.execute(
      {
        action: "preview",
        pack: "收藏",
        id: "missing_sticker",
      },
      { actorId: 1 },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("does not exist");
  });

  test("update writes metadata only for the current actor", async () => {
    const result = await skill.execute(
      {
        action: "update",
        pack: "收藏",
        id: "wave",
        name: "一号挥手",
        description: "只属于一号",
      },
      { actorId: 1 },
    );

    expect(result.success).toBe(true);
    await expect(store.getStickerById(1, "wave")).resolves.toMatchObject({
      name: "一号挥手",
      description: "只属于一号",
    });
    await expect(store.getStickerById(2, "wave")).resolves.toMatchObject({
      name: "二号挥手",
      description: "只属于二号",
    });
  });

  test("update rejects attempts to rename a sticker id", async () => {
    const result = await skill.execute(
      {
        action: "update",
        pack: "收藏",
        id: "wave",
        next_id: "hello",
        name: "一号挥手",
        description: "只属于一号",
      },
      { actorId: 1 },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("Invalid sticker-skill input");
    await expect(store.getStickerById(1, "wave")).resolves.toMatchObject({
      name: "挥手",
      description: "打招呼",
    });
    await expect(store.getStickerById(1, "hello")).resolves.toBeNull();
  });

  test("create stores collected stickers in the current actor", async () => {
    const rows = [
      {
        message: {
          contents: [
            {
              type: "inline_data",
              mimeType: "image/png",
              data: TEST_IMAGE.toString("base64"),
            },
          ],
        },
      },
    ];
    const result = await skill.execute(
      {
        action: "create",
        id: "collected",
        name: "收藏图",
        description: "当前 actor 收藏",
        msg_id: 9,
        idx: 1,
      },
      {
        actorId: 1,
        conversationId: 7,
        server: {
          dbService: {
            conversationMessageDB: {
              listConversationMessages: async () => rows,
            },
          },
        } as any,
      },
    );

    expect(result.success).toBe(true);
    await expect(store.getStickerById(1, "collected")).resolves.toMatchObject({
      pack: "收藏",
      id: "collected",
      name: "收藏图",
    });
    await expect(store.getStickerById(2, "collected")).resolves.toBeNull();
  });
});
