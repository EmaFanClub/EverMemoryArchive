import { describe, expect, test, vi } from "vitest";

import { Logger } from "../../shared/logger";
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
        removeActorRelationsByActorId: vi.fn(async () => 1),
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
        deleteConversationsByActorId: vi.fn(async () => 1),
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
        deleteConversationMessagesByActorId: vi.fn(async () => 1),
      },
      shortTermMemoryDB: {
        listShortTermMemories: vi.fn(async () => []),
        deleteShortTermMemory: vi.fn(async () => true),
        deleteShortTermMemoriesByActorId: vi.fn(async () => 1),
      },
      longTermMemoryDB: {
        listLongTermMemories: vi.fn(async () => []),
        deleteLongTermMemory: vi.fn(async () => true),
        deleteLongTermMemoriesByActorId: vi.fn(async () => 1),
      },
      tokenUsageDB: {
        deleteTokenUsageRecordsByActorId: vi.fn(async () => 1),
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
    expect(server.dbService.actorDB.deleteActor).toHaveBeenCalledWith(
      1,
      result.deletedAt,
    );
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

  test("publishes deletion after runtime channels and scheduler jobs are cleaned", async () => {
    const order: string[] = [];
    const { controller, server } = createFixture();
    server.actorRegistry.unload.mockImplementation(async () => {
      order.push("runtime");
    });
    server.gateway.channelRegistry.removeActorChannels.mockImplementation(
      async () => {
        order.push("channels");
      },
    );
    server.scheduler.listJobs.mockImplementation(async () => [
      {
        attrs: {
          _id: { toString: () => "actor-job" },
          data: { actorId: 1, task: "chat", prompt: "" },
        },
      },
    ]);
    server.scheduler.cancel.mockImplementation(async () => {
      order.push("scheduler");
      return true;
    });
    server.bus.publish.mockImplementation(() => {
      order.push("publish");
    });

    await controller.delete(1);

    expect(order.indexOf("publish")).toBeGreaterThan(order.indexOf("runtime"));
    expect(order.indexOf("publish")).toBeGreaterThan(order.indexOf("channels"));
    expect(order.indexOf("publish")).toBeGreaterThan(
      order.indexOf("scheduler"),
    );
  });

  test("continues deleting long-term memories when short-term cleanup fails", async () => {
    const { controller, server } = createFixture();
    server.dbService.shortTermMemoryDB.deleteShortTermMemoriesByActorId.mockRejectedValueOnce(
      new Error("short-term cleanup failed"),
    );

    await controller.delete(1);

    await vi.waitFor(() => {
      expect(
        server.dbService.longTermMemoryDB.deleteLongTermMemoriesByActorId,
      ).toHaveBeenCalledWith(1);
      expect(
        server.dbService.tokenUsageDB.deleteTokenUsageRecordsByActorId,
      ).toHaveBeenCalledWith(1);
    });
  });

  test("uses actor-scoped bulk cleanup without loading actor-owned rows", async () => {
    const { controller, server } = createFixture();

    await controller.delete(1);

    await vi.waitFor(() => {
      expect(
        server.dbService.userOwnActorDB.removeActorRelationsByActorId,
      ).toHaveBeenCalledWith(1);
      expect(
        server.dbService.conversationMessageDB
          .deleteConversationMessagesByActorId,
      ).toHaveBeenCalledWith(1);
      expect(
        server.dbService.conversationDB.deleteConversationsByActorId,
      ).toHaveBeenCalledWith(1);
      expect(
        server.dbService.shortTermMemoryDB.deleteShortTermMemoriesByActorId,
      ).toHaveBeenCalledWith(1);
      expect(
        server.dbService.longTermMemoryDB.deleteLongTermMemoriesByActorId,
      ).toHaveBeenCalledWith(1);
    });
    expect(
      server.dbService.userOwnActorDB.listUserOwnActorRelations,
    ).not.toHaveBeenCalled();
    expect(
      server.dbService.conversationMessageDB.listConversationMessages,
    ).not.toHaveBeenCalled();
    expect(
      server.dbService.conversationDB.listConversations,
    ).not.toHaveBeenCalled();
    expect(
      server.dbService.shortTermMemoryDB.listShortTermMemories,
    ).not.toHaveBeenCalled();
    expect(
      server.dbService.longTermMemoryDB.listLongTermMemories,
    ).not.toHaveBeenCalled();
  });

  test("logs cleanup step failures without blocking actor deletion", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    const { controller, server } = createFixture();
    server.dbService.personalityDB.deletePersonality.mockRejectedValueOnce(
      new Error("personality cleanup failed"),
    );

    await controller.delete(1);

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith("Actor deletion cleanup step failed", {
        actorId: 1,
        step: "personality",
        error: "personality cleanup failed",
      });
    });
    warn.mockRestore();
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
