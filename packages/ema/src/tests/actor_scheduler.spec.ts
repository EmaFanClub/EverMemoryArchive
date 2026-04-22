import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createMongo, type Mongo } from "../db";
import { ActorScheduler, AgendaScheduler } from "../scheduler";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("ActorScheduler", () => {
  let mongo: Mongo;
  let scheduler: AgendaScheduler;

  beforeEach(async () => {
    mongo = await createMongo("", "ema_actor_scheduler_test", "memory");
    await mongo.connect();
    scheduler = await AgendaScheduler.create(mongo, {
      processEvery: 20,
    });
  });

  afterEach(async () => {
    await scheduler.stop();
    await mongo.close();
  });

  test("adds, lists, updates, and deletes actor-owned schedules", async () => {
    const actorScheduler = new ActorScheduler(scheduler, 1);
    const now = Date.now();

    const created = await actorScheduler.add([
      {
        type: "once",
        task: "chat",
        runAt: now + 60_000,
        conversationId: 12,
        prompt: "在早上主动打个招呼。",
        addition: { source: "test" },
      },
      {
        type: "every",
        task: "activity",
        runAt: now + 120_000,
        interval: 3_600_000,
        prompt: "记录一条轻量后台活动。",
      },
    ]);

    await scheduler.schedule({
      name: "actor_background",
      runAt: now + 180_000,
      data: {
        actorId: 1,
        task: "memory_rollup",
        prompt: "internal",
      },
    });
    await scheduler.schedule({
      name: "actor_foreground",
      runAt: now + 180_000,
      data: {
        actorId: 2,
        conversationId: 99,
        task: "chat",
        prompt: "other actor",
      },
    });

    const listed = await actorScheduler.list(now);
    expect(listed.overdue).toEqual([]);
    expect(listed.upcoming).toHaveLength(1);
    expect(listed.recurring).toHaveLength(1);
    expect(listed.upcoming[0]).toMatchObject({
      task: "chat",
      conversationId: 12,
      prompt: "在早上主动打个招呼。",
      addition: { source: "test" },
    });
    expect(listed.recurring[0]).toMatchObject({
      task: "activity",
      conversationId: null,
      prompt: "记录一条轻量后台活动。",
      interval: 3_600_000,
    });

    const updated = await actorScheduler.update([
      {
        id: created.added[0].id,
        runAt: now + 240_000,
        prompt: "在中午主动打个招呼。",
        addition: { source: "updated" },
      },
    ]);
    expect(updated.updated[0]).toMatchObject({
      id: created.added[0].id,
      type: "once",
      task: "chat",
      prompt: "在中午主动打个招呼。",
      conversationId: 12,
      addition: { source: "updated" },
    });

    const deleted = await actorScheduler.delete([created.added[1].id]);
    expect(deleted.deletedIds).toEqual([created.added[1].id]);

    const afterDelete = await actorScheduler.list(now);
    expect(afterDelete.upcoming).toHaveLength(1);
    expect(afterDelete.recurring).toHaveLength(0);
  });

  test("re-enables overdue one-time schedules after update", async () => {
    const handlers = {
      actor_foreground: async () => {},
      actor_background: async () => {},
      test: async () => {},
    } as const;
    const actorScheduler = new ActorScheduler(scheduler, 1);
    const jobId = await scheduler.schedule({
      name: "actor_foreground",
      runAt: Date.now() - 5_000,
      data: {
        actorId: 1,
        conversationId: 12,
        task: "chat",
        prompt: "已经过期的打招呼。",
      },
    });

    await scheduler.start(handlers);

    const listed = await actorScheduler.list(Date.now());
    expect(listed.overdue).toHaveLength(1);
    expect(listed.overdue[0].id).toBe(jobId);
    expect(listed.overdue[0].addition.overdue).toBe(true);

    const updated = await actorScheduler.update([
      {
        id: jobId,
        runAt: Date.now() + 60_000,
        prompt: "改成之后再打招呼。",
      },
    ]);
    expect(updated.updated[0]).toMatchObject({
      id: jobId,
      type: "once",
      prompt: "改成之后再打招呼。",
    });
    expect(updated.updated[0].addition.overdue).toBeUndefined();

    const job = await scheduler.getJob(jobId);
    expect(job?.attrs.disabled).toBe(false);
    const relisted = await actorScheduler.list(Date.now());
    expect(listed.overdue).toHaveLength(1);
    expect(relisted.overdue).toHaveLength(0);
    expect(relisted.upcoming.map((item) => item.id)).toContain(jobId);
  });
  test("keeps overdue one-time schedules disabled when only metadata changes", async () => {
    const foregroundHandler = vi.fn(async () => {});
    const handlers = {
      actor_foreground: foregroundHandler,
      actor_background: async () => {},
      test: async () => {},
    } as const;
    const actorScheduler = new ActorScheduler(scheduler, 1);
    const jobId = await scheduler.schedule({
      name: "actor_foreground",
      runAt: Date.now() - 5_000,
      data: {
        actorId: 1,
        conversationId: 12,
        task: "chat",
        prompt: "已经过期的打招呼。",
      },
    });

    await scheduler.start(handlers);

    const updated = await actorScheduler.update([
      {
        id: jobId,
        prompt: "只改提示词，不改时间。",
        addition: { source: "review-fix" },
      },
    ]);

    expect(updated.updated[0]).toMatchObject({
      id: jobId,
      type: "once",
      prompt: "只改提示词，不改时间。",
      addition: {
        source: "review-fix",
        overdue: true,
      },
    });

    await sleep(100);

    expect(foregroundHandler).not.toHaveBeenCalled();
    const job = await scheduler.getJob(jobId);
    expect(job?.attrs.disabled).toBe(true);

    const listed = await actorScheduler.list(Date.now());
    expect(listed.overdue).toHaveLength(1);
    expect(listed.overdue[0]).toMatchObject({
      id: jobId,
      prompt: "只改提示词，不改时间。",
      addition: {
        source: "review-fix",
        overdue: true,
      },
    });
  });

  test("reuses existing recurring wake schedules instead of creating duplicates", async () => {
    const actorScheduler = new ActorScheduler(scheduler, 1);
    const now = Date.now();

    const first = await actorScheduler.add([
      {
        task: "wake",
        interval: "0 8 * * *",
      },
    ]);
    const second = await actorScheduler.add([
      {
        task: "wake",
        interval: "0 9 * * *",
      },
    ]);

    expect(second.added[0].id).toBe(first.added[0].id);
    const listed = await actorScheduler.list(now);
    const wakeSchedules = listed.recurring.filter(
      (item) => item.task === "wake",
    );
    expect(wakeSchedules).toHaveLength(1);
    expect(wakeSchedules[0]).toMatchObject({
      id: first.added[0].id,
      interval: "0 9 * * *",
    });
  });

  test("rejects invalid recurring wake interval before writing job", async () => {
    const actorScheduler = new ActorScheduler(scheduler, 1);

    await expect(
      actorScheduler.add([
        {
          task: "wake",
          interval: "07:30",
        },
      ]),
    ).rejects.toThrow("cron");

    const listed = await actorScheduler.list();
    expect(listed.recurring).toHaveLength(0);
  });

  test("rejects cron expressions that Agenda cannot compute", async () => {
    const actorScheduler = new ActorScheduler(scheduler, 1);

    await expect(
      actorScheduler.add([
        {
          task: "wake",
          interval: "0 0 31 2 *",
        },
      ]),
    ).rejects.toThrow("cron");

    const listed = await actorScheduler.list();
    expect(listed.recurring).toHaveLength(0);
  });

  test("allows recurring chat cron schedules without runAt", async () => {
    const actorScheduler = new ActorScheduler(scheduler, 1);

    const created = await actorScheduler.add([
      {
        type: "every",
        task: "chat",
        interval: "0 9 * * *",
        conversationId: 12,
        prompt: "每天上午问候。",
      },
    ]);

    const listed = await actorScheduler.list();
    expect(listed.recurring).toHaveLength(1);
    expect(listed.recurring[0]).toMatchObject({
      id: created.added[0].id,
      task: "chat",
      interval: "0 9 * * *",
      conversationId: 12,
      prompt: "每天上午问候。",
    });
    expect(listed.recurring[0].nextRunAt).not.toBeNull();
  });

  test("rejects recurring chat cron schedules with runAt", async () => {
    const actorScheduler = new ActorScheduler(scheduler, 1);

    await expect(
      actorScheduler.add([
        {
          type: "every",
          task: "chat",
          runAt: Date.now() + 60_000,
          interval: "0 9 * * *",
          conversationId: 12,
          prompt: "每天上午问候。",
        } as any,
      ]),
    ).rejects.toThrow("runAt");
  });

  test("rejects numeric recurring chat interval updates without runAt", async () => {
    const actorScheduler = new ActorScheduler(scheduler, 1);
    const created = await actorScheduler.add([
      {
        type: "every",
        task: "chat",
        runAt: Date.now() + 60_000,
        interval: 60_000,
        conversationId: 12,
        prompt: "按固定间隔提醒。",
      },
    ]);

    await expect(
      actorScheduler.update([
        {
          id: created.added[0].id,
          interval: 120_000,
        },
      ]),
    ).rejects.toThrow("runAt");
  });

  test("rejects interval updates for one-time schedules", async () => {
    const actorScheduler = new ActorScheduler(scheduler, 1);
    const created = await actorScheduler.add([
      {
        type: "once",
        task: "activity",
        runAt: Date.now() + 60_000,
        prompt: "记录一次状态。",
      },
    ]);

    await expect(
      actorScheduler.update([
        {
          id: created.added[0].id,
          interval: 60_000,
        },
      ]),
    ).rejects.toThrow("once schedules do not support interval updates");
  });
});
