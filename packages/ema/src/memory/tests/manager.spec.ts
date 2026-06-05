import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MemoryManager } from "../manager";
import { ActorStickerStore } from "../../stickers";
import { ActorWorkspaceService } from "../../workspace/actor_workspace";
import type { ActorChatResponse } from "../../actor";
import type { ConversationMessageEntity } from "../../db";
import { buildSession } from "../../channel";

describe("MemoryManager", () => {
  let workspaceDir: string;
  let workspace: ActorWorkspaceService;
  let stickerStore: ActorStickerStore;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ema-memory-"));
    workspace = new ActorWorkspaceService({ workspaceDir });
    stickerStore = new ActorStickerStore({ workspace });
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
      stickerStore,
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

  test("persists sticker replies using the actor-scoped store", async () => {
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
    const addConversationMessage = vi.fn(async () => undefined);
    const manager = new MemoryManager(
      {
        dbService: {
          conversationDB: {
            getConversation: vi.fn(async () => ({
              id: 7,
              actorId: 2,
              session: "web-chat-owner",
            })),
          },
          actorDB: {
            getActor: vi.fn(async () => ({ id: 2, roleId: 2 })),
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
      stickerStore,
    );
    const response: ActorChatResponse = {
      kind: "chat",
      actorId: 2,
      conversationId: 7,
      msgId: 9,
      session: "web-chat-owner",
      ema_reply: {
        kind: "sticker",
        think: "表情更贴切。",
        content: "shared",
        mention_uids: ["owner"],
      },
      time: 1000,
    };

    await manager.persistChatMessage(response);

    expect(addConversationMessage).toHaveBeenCalledWith({
      conversationId: 7,
      actorId: 2,
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
            data: actorTwoImage.toString("base64"),
            text: "[表情：收藏/二号,id=shared]",
          },
        ],
        think: "表情更贴切。",
      },
      createdAt: 1000,
      msgId: 9,
    });
  });

  test("counts only activity target buffered messages as pending", async () => {
    const records: ConversationMessageEntity[] = [
      {
        id: 4,
        conversationId: 7,
        actorId: 1,
        msgId: 4,
        buffered: true,
        activityTarget: true,
        message: {
          kind: "user",
          uid: "user-1",
          name: "alice",
          contents: [{ type: "text", text: "target" }],
        },
        createdAt: 4000,
      },
      {
        id: 3,
        conversationId: 7,
        actorId: 1,
        msgId: 3,
        buffered: true,
        activityTarget: true,
        activityProcessedAt: 3000,
        message: {
          kind: "user",
          uid: "user-1",
          name: "alice",
          contents: [{ type: "text", text: "processed" }],
        },
        createdAt: 3000,
      },
      {
        id: 2,
        conversationId: 7,
        actorId: 1,
        msgId: 2,
        buffered: true,
        activityTarget: false,
        message: {
          kind: "user",
          uid: "user-1",
          name: "alice",
          contents: [{ type: "text", text: "background" }],
        },
        createdAt: 2000,
      },
      {
        id: 1,
        conversationId: 7,
        actorId: 1,
        msgId: 1,
        buffered: true,
        message: {
          kind: "user",
          uid: "user-1",
          name: "alice",
          contents: [{ type: "text", text: "legacy" }],
        },
        createdAt: 1000,
      },
    ];
    const manager = new MemoryManager(
      {
        dbService: {
          conversationMessageDB: {
            listConversationMessages: vi.fn(async () => records),
          },
        },
      } as any,
      workspace,
    );

    const state = await manager.getPendingConversationWindowState(7, 5000);

    expect(state).toEqual({ count: 2, lastPendingId: 4 });
  });

  test("loads inactive group context in prompts without counting it as pending", async () => {
    const conversationId = 7;
    const records: ConversationMessageEntity[] = [
      {
        id: 1,
        conversationId,
        actorId: 1,
        msgId: 1,
        buffered: true,
        activityTarget: false,
        message: {
          kind: "user",
          uid: "user-1",
          name: "alice",
          contents: [{ type: "text", text: "背景消息 1" }],
        },
        createdAt: 1000,
      },
      {
        id: 2,
        conversationId,
        actorId: 1,
        msgId: 2,
        buffered: true,
        activityTarget: false,
        message: {
          kind: "user",
          uid: "user-2",
          name: "bob",
          contents: [{ type: "text", text: "背景消息 2" }],
        },
        createdAt: 2000,
      },
      {
        id: 3,
        conversationId,
        actorId: 1,
        msgId: 3,
        buffered: true,
        activityTarget: true,
        message: {
          kind: "user",
          uid: "user-3",
          name: "carol",
          contents: [{ type: "text", text: "@(YOU) 艾玛看一下" }],
        },
        createdAt: 3000,
      },
    ];
    const conversation = {
      id: conversationId,
      actorId: 1,
      name: "测试群",
      session: buildSession("qq", "group", "1000"),
      allowProactive: false,
    };
    const loadSystemPrompt = vi.fn(
      async (_name: string, variables: Record<string, string>) =>
        variables.CONVERSATION_WINDOW,
    );
    const manager = new MemoryManager(
      {
        dbService: {
          actorDB: {
            getActor: vi.fn(async () => ({ id: 1, roleId: 2 })),
          },
          roleDB: {
            getRole: vi.fn(async () => ({
              id: 2,
              name: "艾玛",
              prompt: "role prompt",
            })),
          },
          personalityDB: {
            getPersonality: vi.fn(async () => null),
          },
          conversationDB: {
            getConversation: vi.fn(async () => conversation),
            listConversations: vi.fn(async () => [conversation]),
          },
          conversationMessageDB: {
            listConversationMessages: vi.fn(async () => records),
          },
          shortTermMemoryDB: {
            listShortTermMemories: vi.fn(async () => []),
          },
          userOwnActorDB: {
            getActorOwner: vi.fn(async () => null),
          },
          externalIdentityBindingDB: {
            listExternalIdentityBindings: vi.fn(async () => []),
          },
        },
        promptStore: {
          loadSystemPrompt,
        },
      } as any,
      workspace,
    );

    const prompt = await manager.buildSystemPromptForChat(1, conversationId);
    const pending = await manager.getPendingConversationWindowState(
      conversationId,
      4000,
    );

    expect(prompt).toContain("背景消息 1");
    expect(prompt).toContain("背景消息 2");
    expect(prompt).toContain("@(YOU) 艾玛看一下");
    expect(pending).toEqual({ count: 1, lastPendingId: 3 });
    expect(loadSystemPrompt).toHaveBeenCalledWith(
      "foreground",
      expect.objectContaining({
        CONVERSATION_WINDOW: expect.stringContaining("背景消息 1"),
        SESSION_TYPE: "group",
      }),
    );
  });

  test("marks buffered messages with activity target intent", async () => {
    const markConversationMessagesBuffered = vi.fn(async () => 1);
    const listConversationMessages = vi.fn(async () => []);
    const manager = new MemoryManager(
      {
        dbService: {
          conversationMessageDB: {
            markConversationMessagesBuffered,
            listConversationMessages,
          },
        },
      } as any,
      workspace,
    );

    await manager.addToBuffer(7, 9, false, 1000);

    expect(markConversationMessagesBuffered).toHaveBeenCalledWith(
      7,
      [9],
      false,
    );
    expect(listConversationMessages).not.toHaveBeenCalled();

    await manager.addToBuffer(7, 10, true, 2000);

    expect(markConversationMessagesBuffered).toHaveBeenLastCalledWith(
      7,
      [10],
      true,
    );
    expect(listConversationMessages).toHaveBeenCalledTimes(1);
  });
});
