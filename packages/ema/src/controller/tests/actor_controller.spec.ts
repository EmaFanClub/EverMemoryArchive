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
      },
      actorDB: {
        getActor: vi.fn(async () => ({ id: 1, roleId: 1, enabled: true })),
      },
      roleDB: {
        getRole: vi.fn(async () => ({ id: 1, name: "小绿", prompt: "" })),
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
      },
    },
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
});
