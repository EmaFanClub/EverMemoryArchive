import { describe, expect, test, vi } from "vitest";

import { EmaBus } from "../../bus";
import type { ActorEntity, ConversationEntity } from "../../db";
import { ChannelController } from "../channel_controller";

type PersistedActor = ActorEntity & { id: number };
type PersistedConversation = ConversationEntity & { id: number };

const emptyQqConfig = {
  enabled: false,
  wsUrl: "",
  accessToken: "",
};

function createFixture() {
  const actors = new Map<number, PersistedActor>([
    [1, { id: 1, roleId: 1, enabled: true }],
    [2, { id: 2, roleId: 2, enabled: true }],
  ]);
  const conversations = new Map<number, PersistedConversation>();
  let nextConversationId = 1;
  const actorDB = {
    getActor: vi.fn(async (actorId: number) => actors.get(actorId) ?? null),
    upsertActor: vi.fn(async (actor: PersistedActor) => {
      actors.set(actor.id, { ...actor });
      return actor.id;
    }),
  };
  const conversationDB = {
    listConversations: vi.fn(async ({ actorId }: { actorId?: number }) =>
      Array.from(conversations.values()).filter(
        (conversation) =>
          typeof actorId !== "number" || conversation.actorId === actorId,
      ),
    ),
    getConversationByActorAndSession: vi.fn(
      async (actorId: number, session: string) =>
        Array.from(conversations.values()).find(
          (conversation) =>
            conversation.actorId === actorId &&
            conversation.session === session,
        ) ?? null,
    ),
    getConversation: vi.fn(
      async (conversationId: number) =>
        conversations.get(conversationId) ?? null,
    ),
    upsertConversation: vi.fn(async (conversation: ConversationEntity) => {
      const id = conversation.id ?? nextConversationId++;
      conversations.set(id, {
        ...conversation,
        id,
        description: conversation.description ?? "",
        allowProactive: conversation.allowProactive === true,
      });
      return id;
    }),
    deleteConversation: vi.fn(async (conversationId: number) =>
      conversations.delete(conversationId),
    ),
  };
  const channelRegistry = {
    refreshActorChannels: vi.fn(async () => {}),
    restartActorChannel: vi.fn(async () => {}),
    getActorChannelStatus: vi.fn(() => "disconnected" as const),
  };
  const actorController = {
    publishUpdated: vi.fn(async () => {}),
  };
  const actorRegistry = {
    get: vi.fn((actorId: number) =>
      actors.get(actorId)?.enabled ? ({} as never) : null,
    ),
  };
  const bus = new EmaBus();
  const events: ReturnType<EmaBus["createEvent"]>[] = [];
  bus.subscribe((event) => events.push(event));
  const server = {
    dbService: {
      actorDB,
      conversationDB,
      getActorChannelConfig: vi.fn(async (actorId: number) => ({
        qq: actors.get(actorId)?.channelConfig?.qq ?? emptyQqConfig,
      })),
    },
    actorRegistry,
    gateway: { channelRegistry },
    bus,
    controller: {
      actor: actorController,
    },
  };
  const controller = new ChannelController(server as never);
  return {
    controller,
    actors,
    conversations,
    actorDB,
    conversationDB,
    channelRegistry,
    actorController,
    actorRegistry,
    events,
  };
}

