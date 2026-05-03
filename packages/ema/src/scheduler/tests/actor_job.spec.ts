import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../llm", () => ({
  LLMClient: class LLMClient {},
}));

vi.mock("../../shared/logger", () => ({
  formatLogTimestamp: (timestamp: number = 0) =>
    new Date(timestamp).toISOString().replace("T", "_").replace(/[:.Z]/g, "-"),
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

import { Agent } from "../../agent";
import {
  runActorBackgroundJob,
  runActorForegroundJob,
  type ActorBackgroundJobData,
} from "../jobs/actor.job";
import type { ShortTermMemoryRecord } from "../../memory/base";
import { loadTestGlobalConfig } from "../../config/tests/helpers";

type BufferedMessageRecord = {
  msgId: number;
  createdAt: number;
  activityProcessedAt?: number;
};

type FakeMemoryManager = {
  diaryUpdateEvery: number;
  activityRollupEvery: number;
  tryEnterConversationActivity: (conversationId: number) => boolean;
  leaveConversationActivity: (conversationId: number) => void;
  tryEnterActivityToDayRollup: (actorId: number) => boolean;
  leaveActivityToDayRollup: (actorId: number) => void;
  getPendingConversationWindowState: (
    conversationId: number,
    triggeredAt: number,
  ) => Promise<{ count: number; lastPendingId: number | null }>;
  getBufferedConversationWindowSnapshot: (
    conversationId: number,
    triggeredAt: number,
  ) => Promise<{ messages: []; msgIds: number[] }>;
  markConversationMessagesActivityProcessed: (
    conversationId: number,
    msgIds: number[],
    processedAt: number,
  ) => Promise<number>;
  getActivityWindow: (
    actorId: number,
    triggeredAt: number,
  ) => Promise<ShortTermMemoryRecord[]>;
  getPendingActivityWindowState: (
    actorId: number,
    triggeredAt: number,
  ) => Promise<{ count: number; lastPendingId: number | null }>;
  buildSystemPromptForBackground: () => Promise<string>;
};

type FakeLogger = {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

type FakeActor = {
  status: "sleep" | "awake" | "switching";
  getStatus: () => "sleep" | "awake" | "switching";
  canRunActiveTasks: () => boolean;
  beginWake: () => boolean;
  completeWake: () => void;
  failWake: () => void;
  startSleepTimer: () => boolean;
  beginSleep: () => boolean;
  completeSleep: () => void;
  failSleep: () => void;
  enqueueActorInput: ReturnType<typeof vi.fn>;
};

type FakeServer = {
  logger: FakeLogger;
  actorRegistry: {
    ensure: (actorId: number) => Promise<FakeActor>;
  };
  dbService: {
    getActorLLMConfig: (actorId: number) => Promise<Record<string, unknown>>;
    actorDB: {
      getActor: (actorId: number) => Promise<{ enabled: boolean } | null>;
    };
    conversationDB: {
      getConversation: (conversationId: number) => Promise<{
        id: number;
        actorId: number;
        session: string;
        allowProactive?: boolean;
      } | null>;
    };
  };
  memoryManager: FakeMemoryManager;
};

function createFakeServer(
  bufferedMessages: BufferedMessageRecord[] = [],
  activities: ShortTermMemoryRecord[] = [],
  actor: FakeActor = createFakeActor(),
): FakeServer {
  const runningConversationActivities = new Set<number>();
  const runningActivityToDayRollups = new Set<number>();

  const getConversationWindow = (triggeredAt: number) =>
    bufferedMessages
      .filter((item) => item.createdAt <= triggeredAt)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-30);

  const getActivityWindow = (triggeredAt: number) =>
    activities
      .filter((item) => (item.createdAt ?? 0) <= triggeredAt)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .slice(-30);

  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    actorRegistry: {
      async ensure() {
        return actor;
      },
    },
    dbService: {
      async getActorLLMConfig() {
        return {};
      },
      actorDB: {
        async getActor() {
          return { enabled: true };
        },
      },
      conversationDB: {
        async getConversation(conversationId: number) {
          return {
            id: conversationId,
            actorId: 1,
            session: `web-chat-${conversationId}`,
            allowProactive: true,
          };
        },
      },
    },
    memoryManager: {
      diaryUpdateEvery: 20,
      activityRollupEvery: 20,
      tryEnterConversationActivity(conversationId: number): boolean {
        if (runningConversationActivities.has(conversationId)) {
          return false;
        }
        runningConversationActivities.add(conversationId);
        return true;
      },
      leaveConversationActivity(conversationId: number): void {
        runningConversationActivities.delete(conversationId);
      },
      tryEnterActivityToDayRollup(actorId: number): boolean {
        if (runningActivityToDayRollups.has(actorId)) {
          return false;
        }
        runningActivityToDayRollups.add(actorId);
        return true;
      },
      leaveActivityToDayRollup(actorId: number): void {
        runningActivityToDayRollups.delete(actorId);
      },
      async getPendingConversationWindowState(
        _conversationId: number,
        triggeredAt: number,
      ) {
        const pending = getConversationWindow(triggeredAt).filter(
          (item) => typeof item.activityProcessedAt !== "number",
        );
        return {
          count: pending.length,
          lastPendingId: pending[pending.length - 1]?.msgId ?? null,
        };
      },
      async getBufferedConversationWindowSnapshot(
        _conversationId: number,
        triggeredAt: number,
      ) {
        const snapshot = getConversationWindow(triggeredAt);
        return {
          messages: [],
          msgIds: snapshot.map((item) => item.msgId),
        };
      },
      async markConversationMessagesActivityProcessed(
        _conversationId: number,
        msgIds: number[],
        processedAt: number,
      ) {
        let updated = 0;
        for (const item of bufferedMessages) {
          if (!msgIds.includes(item.msgId)) {
            continue;
          }
          if (item.activityProcessedAt !== processedAt) {
            updated += 1;
          }
          item.activityProcessedAt = processedAt;
        }
        return updated;
      },
      async getActivityWindow(_actorId: number, triggeredAt: number) {
        return getActivityWindow(triggeredAt).map((item) => ({ ...item }));
      },
      async getPendingActivityWindowState(
        _actorId: number,
        triggeredAt: number,
      ) {
        const pending = getActivityWindow(triggeredAt).filter(
          (item) => typeof item.processedAt !== "number",
        );
        return {
          count: pending.length,
          lastPendingId: pending[pending.length - 1]?.id ?? null,
        };
      },
      async buildSystemPromptForBackground() {
        return "";
      },
    },
  };
}

function createFakeActor(
  initialStatus: FakeActor["status"] = "awake",
): FakeActor {
  const actor: FakeActor = {
    status: initialStatus,
    getStatus() {
      return actor.status;
    },
    canRunActiveTasks() {
      return actor.status === "awake";
    },
    beginWake() {
      if (actor.status !== "sleep") {
        return false;
      }
      actor.status = "switching";
      return true;
    },
    completeWake() {
      actor.status = "awake";
    },
    failWake() {
      actor.status = "sleep";
    },
    startSleepTimer() {
      return actor.status === "awake";
    },
    beginSleep() {
      if (actor.status !== "awake") {
        return false;
      }
      actor.status = "switching";
      return true;
    },
    completeSleep() {
      actor.status = "sleep";
    },
    failSleep() {
      actor.status = "awake";
    },
    enqueueActorInput: vi.fn(),
  };
  return actor;
}

function createBufferedMessages(
  startId: number,
  count: number,
  startAt: number,
): BufferedMessageRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    msgId: startId + index,
    createdAt: startAt + index,
  }));
}

