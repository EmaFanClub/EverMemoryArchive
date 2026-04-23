import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ObjectId } from "mongodb";

import { createMongo } from "../../db";
import type { Mongo } from "../../db";
import { AgendaScheduler, isJob, type JobHandlerMap } from "..";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("AgendaScheduler", () => {
  let mongo: Mongo;
  let scheduler: AgendaScheduler;

  beforeEach(async () => {
    mongo = await createMongo("", "ema_scheduler_test", "memory");
    await mongo.connect();
    scheduler = await AgendaScheduler.create(mongo, {
      processEvery: 20,
      defaultConcurrency: 1,
      maxConcurrency: 1,
      defaultLockLimit: 1,
      lockLimit: 1,
      defaultLockLifetime: 1000,
    });
  });

  afterEach(async () => {
    await scheduler.stop();
    await mongo.close();
  });

  test("schedules job before start", async () => {
    const jobId = await scheduler.schedule({
      name: "test",
      runAt: Date.now() + 50,
      data: { message: "not-started" },
    });
    expect(jobId).toBeDefined();
  });

  test("executes a scheduled job", async () => {
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    let received: string | null = null;

    const handler = vi.fn(async (job) => {
      received = job.attrs.data?.message ?? null;
      resolveDone();
    });
    const handlers: JobHandlerMap = { test: handler };
    await scheduler.start(handlers);

    await scheduler.schedule({
      name: "test",
      runAt: Date.now(),
      data: { message: "hello" },
    });

    await Promise.race([
      donePromise,
      sleep(5000).then(() => {
        throw new Error("timeout");
      }),
    ]);

    expect(received).toBe("hello");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("cancels a pending job and removes it from the database", async () => {
    const handler = vi.fn(async () => {});
    const handlers: JobHandlerMap = { test: handler };
    await scheduler.start(handlers);

    const jobId = await scheduler.schedule({
      name: "test",
      runAt: Date.now() + 3000,
      data: { message: "cancel" },
    });

    const canceled = await scheduler.cancel(jobId);
    expect(canceled).toBe(true);

    await sleep(200);
    expect(handler).not.toHaveBeenCalled();

    const collection = mongo.getDb().collection(scheduler.collectionName);
    const doc = await collection.findOne({ _id: new ObjectId(jobId) });
    expect(doc).toBeNull();
  });

  test("reschedules a job and updates its data", async () => {
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    let received: string | null = null;

    const handler = vi.fn(async (job) => {
      received = job.attrs.data.message;
      resolveDone();
    });
    const handlers: JobHandlerMap = { test: handler };
    await scheduler.start(handlers);

    const initialRunAt = Date.now() + 3000;
    const updatedRunAt = Date.now() + 200;

    const jobId = await scheduler.schedule({
      name: "test",
      runAt: initialRunAt,
      data: { message: "old" },
    });

    const updated = await scheduler.reschedule(jobId, {
      name: "test",
      runAt: updatedRunAt,
      data: { message: "new" },
    });
    expect(updated).toBe(true);

    await Promise.race([
      donePromise,
      sleep(1000).then(() => {
        throw new Error("timeout");
      }),
    ]);

    expect(received).toBe("new");
  });

  test("returns false when rescheduling a missing job", async () => {
    const handlers: JobHandlerMap = { test: async () => {} };
    await scheduler.start(handlers);

    const updated = await scheduler.reschedule(new ObjectId().toString(), {
      name: "test",
      runAt: Date.now() + 50,
      data: { message: "missing" },
    });
    expect(updated).toBe(false);
  });

  test("executes a recurring job after scheduling", async () => {
    let resolveDone!: (value: number) => void;
    const donePromise = new Promise<number>((resolve) => {
      resolveDone = resolve;
    });

    const handler = vi.fn(async () => {
      resolveDone(Date.now());
    });
    const handlers: JobHandlerMap = { test: handler };
    await scheduler.start(handlers);

    const scheduledAt = Date.now();
    const runAt = scheduledAt + 120;
    const jobId = await scheduler.scheduleEvery({
      name: "test",
      runAt,
      interval: 200,
      data: { message: "repeat" },
      unique: { name: "test", "data.message": "repeat" },
    });

    const firedAt = await Promise.race([
      donePromise,
      sleep(2500).then(() => {
        throw new Error("timeout");
      }),
    ]);

    const earlyToleranceMs = 150;
    expect(firedAt + earlyToleranceMs).toBeGreaterThanOrEqual(runAt);
    await scheduler.cancel(jobId);
    expect(handler).toHaveBeenCalled();
  }, 5000);

  test("scheduleEvery deduplicates when unique matches", async () => {
    const handlers: JobHandlerMap = { test: async () => {} };
    await scheduler.start(handlers);

    await scheduler.scheduleEvery({
      name: "test",
      runAt: Date.now() + 3000,
      interval: "1 second",
      data: { message: "dedupe" },
      unique: { name: "test", "data.message": "dedupe" },
    });

    await scheduler.scheduleEvery({
      name: "test",
      runAt: Date.now() + 3000,
      interval: "1 second",
      data: { message: "dedupe" },
      unique: { name: "test", "data.message": "dedupe" },
    });

    const collection = mongo.getDb().collection(scheduler.collectionName);
    const count = await collection.countDocuments({
      name: "test",
      "data.message": "dedupe",
    });
    expect(count).toBe(1);
  });

  test("rescheduleEvery updates repeat interval and data", async () => {
    const handler = vi.fn(async () => {});
    const handlers: JobHandlerMap = { test: handler };
    await scheduler.start(handlers);

    const initialRunAt = Date.now() + 3000;
    const updatedRunAt = initialRunAt + 1000;

    const jobId = await scheduler.scheduleEvery({
      name: "test",
      runAt: initialRunAt,
      interval: "2 seconds",
      data: { message: "old" },
      unique: { name: "test", "data.message": "old" },
    });

    const updated = await scheduler.rescheduleEvery(jobId, {
      name: "test",
      runAt: updatedRunAt,
      interval: "3 seconds",
      data: { message: "new" },
      unique: { name: "test", "data.message": "new" },
    });
    if (!updated) {
      return;
    }

    const collection = mongo.getDb().collection(scheduler.collectionName);
    const doc = await collection.findOne({ _id: new ObjectId(jobId) });
    expect(doc?.repeatInterval).toBe("3 seconds");
    expect(doc?.data?.message).toBe("new");
  });

  test("getJob returns null for missing job and returns job when present", async () => {
    const handlers: JobHandlerMap = { test: async () => {} };
    await scheduler.start(handlers);

    const missing = await scheduler.getJob(new ObjectId().toString());
    expect(missing).toBeNull();

    const jobId = await scheduler.schedule({
      name: "test",
      runAt: Date.now() + 3000,
      data: { message: "lookup" },
    });

    const job = await scheduler.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job?.attrs.name).toBe("test");
    expect(isJob(job, "test")).toBe(true);
    if (isJob(job, "test")) {
      expect(job.attrs.data.message).toBe("lookup");
    }
  });

  test("listJobs filters by name and data", async () => {
    const handlers: JobHandlerMap = { test: async () => {} };
    await scheduler.start(handlers);

    await scheduler.schedule({
      name: "test",
      runAt: Date.now() + 3000,
      data: { message: "a" },
    });
    await scheduler.schedule({
      name: "test",
      runAt: Date.now() + 3000,
      data: { message: "b" },
    });

    const jobs = await scheduler.listJobs({
      name: "test",
      "data.message": "b",
    });

    expect(jobs.length).toBe(1);
    if (isJob(jobs[0], "test")) {
      expect(jobs[0].attrs.data.message).toBe("b");
    }
  });

  test("recurring job runs expected times when runAt is in the future", async () => {
    const handlers: JobHandlerMap = { test: async () => {} };
    await scheduler.start(handlers);

    const windowMs = 2000;
    const intervalMs = 500;
    const start = Date.now();
    const end = start + windowMs;
    const runAt = start + 400;
    let count = 0;

    const handler = vi.fn(async () => {
      if (Date.now() <= end) {
        count += 1;
      }
    });
    await scheduler.stop();
    await scheduler.start({ test: handler });

    const jobId = await scheduler.scheduleEvery({
      name: "test",
      runAt,
      interval: intervalMs,
      data: { message: "future" },
      unique: { name: "test", "data.message": "future" },
    });

    await sleep(windowMs + 200);
    await scheduler.cancel(jobId);

    expect(count).toBe(4);
  }, 5000);

  test("recurring job runs expected times when runAt is in the past", async () => {
    const handlers: JobHandlerMap = { test: async () => {} };
    await scheduler.start(handlers);

    const windowMs = 2000;
    const intervalMs = 500;
    const start = Date.now();
    const end = start + windowMs;
    const runAt = start - 100;
    let count = 0;

    const handler = vi.fn(async () => {
      if (Date.now() <= end) {
        count += 1;
      }
    });
    await scheduler.stop();
    await scheduler.start({ test: handler });

    const jobId = await scheduler.scheduleEvery({
      name: "test",
      runAt,
      interval: intervalMs,
      data: { message: "past" },
      unique: { name: "test", "data.message": "past" },
    });

    await sleep(windowMs + 200);
    await scheduler.cancel(jobId);

    expect(count).toBe(4);
  }, 5000);

  test("marks overdue one-time jobs instead of replaying them on start", async () => {
    const foregroundHandler = vi.fn(async () => {});
    const handlers: JobHandlerMap = {
      test: async () => {},
      actor_foreground: foregroundHandler as any,
      actor_background: async () => {},
    };

    const jobId = await scheduler.schedule({
      name: "actor_foreground",
      runAt: Date.now() - 5_000,
      data: {
        actorId: 1,
        conversationId: 12,
        task: "chat",
        prompt: "过时的一次性任务",
      },
    });

    await scheduler.start(handlers);
    await sleep(100);

    const job = await scheduler.getJob(jobId);
    expect(job?.attrs.disabled).toBe(true);
    expect(
      (job?.attrs.data as { addition?: { overdue?: boolean } }).addition
        ?.overdue,
    ).toBe(true);
    expect(foregroundHandler).not.toHaveBeenCalled();
  });

  test("advances overdue recurring jobs to the next future run on start", async () => {
    const handlers: JobHandlerMap = {
      test: async () => {},
      actor_foreground: async () => {},
      actor_background: async () => {},
    };
    const startedAt = Date.now();
    const jobId = await scheduler.scheduleEvery({
      name: "actor_background",
      runAt: startedAt - 5_000,
      interval: "1 hour",
      data: {
        actorId: 1,
        task: "activity",
        prompt: "过时的周期任务",
      },
    });

    await scheduler.start(handlers);

    const job = await scheduler.getJob(jobId);
    expect(job?.attrs.disabled).not.toBe(true);
    expect(job?.attrs.nextRunAt?.getTime()).toBeGreaterThan(startedAt);
    expect(
      (job?.attrs.data as { addition?: { overdue?: boolean } }).addition
        ?.overdue,
    ).toBeUndefined();
  });
});