describe("ChannelController", () => {
  test("saves QQ connection config without changing enabled state", async () => {
    const fixture = createFixture();
    fixture.actors.set(1, {
      id: 1,
      roleId: 1,
      enabled: true,
      channelConfig: {
        qq: {
          enabled: false,
          wsUrl: "",
          accessToken: "",
        },
      },
    });

    const config = {
      wsUrl: "ws://127.0.0.1:3001",
      accessToken: "token",
    };

    await expect(
      fixture.controller.saveQqConnectionConfig(1, config),
    ).resolves.toEqual({
      enabled: false,
      ...config,
    });

    expect(fixture.actors.get(1)?.channelConfig?.qq).toEqual({
      enabled: false,
      ...config,
    });
    expect(fixture.channelRegistry.refreshActorChannels).toHaveBeenCalledWith(
      1,
    );
    expect(fixture.actorController.publishUpdated).toHaveBeenCalledWith(1);
    expect(fixture.events.at(-1)?.type).toBe("channel.qq.connection.changed");
  });

  test("rejects saving QQ connection config without wsUrl or token", async () => {
    const fixture = createFixture();

    await expect(
      fixture.controller.saveQqConnectionConfig(1, {
        wsUrl: "",
        accessToken: "token",
      }),
    ).rejects.toThrow("QQ wsUrl is required");
    await expect(
      fixture.controller.saveQqConnectionConfig(1, {
        wsUrl: "ws://127.0.0.1:3001",
        accessToken: " ",
      }),
    ).rejects.toThrow("QQ accessToken is required");

    expect(fixture.actorDB.upsertActor).not.toHaveBeenCalled();
  });

  test("enables QQ only when saved connection config is complete", async () => {
    const fixture = createFixture();

    await expect(fixture.controller.setQqEnabled(1, true)).rejects.toThrow(
      "QQ wsUrl is required before QQ can be enabled",
    );
    expect(fixture.actorDB.upsertActor).not.toHaveBeenCalled();

    fixture.actors.set(1, {
      id: 1,
      roleId: 1,
      enabled: true,
      channelConfig: {
        qq: {
          enabled: false,
          wsUrl: "ws://127.0.0.1:3001",
          accessToken: "token",
        },
      },
    });

    await expect(fixture.controller.setQqEnabled(1, true)).resolves.toEqual({
      enabled: true,
      wsUrl: "ws://127.0.0.1:3001",
      accessToken: "token",
    });

    expect(fixture.actors.get(1)?.channelConfig?.qq.enabled).toBe(true);
    expect(fixture.channelRegistry.refreshActorChannels).toHaveBeenCalledWith(
      1,
    );
  });

  test("disables QQ without requiring saved connection config", async () => {
    const fixture = createFixture();
    fixture.actors.set(1, {
      id: 1,
      roleId: 1,
      enabled: true,
      channelConfig: {
        qq: {
          enabled: true,
          wsUrl: "",
          accessToken: "",
        },
      },
    });

    await expect(fixture.controller.setQqEnabled(1, false)).resolves.toEqual({
      enabled: false,
      wsUrl: "",
      accessToken: "",
    });

    expect(fixture.actors.get(1)?.channelConfig?.qq.enabled).toBe(false);
    expect(fixture.channelRegistry.refreshActorChannels).toHaveBeenCalledWith(
      1,
    );
  });

  test("stores QQ conversations as ConversationEntity records", async () => {
    const fixture = createFixture();

    const created = await fixture.controller.addQqConversation(1, {
      type: "chat",
      uid: "12345",
      name: "Friend",
      description: "private chat",
      allowProactive: true,
    });

    expect(created).toMatchObject({
      actorId: 1,
      session: "qq-chat-12345",
      name: "Friend",
      description: "private chat",
      allowProactive: true,
    });
    await expect(
      fixture.controller.addQqConversation(1, {
        type: "chat",
        uid: "12345",
        name: "Duplicate",
      }),
    ).rejects.toThrow("already exists");

    const updated = await fixture.controller.updateQqConversation(
      1,
      created.id,
      {
        name: "Renamed",
        description: "updated",
        allowProactive: false,
      },
    );
    expect(updated).toMatchObject({
      session: "qq-chat-12345",
      name: "Renamed",
      description: "updated",
      allowProactive: false,
    });

    await expect(
      fixture.controller.deleteQqConversation(1, created.id),
    ).resolves.toBe(true);
    await expect(
      fixture.controller.deleteQqConversation(1, created.id),
    ).resolves.toBe(false);
  });

  test("reports offline and skips manual restart when actor runtime is missing", async () => {
    const fixture = createFixture();

    await expect(fixture.controller.restartQq(1)).resolves.toMatchObject({
      blockedBy: "qq_disabled",
      transportStatus: "disconnected",
      retryable: false,
    });
    expect(fixture.channelRegistry.restartActorChannel).not.toHaveBeenCalled();

    fixture.actors.set(1, {
      id: 1,
      roleId: 1,
      enabled: true,
      channelConfig: {
        qq: {
          enabled: true,
          wsUrl: "ws://127.0.0.1:3001",
          accessToken: "token",
        },
      },
    });
    fixture.actorRegistry.get.mockReturnValueOnce(null);

    await expect(
      fixture.controller.getQqConnectionState(1),
    ).resolves.toMatchObject({
      blockedBy: "actor_offline",
      transportStatus: "disconnected",
      retryable: false,
    });
    fixture.actorRegistry.get
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);
    await expect(fixture.controller.restartQq(1)).resolves.toMatchObject({
      blockedBy: "actor_offline",
      transportStatus: "disconnected",
      retryable: false,
    });
    expect(fixture.channelRegistry.restartActorChannel).not.toHaveBeenCalled();
  });

  test("manual QQ restart recreates channels when saved config is enabled and runtime exists", async () => {
    const fixture = createFixture();
    fixture.actors.set(1, {
      id: 1,
      roleId: 1,
      enabled: true,
      channelConfig: {
        qq: {
          enabled: true,
          wsUrl: "ws://127.0.0.1:3001",
          accessToken: "token",
        },
      },
    });

    await expect(fixture.controller.restartQq(1)).resolves.toMatchObject({
      blockedBy: null,
      transportStatus: "disconnected",
      retryable: true,
    });
    expect(fixture.channelRegistry.restartActorChannel).toHaveBeenCalledWith(
      1,
      "qq",
    );
  });
});
