import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../llm", () => ({
  LLMClient: class LLMClient {},
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

import { Agent } from "../../agent";
import {
  runActorBackgroundJob,
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

type FakeServer = {
  dbService: {
    getActorLLMConfig: (actorId: number) => Promise<Record<string, unknown>>;
  };
  memoryManager: FakeMemoryManager;
};

function createFakeServer(
  bufferedMessages: BufferedMessageRecord[] = [],
  activities: ShortTermMemoryRecord[] = [],
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
    dbService: {
      async getActorLLMConfig() {
        return {};
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
