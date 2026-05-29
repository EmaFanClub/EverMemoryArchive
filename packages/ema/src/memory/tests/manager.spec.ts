import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MemoryManager } from "../manager";
import { ActorWorkspaceService } from "../../workspace/actor_workspace";
import type { ActorChatResponse } from "../../actor";

describe("MemoryManager", () => {
  let workspaceDir: string;
  let workspace: ActorWorkspaceService;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ema-memory-"));
    workspace = new ActorWorkspaceService({ workspaceDir });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test("persists image replies as inline data with media text", async () => {
    const image = Buffer.from("fake-image");
    await workspace.writeBinaryFile(1, "images/cat.png", image);
    const addConversationMessage = vi.fn(async () => undefined);
    const manager = new MemoryManager(
      {
        dbService: {
          conversationDB: {
            getConversation: vi.fn(async () => ({
              id: 7,
              actorId: 1,
              session: "web-chat-owner",
            })),
          },
          actorDB: {
            getActor: vi.fn(async () => ({ id: 1, roleId: 2 })),
          },
          roleDB: {
            getRole: vi.fn(async () => ({ id: 2, name: "艾玛" })),
          },
          conversationMessageDB: {
            addConversationMessage,
          },
        },
      } as any,
      workspace,
    );
    const response: ActorChatResponse = {
      kind: "chat",
      actorId: 1,
      conversationId: 7,
      msgId: 9,
      session: "web-chat-owner",
      ema_reply: {
        kind: "image",
        think: "这张图是对刚才问题的直接回应。",
        content: "images/cat.png",
        mention_uids: ["owner"],
      },
      time: 1000,
    };

    await manager.persistChatMessage(response);

    expect(addConversationMessage).toHaveBeenCalledWith({
      conversationId: 7,
      actorId: 1,
      channelMessageId: "7:9",
      buffered: false,
      message: {
        kind: "actor",
        msgId: 9,
        name: "艾玛",
        contents: [
          { type: "text", text: "@(owner)" },
          {
            type: "inline_data",
            mimeType: "image/png",
            data: image.toString("base64"),
            text: "[图片：images/cat.png]",
          },
        ],
        think: "这张图是对刚才问题的直接回应。",
      },
      createdAt: 1000,
      msgId: 9,
    });
  });
});
