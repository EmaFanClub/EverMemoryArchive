import { describe, expect, test, vi } from "vitest";

import { ScheduleController } from "../schedule_controller";

function createController(
  recurring: Array<{ task: "sleep" | "wake"; interval: string }>,
) {
  return new ScheduleController({
    getActorScheduler: vi.fn(() => ({
      list: vi.fn(async () => ({
        overdue: [],
        upcoming: [],
        recurring: recurring.map((item, index) => ({
          id: `job-${index + 1}`,
          type: "every" as const,
          task: item.task,
          interval: item.interval,
          nextRunAt: null,
          lastRunAt: null,
          conversationId: null,
          prompt: "",
          addition: {},
        })),
      })),
    })),
  } as never);
}

describe("ScheduleController", () => {
  test("restores sleep schedule across the right edge of the noon-based axis", async () => {
    const controller = createController([
      { task: "sleep", interval: "0 4 * * *" },
      { task: "wake", interval: "0 12 * * *" },
    ]);

    await expect(controller.getSleepScheduleInput(1)).resolves.toEqual({
      startMinutes: 16 * 60,
      endMinutes: 24 * 60,
    });
  });

  test("restores ordinary overnight sleep schedule", async () => {
    const controller = createController([
      { task: "sleep", interval: "0 23 * * *" },
      { task: "wake", interval: "0 7 * * *" },
    ]);

    await expect(controller.getSleepScheduleInput(1)).resolves.toEqual({
      startMinutes: 11 * 60,
      endMinutes: 19 * 60,
    });
  });
});
