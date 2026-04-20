import { describe, expect, test, vi } from "vitest";

import ScheduleSkill from "../../skills/schedule-skill";

describe("schedule-skill", () => {
  test("parses add_schedules and delegates to ActorScheduler", async () => {
    const add = vi.fn().mockResolvedValue({
      added: [{ id: "job-1", type: "once", task: "chat" }],
    });
    const skill = new ScheduleSkill(".", "schedule-skill");

    const result = await skill.execute(
      {
        action: "add_schedules",
        items: [
          {
            type: "once",
            task: "chat",
            runAt: "2026-04-20 08:30:00",
            conversationId: 12,
            prompt: "明早主动打个招呼。",
            addition: { source: "planner" },
          },
        ],
      },
      {
        actorId: 1,
        server: {
          getActorScheduler: vi.fn().mockReturnValue({ add }),
        } as any,
      },
    );

    expect(result.success).toBe(true);
    expect(add).toHaveBeenCalledWith([
      {
        type: "once",
        task: "chat",
        runAt: expect.any(Number),
        conversationId: 12,
        prompt: "明早主动打个招呼。",
        addition: { source: "planner" },
      },
    ]);
    expect(JSON.parse(result.content!)).toEqual({
      added: [{ id: "job-1", type: "once", task: "chat" }],
    });
  });

  test("validates that chat schedules require conversationId", async () => {
    const skill = new ScheduleSkill(".", "schedule-skill");

    const result = await skill.execute(
      {
        action: "add_schedules",
        items: [
          {
            type: "once",
            task: "chat",
            runAt: "2026-04-20 08:30:00",
            prompt: "缺少 conversationId。",
          },
        ],
      },
      {
        actorId: 1,
        server: {
          getActorScheduler: vi.fn(),
        } as any,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("conversationId is required");
  });
});
