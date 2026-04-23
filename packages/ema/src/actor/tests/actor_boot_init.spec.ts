import { describe, expect, test, vi, beforeEach } from "vitest";

const { runActorBackgroundJob } = vi.hoisted(() => ({
  runActorBackgroundJob: vi.fn(async () => {}),
}));

vi.mock("../../scheduler/jobs/actor.job", () => ({
  runActorBackgroundJob,
}));

vi.mock("../../logger", () => ({
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
    lastRunAt?: string | null;
    nextRunAt?: string | null;
  }>,
) {
  const server = {
    getActorScheduler: vi.fn().mockReturnValue({
      list: vi.fn().mockResolvedValue({
        overdue: [],
        upcoming: [],
        recurring: recurring.map((item, index) => ({
          id: `job-${index + 1}`,
          type: "every" as const,
          task: item.task,
          interval: "0 8 * * *",
          lastRunAt: item.lastRunAt ?? null,
          nextRunAt: item.nextRunAt ?? null,
          conversationId: null,
          prompt: "",
          addition: {},
        })),
      }),
    }),
  };
  return new (Actor as any)(1, server);
}

describe("Actor boot init", () => {
  beforeEach(() => {
    runActorBackgroundJob.mockClear();
  });

  test("runs wake when routine schedules are missing", async () => {
    const actor = createActor([]);

    await actor.runBootInit();

    const calls = runActorBackgroundJob.mock.calls as unknown as Array<
      [unknown, { task: string }]
    >;
    expect(runActorBackgroundJob).toHaveBeenCalledTimes(2);
    expect(calls[0]![1].task).toBe("memory_rollup");
    expect(calls[1]![1].task).toBe("wake");
  });

  test("skips wake when the latest routine boundary is sleep", async () => {
    const actor = createActor([
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

    const calls = runActorBackgroundJob.mock.calls as unknown as Array<
      [unknown, { task: string }]
    >;
    expect(runActorBackgroundJob).toHaveBeenCalledTimes(1);
    expect(calls[0]![1].task).toBe("memory_rollup");
  });

  test("runs wake when only wake has lastRunAt", async () => {
    const actor = createActor([
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
    expect(runActorBackgroundJob).toHaveBeenCalledTimes(2);
    expect(calls[0]![1].task).toBe("memory_rollup");
    expect(calls[1]![1].task).toBe("wake");
  });
});
