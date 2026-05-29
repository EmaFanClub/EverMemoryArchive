import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ActorWorkspaceService } from "../../workspace/actor_workspace";
import { buildOutboundActorChatResponse } from "../outbound_response";
import type { ActorChatResponse } from "../base";

describe("buildOutboundActorChatResponse", () => {
  let workspaceDir: string;
  let workspace: ActorWorkspaceService;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ema-outbound-"));
    workspace = new ActorWorkspaceService({ workspaceDir });
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
