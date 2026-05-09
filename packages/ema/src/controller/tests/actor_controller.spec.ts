import { describe, expect, test, vi } from "vitest";

import { ActorController } from "../actor_controller";

function createFixture() {
  const server = {
    controller: {
      schedule: {
        getSleepScheduleInput: vi.fn(async () => ({
          startMinutes: 11 * 60,
          endMinutes: 19 * 60,
        })),
      },
      runtime: {
        getSnapshot: vi.fn(async (actorId: number) => ({
          actorId,
          enabled: true,
          status: "online",
          transition: null,
          updatedAt: 1000,
        })),
      },
    },
    dbService: {
      userOwnActorDB: {
        listUserOwnActorRelations: vi.fn(async () => [
          { userId: 1, actorId: 1 },
        ]),
        removeActorFromUser: vi.fn(async () => true),
      },
      actorDB: {
        getActor: vi.fn(async () => ({ id: 1, roleId: 1, enabled: true })),
        listActors: vi.fn(async () => [{ id: 1, roleId: 1, enabled: true }]),
        deleteActor: vi.fn(async () => true),
      },
      roleDB: {
        getRole: vi.fn(async () => ({ id: 1, name: "小绿", prompt: "" })),
        deleteRole: vi.fn(async () => true),
      },
      personalityDB: {
        deletePersonality: vi.fn(async () => true),
      },
      conversationDB: {
        getConversationByActorAndSession: vi.fn(
          async (actorId: number, session: string) =>
            actorId === 1 && session === "web-chat-1"
              ? {
                  id: 11,
                  actorId,
                  session,
                  name: "和主人的网页聊天",
                  description: "",
                  allowProactive: true,
                }
              : null,
        ),
        listConversations: vi.fn(async () => []),
        deleteConversation: vi.fn(async () => true),
      },
      conversationMessageDB: {
        listConversationMessages: vi.fn(async ({ conversationId }) =>
          conversationId === 11
            ? [
                {
                  id: 101,
                  conversationId: 11,
                  actorId: 1,
                  msgId: 10,
                  message: {
                    kind: "actor",
                    msgId: 10,
                    uid: "1",
                    name: "小绿",
                    contents: [{ type: "text", text: "web preview" }],
                  },
                  createdAt: 1000,
                },
              ]
            : [],
        ),
        deleteConversationMessage: vi.fn(async () => true),
      },
      shortTermMemoryDB: {
        listShortTermMemories: vi.fn(async () => []),
        deleteShortTermMemory: vi.fn(async () => true),
      },
      longTermMemoryDB: {
        listLongTermMemories: vi.fn(async () => []),
        deleteLongTermMemory: vi.fn(async () => true),
      },
    },
    bus: {
      createEvent: vi.fn((event) => event),
      publish: vi.fn(),
    },
    actorRegistry: {
      unload: vi.fn(async () => undefined),
    },
    gateway: {
      channelRegistry: {
        removeActorChannels: vi.fn(async () => undefined),
      },
    },
    scheduler: {
      listJobs: vi.fn(async () => []),
      cancel: vi.fn(async () => true),
    },
    getActorScheduler: vi.fn(() => ({
      list: vi.fn(async () => ({ overdue: [], upcoming: [], recurring: [] })),
      delete: vi.fn(async () => undefined),
    })),
  };
  return {
    controller: new ActorController(server as never),
    server,
  };
}

describe("ActorController", () => {
  test("builds actor list previews from the owner's web conversation", async () => {
    const { controller, server } = createFixture();

    const actors = await controller.listForUser(1);

    expect(
      server.dbService.conversationDB.getConversationByActorAndSession,
    ).toHaveBeenCalledWith(1, "web-chat-1");
    expect(
      server.dbService.conversationMessageDB.listConversationMessages,
    ).toHaveBeenCalledWith({
      conversationId: 11,
      sort: "desc",
      limit: 1,
    });
    expect(actors[0]?.latestPreview).toEqual({
      text: "web preview",
      time: 1000,
    });
    expect(actors[0]?.sleepSchedule).toEqual({
      startMinutes: 11 * 60,
      endMinutes: 19 * 60,
    });
  });

  test("soft deletes a pending training actor and publishes an event", async () => {
    const { controller, server } = createFixture();
    server.dbService.actorDB.getActor.mockResolvedValueOnce({
      id: 1,
      roleId: 1,
      enabled: false,
      origin: "training",
      trainingStatus: "pending",
    });

    const result = await controller.delete(1);

    expect(result.actorId).toBe(1);
    expect(typeof result.deletedAt).toBe("number");
    expect(server.dbService.actorDB.deleteActor).toHaveBeenCalledWith(1);
    expect(server.bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "actor.deleted",
        actorId: 1,
        data: { actorId: 1 },
      }),
    );
  });

  test("cleans all actor scheduler jobs including background jobs", async () => {
    const { controller, server } = createFixture();
    server.scheduler.listJobs.mockResolvedValueOnce([
      {
        attrs: {
          _id: { toString: () => "foreground-job" },
          data: { actorId: 1, task: "chat", prompt: "" },
        },
      },
      {
        attrs: {
          _id: { toString: () => "background-job" },
          data: { actorId: 1, task: "memory_rollup", prompt: "" },
        },
      },
    ]);

    await controller.delete(1);

    await vi.waitFor(() => {
      expect(server.scheduler.listJobs).toHaveBeenCalledWith({
        "data.actorId": 1,
      });
      expect(server.scheduler.cancel).toHaveBeenCalledWith("foreground-job");
      expect(server.scheduler.cancel).toHaveBeenCalledWith("background-job");
    });
  });

  test("continues deleting long-term memories when short-term memory listing fails", async () => {
    const { controller, server } = createFixture();
    server.dbService.shortTermMemoryDB.listShortTermMemories.mockRejectedValueOnce(
      new Error("short-term list failed"),
    );
    server.dbService.longTermMemoryDB.listLongTermMemories.mockResolvedValueOnce(
      [
        {
          id: 201,
          actorId: 1,
          index0: "对话",
          index1: "事实",
          memory: "memory",
        },
      ],
    );

    await controller.delete(1);

    await vi.waitFor(() => {
      expect(
        server.dbService.longTermMemoryDB.deleteLongTermMemory,
      ).toHaveBeenCalledWith(201);
    });
  });

  test("rejects actor deletion while training is running", async () => {
    const { controller, server } = createFixture();
    server.dbService.actorDB.getActor.mockResolvedValueOnce({
      id: 1,
      roleId: 1,
      enabled: false,
      origin: "training",
      trainingStatus: "running",
    });

    await expect(controller.delete(1)).rejects.toThrow("training");
    expect(server.dbService.actorDB.deleteActor).not.toHaveBeenCalled();
  });
});
