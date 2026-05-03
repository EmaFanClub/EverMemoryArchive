import { describe, expect, test, vi } from "vitest";

import ScheduleSkill from "..";

function createServerWithScheduler(
  scheduler: Record<string, unknown>,
  conversations: Array<{
    id: number;
    actorId?: number;
    session: string;
    allowProactive?: boolean;
  }> = [],
) {
  return {
    getActorScheduler: vi.fn().mockReturnValue(scheduler),
    dbService: {
      conversationDB: {
        getConversationByActorAndSession: vi.fn(
          async (actorId: number, session: string) =>
            conversations.find(
              (conversation) =>
                (conversation.actorId ?? 1) === actorId &&
                conversation.session === session,
            ) ?? null,
        ),
      },
    },
  };
}

describe("schedule-skill", () => {
  test("parses chat add_schedules and delegates to ActorScheduler", async () => {
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
            session: "web-chat-1",
            prompt: "明早主动打个招呼。",
          },
        ],
      },
      {
        actorId: 1,
        server: createServerWithScheduler({ add }, [
          { id: 12, session: "web-chat-1", allowProactive: true },
        ]) as any,
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
      },
    ]);
    expect(JSON.parse(result.content!)).toEqual({
      added: [{ id: "job-1", type: "once", task: "chat" }],
    });
  });

  test("parses wake add_schedules without runAt and prompt", async () => {
    const add = vi.fn().mockResolvedValue({
      added: [
        { id: "job-2", type: "every", task: "wake", interval: "0 8 * * *" },
      ],
    });
    const skill = new ScheduleSkill(".", "schedule-skill");

    const result = await skill.execute(
      {
        action: "add_schedules",
        items: [
          {
            task: "wake",
            interval: "0 8 * * *",
          },
        ],
      },
      {
        actorId: 1,
        server: createServerWithScheduler({ add }) as any,
      },
    );

    expect(result.success).toBe(true);
    expect(add).toHaveBeenCalledWith([
      {
        task: "wake",
        interval: "0 8 * * *",
      },
    ]);
    expect(JSON.parse(result.content!)).toEqual({
      added: [
        { id: "job-2", type: "every", task: "wake", interval: "0 8 * * *" },
      ],
    });
  });

  test("parses recurring activity with runAt plus interval milliseconds", async () => {
    const add = vi.fn().mockResolvedValue({
      added: [
        {
          id: "job-3",
          type: "every",
          task: "activity",
          interval: 60_000,
          nextRunAt: "2026-04-20 08:30:00",
          lastRunAt: null,
        },
      ],
    });
    const skill = new ScheduleSkill(".", "schedule-skill");

    const result = await skill.execute(
      {
        action: "add_schedules",
        items: [
          {
            type: "every",
            task: "activity",
            runAt: "2026-04-20 08:30:00",
            interval: 60_000,
            prompt: "每隔一分钟记录一次状态。",
          },
        ],
      },
      {
        actorId: 1,
        server: createServerWithScheduler({ add }) as any,
      },
    );

    expect(result.success).toBe(true);
    expect(add).toHaveBeenCalledWith([
      {
        type: "every",
        task: "activity",
        runAt: expect.any(Number),
        interval: 60_000,
        prompt: "每隔一分钟记录一次状态。",
      },
    ]);
    expect(JSON.parse(result.content!)).toEqual({
      added: [
        {
          id: "job-3",
          type: "every",
          task: "activity",
          interval: 60_000,
          nextRunAt: "2026-04-20 08:30:00",
          lastRunAt: null,
        },
      ],
    });
  });

  test("parses recurring chat cron without runAt", async () => {
    const add = vi.fn().mockResolvedValue({
      added: [
        {
          id: "job-cron",
          type: "every",
          task: "chat",
          interval: "0 9 * * *",
          nextRunAt: "2026-04-20 09:00:00",
          lastRunAt: null,
        },
      ],
    });
    const skill = new ScheduleSkill(".", "schedule-skill");

    const result = await skill.execute(
      {
        action: "add_schedules",
        items: [
          {
            type: "every",
            task: "chat",
            interval: "0 9 * * *",
            session: "web-chat-1",
            prompt: "每天上午问候一下。",
          },
        ],
      },
      {
        actorId: 1,
        server: createServerWithScheduler({ add }, [
          { id: 12, session: "web-chat-1", allowProactive: true },
        ]) as any,
      },
    );

    expect(result.success).toBe(true);
    expect(add).toHaveBeenCalledWith([
      {
        type: "every",
        task: "chat",
        interval: "0 9 * * *",
        conversationId: 12,
        prompt: "每天上午问候一下。",
      },
    ]);
  });

  test("rejects recurring chat cron with runAt", async () => {
    const add = vi.fn();
    const skill = new ScheduleSkill(".", "schedule-skill");

    const result = await skill.execute(
      {
        action: "add_schedules",
        items: [
          {
            type: "every",
            task: "chat",
            runAt: "2026-04-20 08:30:00",
            interval: "0 9 * * *",
            session: "web-chat-1",
            prompt: "每天上午问候一下。",
          },
        ],
      },
      {
        actorId: 1,
        server: createServerWithScheduler({ add }) as any,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("runAt");
    expect(add).not.toHaveBeenCalled();
  });

  test("list_schedules hides internal fields and omits wake prompt", async () => {
    const list = vi.fn().mockResolvedValue({
      overdue: [
        {
          id: "job-chat",
          type: "once",
          task: "chat",
          runAt: "2026-04-20 08:30:00",
          conversationId: 12,
          prompt: "打个招呼。",
          addition: { overdue: true },
        },
      ],
      upcoming: [],
      recurring: [
        {
          id: "job-wake",
          type: "every",
          task: "wake",
          nextRunAt: "2026-04-21 08:00:00",
          lastRunAt: "2026-04-20 08:00:00",
          interval: "0 8 * * *",
          conversationId: null,
          prompt: "",
          addition: {},
        },
      ],
    });
    const skill = new ScheduleSkill(".", "schedule-skill");

    const result = await skill.execute(
      { action: "list_schedules" },
      {
        actorId: 1,
        server: createServerWithScheduler({ list }) as any,
      },
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content!)).toEqual({
      overdue: [
        {
          id: "job-chat",
          type: "once",
          task: "chat",
          runAt: "2026-04-20 08:30:00",
          conversationId: 12,
          prompt: "打个招呼。",
        },
      ],
      upcoming: [],
      recurring: [
        {
          id: "job-wake",
          type: "every",
          task: "wake",
          nextRunAt: "2026-04-21 08:00:00",
          lastRunAt: "2026-04-20 08:00:00",
          interval: "0 8 * * *",
        },
      ],
    });
  });

  test("validates that chat schedules require session", async () => {
    const skill = new ScheduleSkill(".", "schedule-skill");

    const result = await skill.execute(
      {
        action: "add_schedules",
        items: [
          {
            type: "once",
            task: "chat",
            runAt: "2026-04-20 08:30:00",
            prompt: "缺少 session。",
          },
        ],
      },
      {
        actorId: 1,
        server: createServerWithScheduler({ add: vi.fn() }) as any,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("session");
  });

  test("rejects chat schedules for unknown sessions", async () => {
    const add = vi.fn();
    const skill = new ScheduleSkill(".", "schedule-skill");

    const result = await skill.execute(
      {
        action: "add_schedules",
        items: [
          {
            type: "once",
            task: "chat",
            runAt: "2026-04-20 08:30:00",
            session: "qq-group-missing",
            prompt: "找不到会话。",
          },
        ],
      },
      {
        actorId: 1,
        server: createServerWithScheduler({ add }) as any,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("qq-group-missing");
    expect(add).not.toHaveBeenCalled();
  });

  test("rejects chat schedules when proactive chat is disabled", async () => {
    const add = vi.fn();
    const skill = new ScheduleSkill(".", "schedule-skill");

    const result = await skill.execute(
      {
        action: "add_schedules",
        items: [
          {
            type: "once",
            task: "chat",
            runAt: "2026-04-20 08:30:00",
            session: "qq-group-123456",
            prompt: "主动问候。",
          },
        ],
      },
      {
        actorId: 1,
        server: createServerWithScheduler({ add }, [
          { id: 12, session: "qq-group-123456", allowProactive: false },
        ]) as any,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("does not allow proactive chat");
    expect(add).not.toHaveBeenCalled();
  });

  test("rejects invalid wake cron interval before scheduling", async () => {
    const add = vi.fn();
    const skill = new ScheduleSkill(".", "schedule-skill");

    const result = await skill.execute(
      {
        action: "add_schedules",
        items: [
          {
            task: "wake",
            interval: "07:30",
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

    expect(result.success).toBe(false);
    expect(result.error).toContain("cron");
    expect(add).not.toHaveBeenCalled();
  });
});
