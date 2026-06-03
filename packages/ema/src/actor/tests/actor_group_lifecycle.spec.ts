import { beforeEach, describe, expect, test, vi } from "vitest";

const { runActorBackgroundJob } = vi.hoisted(() => ({
  runActorBackgroundJob: vi.fn(async () => {}),
}));

vi.mock("../../scheduler/jobs/actor.job", () => ({
  runActorBackgroundJob,
}));

vi.mock("../../shared/logger", () => ({
  Logger: class Logger {
    static create() {
      return {
        debug() {},
        info() {},
        warn() {},
        error() {},
      };
    }
  },
}));

import { buildSession } from "../../channel";
import { Actor } from "../actor";

function createActor(session: string = buildSession("qq", "group", "1000")) {
  const server = {
    dbService: {
      conversationDB: {
        getConversation: vi.fn(async (conversationId: number) => ({
          id: conversationId,
          actorId: 1,
          session,
        })),
      },
    },
    promptStore: {
      loadTaskPrompt: vi.fn(async (name: string) => `${name} prompt`),
    },
    controller: {
      chat: {
        publishConversationTyping: vi.fn(async () => undefined),
      },
      runtime: {
        publishStatus: vi.fn(async () => undefined),
      },
    },
  };
  return {
    actor: new (Actor as any)(1, server) as Actor,
    server,
  };
}

describe("Actor group active lifecycle", () => {
  beforeEach(() => {
    runActorBackgroundJob.mockClear();
  });

  test("deactivates active groups without final rollup when the segment has no reply", async () => {
    const conversationId = 7;
    const { actor } = createActor();
    actor.sessionManager.activateConversation(conversationId);

    await (actor as any).closeGroupConversationActivity(
      conversationId,
      "keep_silence",
    );

    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "inactive",
    );
    expect(runActorBackgroundJob).not.toHaveBeenCalled();
  });

  test("runs final conversation rollup when a replied group segment exits", async () => {
    const conversationId = 7;
    const { actor, server } = createActor();
    actor.sessionManager.activateConversation(conversationId);
    (actor as any).groupSegmentsWithReply.add(conversationId);

    await (actor as any).closeGroupConversationActivity(
      conversationId,
      "keep_silence",
    );

    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "inactive",
    );
    expect(server.promptStore.loadTaskPrompt).toHaveBeenCalledWith(
      "conversation-rollup",
    );
    expect(runActorBackgroundJob).toHaveBeenCalledWith(
      server,
      {
        actorId: 1,
        conversationId,
        task: "conversation_rollup",
        prompt: "conversation-rollup prompt",
        addition: {
          reason: "keep_silence",
          force: true,
        },
      },
      expect.any(Number),
    );
  });

  test("cleans active group segments before timer sleep", async () => {
    const conversationId = 7;
    const { actor } = createActor();
    (actor as any).status = "awake";
    actor.sessionManager.activateConversation(conversationId);
    (actor as any).groupSegmentsWithReply.add(conversationId);

    await (actor as any).handleSleepTimerFired();

    const calls = runActorBackgroundJob.mock.calls as unknown as Array<
      [unknown, { task: string; addition?: Record<string, unknown> }]
    >;
    expect(calls).toHaveLength(2);
    expect(calls[0]![1]).toMatchObject({
      task: "conversation_rollup",
      addition: {
        reason: "sleep_timer",
        force: true,
      },
    });
    expect(calls[1]![1]).toMatchObject({
      task: "sleep",
      addition: {
        source: "timer",
      },
    });
    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "inactive",
    );
  });
});
