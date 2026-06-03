import { beforeEach, describe, expect, test, vi } from "vitest";

const { actorLogger } = vi.hoisted(() => ({
  actorLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../shared/logger", () => ({
  Logger: class Logger {
    static create() {
      return actorLogger;
    }
  },
}));

import { buildSession } from "../../channel";
import type { ConversationMessageEntity } from "../../db";
import { Actor } from "../actor";
import type { ActorChatInput, ActorSystemInput } from "../base";

function createChatInput(
  conversationId: number,
  msgId: number,
  text: string,
  options: Partial<Pick<ActorChatInput, "replyTo">> = {},
): ActorChatInput {
  return {
    kind: "chat",
    conversationId,
    msgId,
    speaker: {
      session: buildSession("qq", "group", "1000"),
      uid: "user-1",
      name: "alice",
    },
    channelMessageId: `channel-${msgId}`,
    inputs: [{ type: "text", text }],
    time: 1000 + msgId,
    ...options,
  };
}

function createActorForSession(
  session: string,
  messages: ConversationMessageEntity[] = [],
) {
  const server = {
    dbService: {
      conversationDB: {
        getConversation: vi.fn(async (conversationId: number) => ({
          id: conversationId,
          actorId: 1,
          session,
        })),
      },
      actorDB: {
        getActor: vi.fn(async () => ({ id: 1, roleId: 2 })),
      },
      roleDB: {
        getRole: vi.fn(async () => ({ id: 2, name: "艾玛" })),
      },
      conversationMessageDB: {
        listConversationMessages: vi.fn(async (req: any) =>
          messages.filter((item) => {
            if (req.conversationId !== item.conversationId) {
              return false;
            }
            if (req.msgIds && !req.msgIds.includes(item.msgId)) {
              return false;
            }
            if (
              req.channelMessageId &&
              req.channelMessageId !== item.channelMessageId
            ) {
              return false;
            }
            return true;
          }),
        ),
      },
    },
    memoryManager: {
      persistChatMessage: vi.fn(async () => undefined),
      addToBuffer: vi.fn(async () => undefined),
    },
  };
  return {
    actor: new (Actor as any)(1, server) as Actor,
    server,
  };
}

