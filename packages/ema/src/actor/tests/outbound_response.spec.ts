import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ActorStickerStore } from "../../stickers";
import { ActorWorkspaceService } from "../../workspace/actor_workspace";
import { buildOutboundActorChatResponse } from "../outbound_response";
import type { ActorChatResponse } from "../base";

describe("buildOutboundActorChatResponse", () => {
  let workspaceDir: string;
  let workspace: ActorWorkspaceService;
  let stickerStore: ActorStickerStore;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ema-outbound-"));
    workspace = new ActorWorkspaceService({ workspaceDir });
    stickerStore = new ActorStickerStore({ workspace });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test("converts workspace image reply paths to base64 for channel sending", async () => {
    const image = Buffer.from("fake-image");
    await workspace.writeBinaryFile(1, "images/cat.png", image);
    const response: ActorChatResponse = {
      kind: "chat",
      actorId: 1,
      conversationId: 2,
      msgId: 3,
      session: "qq-chat-12345",
      ema_reply: {
        kind: "image",
        content: "images/cat.png",
      },
      time: 4,
    };

    const outbound = await buildOutboundActorChatResponse(response, {
      workspace,
      logger: { warn: vi.fn() },
    });

    expect(outbound).toMatchObject({
      ...response,
      ema_reply: {
        kind: "image",
        content: image.toString("base64"),
      },
    });
    expect(response.ema_reply.content).toBe("images/cat.png");
  });

  test("converts sticker ids to base64 using the response actor", async () => {
    const actorOneImage = Buffer.from("actor-one-sticker");
    const actorTwoImage = Buffer.from("actor-two-sticker");
    await stickerStore.createCollectedSticker(1, "shared", "一号", "一号表情", {
      type: "inline_data",
      mimeType: "image/png",
      data: actorOneImage.toString("base64"),
    });
    await stickerStore.createCollectedSticker(2, "shared", "二号", "二号表情", {
      type: "inline_data",
      mimeType: "image/png",
      data: actorTwoImage.toString("base64"),
    });
    const response: ActorChatResponse = {
      kind: "chat",
      actorId: 2,
      conversationId: 2,
      msgId: 3,
      session: "qq-chat-12345",
      ema_reply: {
        kind: "sticker",
        content: "shared",
      },
      time: 4,
    };

    const outbound = await buildOutboundActorChatResponse(response, {
      stickerStore,
      logger: { warn: vi.fn() },
    });

    expect(outbound.ema_reply).toMatchObject({
      kind: "sticker",
      content: actorTwoImage.toString("base64"),
    });
  });

  test("falls back to actor-scoped sticker display text when sticker cannot be resolved", async () => {
    const warn = vi.fn();
    await stickerStore.createCollectedSticker(2, "shared", "二号", "二号表情", {
      type: "inline_data",
      mimeType: "image/png",
      data: Buffer.from("actor-two-sticker").toString("base64"),
    });
    await fs.rm(
      path.join(workspaceDir, "actor_2", "stickers", "收藏", "shared.png"),
    );
    const response: ActorChatResponse = {
      kind: "chat",
      actorId: 2,
      conversationId: 2,
      msgId: 3,
      session: "qq-chat-12345",
      ema_reply: {
        kind: "sticker",
        content: "shared",
      },
      time: 4,
    };

    const outbound = await buildOutboundActorChatResponse(response, {
      stickerStore,
      logger: { warn },
    });

    expect(outbound.ema_reply).toMatchObject({
      kind: "text",
      content: "[表情：未知表情,id=shared]",
    });
    expect(warn).toHaveBeenCalled();
  });

  test("falls back to text when workspace image cannot be resolved", async () => {
    const warn = vi.fn();
    const response: ActorChatResponse = {
      kind: "chat",
      actorId: 1,
      conversationId: 2,
      msgId: 3,
      session: "qq-chat-12345",
      ema_reply: {
        kind: "image",
        content: "images/missing.png",
      },
      time: 4,
    };

    const outbound = await buildOutboundActorChatResponse(response, {
      workspace,
      logger: { warn },
    });

    expect(outbound.ema_reply).toMatchObject({
      kind: "text",
      content: "[图片：images/missing.png]",
    });
    expect(warn).toHaveBeenCalled();
  });
});
