import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { runActorBackgroundJob } = vi.hoisted(() => ({
  runActorBackgroundJob: vi.fn(async () => {}),
}));

const { actorLogger } = vi.hoisted(() => ({
  actorLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../scheduler/jobs/actor.job", () => ({
  runActorBackgroundJob,
}));

vi.mock("../../shared/logger", () => ({
  Logger: class Logger {
    static create() {
      return actorLogger;
    }
  },
}));

import { buildSession } from "../../channel";
import { Actor } from "../actor";

const GROUP_ACTIVE_IDLE_TIMEOUT_MS = 5 * 60_000;

function createActor(session: string = buildSession("qq", "group", "1000")) {
  const actorScheduler = {
    deleteFocusByConversation: vi.fn(async () => ({
      deletedIds: ["focus-1"],
    })),
  };
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
    getActorScheduler: vi.fn(() => actorScheduler),
  };
  return {
    actor: new (Actor as any)(1, server) as Actor,
    server,
    actorScheduler,
  };
}

describe("Actor group active lifecycle", () => {
  beforeEach(() => {
    runActorBackgroundJob.mockClear();
    actorLogger.debug.mockClear();
    actorLogger.info.mockClear();
    actorLogger.warn.mockClear();
    actorLogger.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(actorLogger.info).toHaveBeenCalledWith(
      "Group conversation deactivated",
      {
        conversationId,
        session: buildSession("qq", "group", "1000"),
        reason: "keep_silence",
      },
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
    expect(actorLogger.info).toHaveBeenCalledWith(
      "Group conversation deactivated",
      {
        conversationId,
        session: buildSession("qq", "group", "1000"),
        reason: "keep_silence",
      },
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

  test("stops following active groups and removes their focus schedule", async () => {
    const conversationId = 7;
    const { actor, server, actorScheduler } = createActor();
    actor.sessionManager.activateConversation(conversationId);
    (actor as any).groupSegmentsWithReply.add(conversationId);

    await (actor as any).closeGroupConversationActivity(
      conversationId,
      "stop_following_group",
    );

    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "inactive",
    );
    expect(actorLogger.info).toHaveBeenCalledWith(
      "Group conversation deactivated",
      {
        conversationId,
        session: buildSession("qq", "group", "1000"),
        reason: "stop_following_group",
      },
    );
    expect(actorScheduler.deleteFocusByConversation).toHaveBeenCalledWith(
      conversationId,
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
          reason: "stop_following_group",
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
    expect(actorLogger.info).toHaveBeenCalledWith(
      "Group conversation deactivated",
      {
        conversationId,
        session: buildSession("qq", "group", "1000"),
        reason: "sleep_timer",
      },
    );
  });

  test("stops idle active group conversations and removes their focus schedule", async () => {
    vi.useFakeTimers();
    const conversationId = 7;
    const { actor, server, actorScheduler } = createActor();
    actor.sessionManager.activateConversation(conversationId);
    (actor as any).groupSegmentsWithReply.add(conversationId);

    (actor as any).refreshGroupConversationIdleTimer(conversationId);
    await vi.advanceTimersByTimeAsync(GROUP_ACTIVE_IDLE_TIMEOUT_MS - 1);

    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "active",
    );
    expect(runActorBackgroundJob).not.toHaveBeenCalled();
    expect(actorScheduler.deleteFocusByConversation).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(actor.sessionManager.getActivityState(conversationId)).toBe(
      "inactive",
    );
    expect(actorLogger.info).toHaveBeenCalledWith(
      "Group conversation deactivated",
      {
        conversationId,
        session: buildSession("qq", "group", "1000"),
        reason: "idle_timeout",
      },
    );
    expect(actorScheduler.deleteFocusByConversation).toHaveBeenCalledWith(
      conversationId,
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
          reason: "idle_timeout",
          force: true,
        },
      },
      expect.any(Number),
    );
  });
});
