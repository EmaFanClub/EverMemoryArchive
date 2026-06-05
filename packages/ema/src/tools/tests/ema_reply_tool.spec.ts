import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ActorStickerStore } from "../../stickers";
import { ActorWorkspaceService } from "../../workspace/actor_workspace";
import { EmaReplyTool } from "../ema_reply_tool";
import type { ToolContext } from "../base";

const TEST_IMAGE = Buffer.from("fake-sticker");

describe("EmaReplyTool", () => {
  let tool: EmaReplyTool;
  let workspaceDir: string;
  let workspace: ActorWorkspaceService;
  let stickerStore: ActorStickerStore;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ema-reply-"));
    workspace = new ActorWorkspaceService({ workspaceDir });
    stickerStore = new ActorStickerStore({ workspace });
    await stickerStore.ensureActorStickerPacks(1);
    await stickerStore.ensureActorStickerPacks(2);
    await stickerStore.createCollectedSticker(1, "wave", "挥手", "打招呼", {
      type: "inline_data",
      mimeType: "image/png",
      data: TEST_IMAGE.toString("base64"),
    });
    await stickerStore.createCollectedSticker(
      2,
      "actor_two_only",
      "二号专属",
      "只在二号可用",
      {
        type: "inline_data",
        mimeType: "image/png",
        data: TEST_IMAGE.toString("base64"),
      },
    );
    tool = new EmaReplyTool(workspace, stickerStore);
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("should have correct name and description", () => {
    expect(tool.name).toBe("ema_reply");
    expect(tool.description).toContain("唯一方式");
    expect(tool.description).toContain("避免用文字过度解释");
    expect(tool.description).toContain("sticker-skill");
    expect(tool.description).toContain("不要把下一条消息写成普通文本");
    expect(tool.description).toContain("普通文本不会发送给对方");
  });

  it("should expose required parameters schema", () => {
    const params = tool.parameters;
    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("kind");
    expect(params.properties).toHaveProperty("think");
    expect(params.properties).toHaveProperty("content");
    expect(params.required).toContain("kind");
    expect(params.required).not.toContain("think");
    expect(params.required).toContain("content");
  });

  it("should execute successfully with valid inputs", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "我应该回复用户",
      content: "  你好，很高兴见到你  ",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBeTruthy();

    const parsed = JSON.parse(result.content as string);
    expect(parsed.kind).toBe("text");
    expect(parsed.think).toBe("我应该回复用户");
    expect(parsed.content).toBe("  你好，很高兴见到你  ");
  });

  it("normalizes think into one line", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "先看情况\\n再回复\n如果不确定\r\n就短问一句",
      content: "第一行\\n第二行",
    });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content as string);
    expect(parsed.think).toBe("先看情况 再回复 如果不确定 就短问一句");
    expect(parsed.content).toBe("第一行\n第二行");
  });

  it("rejects think that becomes empty after normalization", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "\\n\n\r\n",
      content: "回复",
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("think must not be empty");
  });

  it("accepts text replies without think", async () => {
    const result = await tool.execute({
      kind: "text",
      content: "回复",
    });

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content as string)).toEqual({
      kind: "text",
      content: "回复",
    });
  });

  it("accepts empty reply text", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "先不说话",
      content: "",
    });

    expect(result.success).toBe(true);
  });

  it("accepts sticker replies with valid sticker ids", async () => {
    const result = await tool.execute(
      {
        kind: "sticker",
        think: "发个比心更贴切",
        content: "wave",
      },
      { actorId: 1 },
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content as string)).toMatchObject({
      kind: "sticker",
      content: "wave",
    });
  });

  it("rejects sticker replies without actor context", async () => {
    const result = await tool.execute({
      kind: "sticker",
      think: "试试看",
      content: "wave",
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("actorId");
  });

  it("rejects unknown sticker ids", async () => {
    const result = await tool.execute(
      {
        kind: "sticker",
        think: "试试看",
        content: "missing_sticker",
      },
      { actorId: 1 },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("Unknown sticker id");
  });

  it("rejects stickers that only exist for another actor", async () => {
    const result = await tool.execute(
      {
        kind: "sticker",
        think: "试试看",
        content: "actor_two_only",
      },
      { actorId: 1 },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("Unknown sticker id");
  });

  it("accepts image replies from the actor workspace", async () => {
    await workspace.writeBinaryFile(1, "images/cat.png", Buffer.from("image"));
    const context: ToolContext = {
      actorId: 1,
      server: {} as ToolContext["server"],
    };

    const result = await tool.execute(
      {
        kind: "image",
        think: "这张图能直接回应对方的问题",
        content: "/images/cat.png",
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content as string)).toMatchObject({
      kind: "image",
      think: "这张图能直接回应对方的问题",
      content: "images/cat.png",
    });
  });

  it("rejects caption because follow-up text should use another text reply", async () => {
    await workspace.writeBinaryFile(1, "images/cat.png", Buffer.from("image"));

    const result = await tool.execute(
      {
        kind: "image",
        content: "images/cat.png",
        caption: "看这个",
      },
      {
        actorId: 1,
        server: {} as ToolContext["server"],
      },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("Invalid structured reply");
  });

  it("rejects image replies without actor context", async () => {
    const result = await tool.execute({
      kind: "image",
      content: "images/cat.png",
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("actorId");
  });

  it("rejects non-image workspace paths for image replies", async () => {
    await workspace.writeFile(1, "notes/cat.txt", {
      mode: "overwrite",
      content: "not an image",
    });

    const result = await tool.execute(
      {
        kind: "image",
        content: "notes/cat.txt",
      },
      {
        actorId: 1,
        server: {} as ToolContext["server"],
      },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("image");
  });

  it("rejects empty think when provided", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "",
      content: "回复",
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("Invalid structured reply");
  });
});
