import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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

import { Actor } from "../actor";

function createActor(
  recurring: Array<{
    task: "wake" | "sleep";
    interval?: string | number;
    lastRunAt?: string | null;
    nextRunAt?: string | null;
  }>,
  hasUnprocessedActivityBeforeDay:
    | boolean
    | ((dayDate: string) => boolean) = false,
) {
  const hasUnprocessedActivityBeforeDayMock = vi.fn(
    async (_actorId: number, dayDate: string) =>
      typeof hasUnprocessedActivityBeforeDay === "function"
        ? hasUnprocessedActivityBeforeDay(dayDate)
        : hasUnprocessedActivityBeforeDay,
  );
  const server = {
    controller: {
      chat: {
        publishConversationTyping: vi.fn(async () => null),
      },
      runtime: {
        publishStatus: vi.fn(async () => {}),
      },
    },
    memoryManager: {
      hasUnprocessedActivityBeforeDay: hasUnprocessedActivityBeforeDayMock,
    },
    getActorScheduler: vi.fn().mockReturnValue({
      list: vi.fn().mockResolvedValue({
        overdue: [],
        upcoming: [],
        recurring: recurring.map((item, index) => ({
          id: `job-${index + 1}`,
          type: "every" as const,
          task: item.task,
          interval: item.interval ?? "0 8 * * *",
          lastRunAt: item.lastRunAt ?? null,
          nextRunAt: item.nextRunAt ?? null,
          conversationId: null,
          prompt: "",
          addition: {},
        })),
      }),
    }),
  };
  return {
    actor: new (Actor as any)(1, server),
    hasUnprocessedActivityBeforeDay: hasUnprocessedActivityBeforeDayMock,
  };
}

describe("Actor boot init", () => {
  beforeEach(() => {
    runActorBackgroundJob.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("runs wake without rollup when routine schedules are missing and no old activity exists", async () => {
    const { actor } = createActor([]);

    await actor.runBootInit();

    const calls = runActorBackgroundJob.mock.calls as unknown as Array<
      [unknown, { task: string }]
    >;
    expect(runActorBackgroundJob).toHaveBeenCalledTimes(1);
    expect(calls[0]![1].task).toBe("wake");
  });

  test("runs rollup before wake when waking into a day with old unprocessed activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 10, 0, 0));
    const { actor, hasUnprocessedActivityBeforeDay } = createActor([], true);

    await actor.runBootInit();

    const calls = runActorBackgroundJob.mock.calls as unknown as Array<
      [unknown, { task: string; addition?: Record<string, unknown> }]
    >;
    expect(hasUnprocessedActivityBeforeDay).toHaveBeenCalledWith(
      1,
      "2026-04-22",
    );
    expect(runActorBackgroundJob).toHaveBeenCalledTimes(2);
    expect(calls[0]![1]).toMatchObject({
      task: "memory_rollup",
      addition: { reason: "boot_init", targetDayDate: "2026-04-22" },
    });
    expect(calls[1]![1].task).toBe("wake");
  });

  test("uses current clock to wake when outside the configured sleep window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 10, 0, 0));
    const { actor } = createActor([
      {
        task: "wake",
        interval: "0 7 * * *",
        lastRunAt: "2026-04-21 07:00:00",
        nextRunAt: "2026-04-23 07:00:00",
      },
      {
        task: "sleep",
        interval: "0 23 * * *",
        lastRunAt: "2026-04-21 23:00:00",
        nextRunAt: "2026-04-22 23:00:00",
      },
    ]);

    await actor.runBootInit();

    const calls = runActorBackgroundJob.mock.calls as unknown as Array<
      [unknown, { task: string }]
    >;
    expect(runActorBackgroundJob).toHaveBeenCalledTimes(1);
    expect(calls[0]![1].task).toBe("wake");
  });

  test("uses current clock to stay asleep inside the configured sleep window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 1, 0, 0));
    const { actor } = createActor([
      {
        task: "wake",
        interval: "0 7 * * *",
        lastRunAt: "2026-04-21 07:00:00",
        nextRunAt: "2026-04-22 07:00:00",
      },
      {
        task: "sleep",
        interval: "0 23 * * *",
        lastRunAt: "2026-04-21 23:00:00",
        nextRunAt: "2026-04-22 23:00:00",
      },
    ]);

    await actor.runBootInit();

    expect(runActorBackgroundJob).not.toHaveBeenCalled();
  });

  test("skips wake and rollup when the latest routine boundary is sleep and no old activity exists", async () => {
    const { actor } = createActor([
      {
        task: "wake",
        lastRunAt: "2026-04-21 08:00:00",
        nextRunAt: "2026-04-22 08:00:00",
      },
      {
        task: "sleep",
        lastRunAt: "2026-04-21 23:00:00",
        nextRunAt: "2026-04-22 23:00:00",
      },
    ]);

    await actor.runBootInit();

    expect(runActorBackgroundJob).not.toHaveBeenCalled();
  });

  test("runs rollup while sleeping when old activity exists before the next wake day", async () => {
    const { actor, hasUnprocessedActivityBeforeDay } = createActor(
      [
        {
          task: "wake",
          lastRunAt: "2026-04-21 08:00:00",
          nextRunAt: "2026-04-22 08:00:00",
        },
        {
          task: "sleep",
          lastRunAt: "2026-04-21 23:00:00",
          nextRunAt: "2026-04-22 23:00:00",
        },
      ],
      true,
    );

    await actor.runBootInit();

    const calls = runActorBackgroundJob.mock.calls as unknown as Array<
      [unknown, { task: string; addition?: Record<string, unknown> }]
    >;
    expect(hasUnprocessedActivityBeforeDay).toHaveBeenCalledWith(
      1,
      "2026-04-22",
    );
    expect(runActorBackgroundJob).toHaveBeenCalledTimes(1);
    expect(calls[0]![1]).toMatchObject({
      task: "memory_rollup",
      addition: { reason: "boot_init", targetDayDate: "2026-04-22" },
    });
  });

  test("runs wake when only wake has lastRunAt", async () => {
    const { actor } = createActor([
      {
        task: "wake",
        lastRunAt: "2026-04-21 08:00:00",
        nextRunAt: "2026-04-22 08:00:00",
      },
      {
        task: "sleep",
        nextRunAt: "2026-04-21 23:00:00",
      },
    ]);

    await actor.runBootInit();

    const calls = runActorBackgroundJob.mock.calls as unknown as Array<
      [unknown, { task: string }]
    >;
    expect(runActorBackgroundJob).toHaveBeenCalledTimes(1);
    expect(calls[0]![1].task).toBe("wake");
  });

  test("reports processing only for the currently held conversation", async () => {
    const { actor } = createActor([]);

    expect(actor.isProcessingConversation(1)).toBe(false);

    (actor as any).currentConversationId = 1;
    (actor as any).currentWorker = {
      session: "web-chat-1",
      events: {
        removeAllListeners: vi.fn(),
      },
    };

    expect(actor.isProcessingConversation(1)).toBe(true);
    expect(actor.isProcessingConversation(2)).toBe(false);

    await actor.dispose();

    expect(actor.isProcessingConversation(1)).toBe(false);
  });
});