function createActivities(
  startId: number,
  count: number,
  startAt: number,
): ShortTermMemoryRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: startId + index,
    kind: "activity",
    date: "2026-04-13",
    dayDate: "2026-04-13",
    memory: `activity-${startId + index}`,
    createdAt: startAt + index,
  }));
}

function mockNowSequence(values: number[]) {
  let index = 0;
  return vi.spyOn(Date, "now").mockImplementation(() => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  });
}

function expectInfoLog(
  server: FakeServer,
  message: string,
  data: Record<string, unknown>,
) {
  expect(server.logger.info).toHaveBeenCalledWith(
    message,
    expect.objectContaining(data),
  );
}

beforeEach(async () => {
  await loadTestGlobalConfig();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const conversationRollupJob = (): ActorBackgroundJobData & {
  conversationId: number;
} => ({
  actorId: 1,
  conversationId: 1,
  task: "conversation_rollup",
  prompt: "conversation-rollup",
});

const memoryRollupJob = (
  reason: "threshold" | "dayend" = "threshold",
): ActorBackgroundJobData => ({
  actorId: 1,
  task: "memory_rollup",
  prompt: "memory-rollup",
  addition: { reason },
});

describe("actor background job lifecycle logs", () => {
  test("conversation rollup logs request, start, and completion", async () => {
    const bufferedMessages = createBufferedMessages(1, 20, 1000);
    const server = createFakeServer(bufferedMessages);

    vi.spyOn(Agent.prototype, "runWithState").mockImplementation(
      async (state) => {
        if (state.toolContext?.data) {
          state.toolContext.data.activityAdded = true;
        }
      },
    );

    await runActorBackgroundJob(server as any, conversationRollupJob(), 2000);

    expectInfoLog(server, "Actor background task requested", {
      actorId: 1,
      task: "conversation_rollup",
      conversationId: 1,
      triggeredAt: 2000,
    });
    expectInfoLog(server, "Actor background task started", {
      actorId: 1,
      task: "conversation_rollup",
      conversationId: 1,
      pendingCount: 20,
      threshold: 20,
    });
    expectInfoLog(server, "Actor background task completed", {
      actorId: 1,
      task: "conversation_rollup",
      conversationId: 1,
      activityAdded: true,
      processedMessageCount: 20,
      pendingBefore: 20,
      pendingAfter: 0,
      followUpScheduled: false,
      durationMs: expect.any(Number),
    });
  });

  test("conversation rollup logs skipped when another run owns the lock", async () => {
    const server = createFakeServer(createBufferedMessages(1, 20, 1000));
    server.memoryManager.tryEnterConversationActivity = vi.fn(() => false);
    const runWithStateSpy = vi.spyOn(Agent.prototype, "runWithState");

    await runActorBackgroundJob(server as any, conversationRollupJob(), 2000);

    expect(runWithStateSpy).not.toHaveBeenCalled();
    expectInfoLog(server, "Actor background task skipped", {
      actorId: 1,
      task: "conversation_rollup",
      conversationId: 1,
      reason: "already_running",
    });
  });

  test("conversation rollup logs skipped when the threshold is not reached", async () => {
    const server = createFakeServer(createBufferedMessages(1, 19, 1000));
    const runWithStateSpy = vi.spyOn(Agent.prototype, "runWithState");

    await runActorBackgroundJob(server as any, conversationRollupJob(), 2000);

    expect(runWithStateSpy).not.toHaveBeenCalled();
    expectInfoLog(server, "Actor background task skipped", {
      actorId: 1,
      task: "conversation_rollup",
      conversationId: 1,
      reason: "threshold_not_reached",
      pendingBefore: 19,
      pendingAfter: 19,
      threshold: 20,
      followUpScheduled: false,
    });
  });

  test("background jobs are skipped when the actor is disabled", async () => {
    const server = createFakeServer(createBufferedMessages(1, 20, 1000));
    server.dbService.actorDB.getActor = vi.fn(async () => ({
      enabled: false,
    }));
    const runWithStateSpy = vi.spyOn(Agent.prototype, "runWithState");

    await runActorBackgroundJob(server as any, conversationRollupJob(), 2000);

    expect(runWithStateSpy).not.toHaveBeenCalled();
    expectInfoLog(server, "Actor background task skipped", {
      actorId: 1,
      task: "conversation_rollup",
      conversationId: 1,
      reason: "actor_disabled_or_missing",
    });
  });

  test("activity logs lifecycle for non-rollup background tasks", async () => {
    const server = createFakeServer();
    vi.spyOn(Agent.prototype, "runWithState").mockResolvedValue(undefined);

    await runActorBackgroundJob(
      server as any,
      { actorId: 1, task: "activity", prompt: "activity" },
      2000,
    );

    expectInfoLog(server, "Actor background task requested", {
      actorId: 1,
      task: "activity",
      triggeredAt: 2000,
    });
    expectInfoLog(server, "Actor background task started", {
      actorId: 1,
      task: "activity",
      triggeredAt: 2000,
    });
    expectInfoLog(server, "Actor background task completed", {
      actorId: 1,
      task: "activity",
      triggeredAt: 2000,
      activityAdded: false,
      durationMs: expect.any(Number),
    });
  });

  test("logs background task failure when the agent reports an unsuccessful run", async () => {
    const server = createFakeServer();
    const error = new Error("llm unavailable");
    vi.spyOn(Agent.prototype, "runWithState").mockImplementation(
      async function (this: Agent) {
        this.events.emit("runFinished", {
          ok: false,
          msg: error.message,
          error,
        });
      },
    );

    await expect(
      runActorBackgroundJob(
        server as any,
        { actorId: 1, task: "activity", prompt: "activity" },
        2000,
      ),
    ).rejects.toThrow("llm unavailable");

    expect(server.logger.error).toHaveBeenCalledWith(
      "Actor background task failed",
      expect.objectContaining({
        actorId: 1,
        task: "activity",
        triggeredAt: 2000,
        durationMs: expect.any(Number),
        error,
      }),
    );
  });
});

describe("actor foreground job lifecycle logs", () => {
  test("chat task validates conversation before enqueueing", async () => {
    const actor = createFakeActor("awake");
    const server = createFakeServer([], [], actor);

    await runActorForegroundJob(
      server as any,
      {
        actorId: 1,
        task: "chat",
        conversationId: 12,
        prompt: "主动问候。",
      },
      2000,
    );

    expect(actor.enqueueActorInput).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        kind: "system",
        conversationId: 12,
        time: 2000,
      }),
    );
    expectInfoLog(server, "Actor foreground task enqueued", {
      actorId: 1,
      task: "chat",
      conversationId: 12,
      triggeredAt: 2000,
    });
  });

  test("chat task skips invalid scheduled conversations", async () => {
    const actor = createFakeActor("awake");
    const server = createFakeServer([], [], actor);
    server.dbService.conversationDB.getConversation = vi.fn(async () => null);

    await runActorForegroundJob(
      server as any,
      {
        actorId: 1,
        task: "chat",
        conversationId: 1044916258,
        prompt: "主动问候。",
      },
      2000,
    );

    expect(actor.enqueueActorInput).not.toHaveBeenCalled();
    expect(server.logger.warn).toHaveBeenCalledWith(
      "Actor foreground task skipped",
      expect.objectContaining({
        actorId: 1,
        task: "chat",
        conversationId: 1044916258,
        reason: "invalid_conversation",
      }),
    );
  });
});

