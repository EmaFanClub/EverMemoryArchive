import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createMongo, MongoTokenUsageDB } from "../..";
import type { Mongo, TokenUsageRecordEntity } from "../..";

describe("MongoTokenUsageDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoTokenUsageDB;

  beforeEach(async () => {
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoTokenUsageDB(mongo);
  });

  afterEach(async () => {
    await mongo.close();
  });

  test("summarizes actor usage by total, source, and day", async () => {
    const records: TokenUsageRecordEntity[] = [
      {
        actorId: 1,
        createdAt: localTimestamp(2026, 5, 27, 1),
        source: "chat",
        conversationId: 10,
        model: "gpt-5.5",
        cacheReadTokens: 1,
        cacheWriteTokens: 2,
        outputTokens: 3,
        totalTokens: 6,
      },
      {
        actorId: 1,
        createdAt: localTimestamp(2026, 5, 27, 2),
        source: "activity",
        model: "gpt-5.5",
        cacheReadTokens: 4,
        cacheWriteTokens: 5,
        outputTokens: 6,
        totalTokens: 15,
      },
      {
        actorId: 1,
        createdAt: localTimestamp(2026, 5, 28, 1),
        source: "chat",
        conversationId: 10,
        model: "gpt-5.5",
        cacheReadTokens: 7,
        cacheWriteTokens: 8,
        outputTokens: 9,
        totalTokens: 24,
      },
      {
        actorId: 2,
        createdAt: localTimestamp(2026, 5, 27, 1),
        source: "chat",
        conversationId: 20,
        model: "gpt-5.5",
        cacheReadTokens: 100,
        cacheWriteTokens: 100,
        outputTokens: 100,
        totalTokens: 300,
      },
    ];
    for (const record of records) {
      await db.createTokenUsageRecord(record);
    }

    const summary = await db.summarizeActorTokenUsage({ actorId: 1 });

    expect(summary.total).toEqual({
      cacheReadTokens: 12,
      cacheWriteTokens: 15,
      outputTokens: 18,
      totalTokens: 45,
    });
    expect(summary.bySource).toEqual([
      {
        source: "chat",
        cacheReadTokens: 8,
        cacheWriteTokens: 10,
        outputTokens: 12,
        totalTokens: 30,
      },
      {
        source: "activity",
        cacheReadTokens: 4,
        cacheWriteTokens: 5,
        outputTokens: 6,
        totalTokens: 15,
      },
    ]);
    expect(summary.byDay).toEqual([
      {
        date: "2026-05-27",
        cacheReadTokens: 5,
        cacheWriteTokens: 7,
        outputTokens: 9,
        totalTokens: 21,
      },
      {
        date: "2026-05-28",
        cacheReadTokens: 7,
        cacheWriteTokens: 8,
        outputTokens: 9,
        totalTokens: 24,
      },
    ]);
  });

  test("deletes token usage records by actor id", async () => {
    await db.createTokenUsageRecord({
      actorId: 1,
      createdAt: localTimestamp(2026, 1, 1, 1),
      source: "chat",
      model: "gpt-5.5",
      cacheReadTokens: 1,
      cacheWriteTokens: 1,
      outputTokens: 1,
      totalTokens: 3,
    });
    await db.createTokenUsageRecord({
      actorId: 2,
      createdAt: localTimestamp(2026, 1, 2, 1),
      source: "chat",
      model: "gpt-5.5",
      cacheReadTokens: 2,
      cacheWriteTokens: 2,
      outputTokens: 2,
      totalTokens: 6,
    });

    await expect(db.deleteTokenUsageRecordsByActorId(1)).resolves.toBe(1);
    await expect(db.summarizeActorTokenUsage({ actorId: 1 })).resolves.toEqual({
      total: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      bySource: [],
      byDay: [],
    });
    await expect(db.summarizeActorTokenUsage({ actorId: 2 })).resolves.toEqual({
      total: {
        cacheReadTokens: 2,
        cacheWriteTokens: 2,
        outputTokens: 2,
        totalTokens: 6,
      },
      bySource: [
        {
          source: "chat",
          cacheReadTokens: 2,
          cacheWriteTokens: 2,
          outputTokens: 2,
          totalTokens: 6,
        },
      ],
      byDay: [
        {
          date: "2026-01-02",
          cacheReadTokens: 2,
          cacheWriteTokens: 2,
          outputTokens: 2,
          totalTokens: 6,
        },
      ],
    });
  });
});

function localTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
): number {
  return new Date(year, month - 1, day, hour).getTime();
}