describe("Actor group queue routing", () => {
  beforeEach(() => {
    actorLogger.debug.mockClear();
    actorLogger.info.mockClear();
    actorLogger.warn.mockClear();
    actorLogger.error.mockClear();
  });

  test("buffers inactive ordinary group messages without enqueueing them", async () => {
    const conversationId = 7;
    const { actor, server } = createActorForSession(
      buildSession("qq", "group", "1000"),
    );
    const input = createChatInput(conversationId, 1, "大家早");

    await actor.enqueueActorInput(conversationId, input);

    expect(server.memoryManager.persistChatMessage).toHaveBeenCalledWith(input);
    expect(server.memoryManager.addToBuffer).toHaveBeenCalledWith(
      conversationId,
      1,
      false,
      input.time,
    );
    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "inactive",
    );
    expect(actor.sessionManager.tryPop(conversationId, 0)).toBeNull();
  });

  test("activates inactive group conversations for explicit mentions", async () => {
    const conversationId = 7;
    const { actor, server } = createActorForSession(
      buildSession("qq", "group", "1000"),
    );
    const input = createChatInput(conversationId, 1, "@(YOU) 艾玛在吗");

    await actor.enqueueActorInput(conversationId, input);

    expect(server.memoryManager.addToBuffer).not.toHaveBeenCalled();
    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "active",
    );
    expect(actor.sessionManager.tryPop(conversationId, 0)).toEqual(input);
    expect(actorLogger.info).toHaveBeenCalledWith(
      "Group conversation activated",
      {
        conversationId,
        session: buildSession("qq", "group", "1000"),
        reason: "mention",
      },
    );
  });

  test("keeps active group conversations enqueueing ordinary messages", async () => {
    const conversationId = 7;
    const { actor, server } = createActorForSession(
      buildSession("qq", "group", "1000"),
    );
    const mention = createChatInput(conversationId, 1, "@(YOU) 看这里");
    const ordinary = createChatInput(conversationId, 2, "接着说");

    await actor.enqueueActorInput(conversationId, mention);
    await actor.enqueueActorInput(conversationId, ordinary);

    expect(server.memoryManager.addToBuffer).not.toHaveBeenCalled();
    expect(actor.sessionManager.tryPop(conversationId, 0)).toEqual(mention);
    expect(actor.sessionManager.tryPop(conversationId, 1)).toEqual(ordinary);
  });

  test("preserves inactive background messages when a later special message activates", async () => {
    const conversationId = 7;
    const { actor, server } = createActorForSession(
      buildSession("qq", "group", "1000"),
    );
    const firstBackground = createChatInput(conversationId, 1, "背景一");
    const secondBackground = createChatInput(conversationId, 2, "背景二");
    const mention = createChatInput(conversationId, 3, "@(YOU) 艾玛看一下");

    await actor.enqueueActorInput(conversationId, firstBackground);
    await actor.enqueueActorInput(conversationId, secondBackground);
    await actor.enqueueActorInput(conversationId, mention);

    expect(server.memoryManager.addToBuffer).toHaveBeenCalledTimes(2);
    expect(server.memoryManager.addToBuffer).toHaveBeenNthCalledWith(
      1,
      conversationId,
      1,
      false,
      firstBackground.time,
    );
    expect(server.memoryManager.addToBuffer).toHaveBeenNthCalledWith(
      2,
      conversationId,
      2,
      false,
      secondBackground.time,
    );
    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "active",
    );
    expect(actor.sessionManager.tryPop(conversationId, 0)).toEqual(mention);
  });

  test("activates inactive group conversations for replies to actor messages", async () => {
    const conversationId = 7;
    const actorMessage: ConversationMessageEntity = {
      id: 1,
      conversationId,
      actorId: 1,
      msgId: 9,
      buffered: true,
      activityTarget: true,
      message: {
        kind: "actor",
        name: "艾玛",
        contents: [{ type: "text", text: "上一句" }],
      },
      createdAt: 1000,
    };
    const { actor } = createActorForSession(
      buildSession("qq", "group", "1000"),
      [actorMessage],
    );
    const input = createChatInput(conversationId, 10, "回复一下", {
      replyTo: { kind: "msg", msgId: 9 },
    });

    await actor.enqueueActorInput(conversationId, input);

    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "active",
    );
    expect(actor.sessionManager.tryPop(conversationId, 0)).toEqual(input);
    expect(actorLogger.info).toHaveBeenCalledWith(
      "Group conversation activated",
      {
        conversationId,
        session: buildSession("qq", "group", "1000"),
        reason: "reply",
      },
    );
  });

  test("activates inactive group conversations for actor name mentions", async () => {
    const conversationId = 7;
    const { actor } = createActorForSession(
      buildSession("qq", "group", "1000"),
    );
    const input = createChatInput(conversationId, 1, "艾玛来看看");

    await actor.enqueueActorInput(conversationId, input);

    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "active",
    );
    expect(actor.sessionManager.tryPop(conversationId, 0)).toEqual(input);
    expect(actorLogger.info).toHaveBeenCalledWith(
      "Group conversation activated",
      {
        conversationId,
        session: buildSession("qq", "group", "1000"),
        reason: "actor_name",
      },
    );
  });

  test("activates inactive group conversations for system messages", async () => {
    const conversationId = 7;
    const { actor, server } = createActorForSession(
      buildSession("qq", "group", "1000"),
    );
    const input: ActorSystemInput = {
      kind: "system",
      conversationId,
      inputs: [{ type: "text", text: "system" }],
      time: 1000,
    };

    await actor.enqueueActorInput(conversationId, input);

    expect(server.memoryManager.persistChatMessage).not.toHaveBeenCalled();
    expect(server.memoryManager.addToBuffer).not.toHaveBeenCalled();
    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "active",
    );
    expect(actor.sessionManager.tryPop(conversationId, 0)).toEqual(input);
    expect(actorLogger.info).toHaveBeenCalledWith(
      "Group conversation activated",
      {
        conversationId,
        session: buildSession("qq", "group", "1000"),
        reason: "system",
      },
    );
  });

  test("does not apply inactive routing to private conversations", async () => {
    const conversationId = 7;
    const { actor, server } = createActorForSession(
      buildSession("qq", "chat", "1000"),
    );
    const input = createChatInput(conversationId, 1, "你好");

    await actor.enqueueActorInput(conversationId, input);

    expect(server.memoryManager.addToBuffer).not.toHaveBeenCalled();
    expect(actor.sessionManager.tryPop(conversationId, 0)).toEqual(input);
  });
});