describe("actor background job follow-up", () => {
  test("conversation activity schedules a follow-up when threshold is reached after final recheck without running Once", async () => {
    const bufferedMessages = createBufferedMessages(1, 19, 1000);
    const server = createFakeServer(bufferedMessages);

    let stateReadCount = 0;
    const baseGetPendingConversationWindowState =
      server.memoryManager.getPendingConversationWindowState;
    server.memoryManager.getPendingConversationWindowState = async (
      conversationId,
      triggeredAt,
    ) => {
      stateReadCount += 1;
      const state = await baseGetPendingConversationWindowState(
        conversationId,
        triggeredAt,
      );
      if (stateReadCount === 1) {
        bufferedMessages.push(...createBufferedMessages(20, 1, 3000));
      }
      return state;
    };

    const runWithStateSpy = vi
      .spyOn(Agent.prototype, "runWithState")
      .mockImplementation(async (state) => {
        if (state.toolContext?.data) {
          state.toolContext.data.activityAdded = true;
        }
      });

    mockNowSequence([4000, 5000]);

    await runActorBackgroundJob(server as any, conversationRollupJob(), 2000);

    expect(runWithStateSpy).toHaveBeenCalledTimes(1);
    expect(
      bufferedMessages.filter(
        (item) => typeof item.activityProcessedAt !== "number",
      ).length,
    ).toBe(0);
  });

  test("conversation activity schedules a follow-up when Once fails but the pending batch changes", async () => {
    const bufferedMessages = createBufferedMessages(1, 30, 1000);
    const server = createFakeServer(bufferedMessages);

    let callCount = 0;
    vi.spyOn(Agent.prototype, "runWithState").mockImplementation(
      async (state) => {
        callCount += 1;
        if (callCount === 1) {
          bufferedMessages.push(...createBufferedMessages(31, 30, 3000));
          return;
        }
        if (state.toolContext?.data) {
          state.toolContext.data.activityAdded = true;
        }
      },
    );

    mockNowSequence([4000, 5000]);

    await runActorBackgroundJob(server as any, conversationRollupJob(), 2000);

    expect(callCount).toBe(2);
    const newBatch = bufferedMessages.filter((item) => item.msgId >= 31);
    expect(
      newBatch.every((item) => typeof item.activityProcessedAt === "number"),
    ).toBe(true);
  });

  test("threshold memory rollup schedules a follow-up when another full pending batch appears", async () => {
    const activities = createActivities(1, 20, 1000);
    const server = createFakeServer([], activities);

    let callCount = 0;
    vi.spyOn(Agent.prototype, "runWithState").mockImplementation(
      async (state) => {
        callCount += 1;
        const snapshot = Array.isArray(
          state.toolContext?.data?.activitySnapshot,
        )
          ? (state.toolContext.data.activitySnapshot as ShortTermMemoryRecord[])
          : [];
        const processedAt = state.toolContext?.data?.triggeredAt;
        if (typeof processedAt !== "number") {
          return;
        }
        const pendingIds = snapshot
          .filter((item) => typeof item.processedAt !== "number")
          .map((item) => item.id);
        for (const item of snapshot) {
          if (pendingIds.includes(item.id)) {
            item.processedAt = processedAt;
          }
        }
        for (const item of activities) {
          if (pendingIds.includes(item.id)) {
            item.processedAt = processedAt;
          }
        }
        if (callCount === 1) {
          activities.push(...createActivities(21, 20, 3000));
        }
      },
    );

    mockNowSequence([2000, 4000, 5000, 6000]);

    await runActorBackgroundJob(server as any, memoryRollupJob("threshold"));

    expect(callCount).toBe(2);
    expect(
      activities.every((item) => typeof item.processedAt === "number"),
    ).toBe(true);
  });

  test("non-threshold memory rollup relies on the agent run to finish internal get_tasks loops", async () => {
    const activities = createActivities(1, 20, 1000);
    const server = createFakeServer([], activities);

    let callCount = 0;
    vi.spyOn(Agent.prototype, "runWithState").mockImplementation(
      async (state) => {
        callCount += 1;
        if (callCount !== 1) {
          return;
        }
        const snapshot = Array.isArray(
          state.toolContext?.data?.activitySnapshot,
        )
          ? (state.toolContext.data.activitySnapshot as ShortTermMemoryRecord[])
          : [];
        const processedAt = state.toolContext?.data?.triggeredAt;
        if (typeof processedAt !== "number") {
          return;
        }
        for (const item of snapshot) {
          item.processedAt = processedAt;
        }
        for (const item of activities) {
          item.processedAt = processedAt;
        }
        if (state.toolContext?.data) {
          state.toolContext.data.memoryUpdated = true;
        }
      },
    );

    await runActorBackgroundJob(server as any, memoryRollupJob("dayend"));

    expect(callCount).toBe(1);
  });
});
