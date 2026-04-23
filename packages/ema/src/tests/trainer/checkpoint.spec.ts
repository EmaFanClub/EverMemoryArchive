import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as lancedb from "@lancedb/lancedb";

import { buildTrainingCheckpointSnapshot } from "../../trainer/checkpoint";
import { MemoryManager } from "../../memory/manager";
import type { Server } from "../../server";
import { createMongo, DBService, type Mongo } from "../../db";
import { loadTestGlobalConfig } from "../helpers/config";

describe("buildTrainingCheckpointSnapshot", () => {
  let mongo: Mongo;
  let lance: lancedb.Connection;
  let dbService: DBService;

  beforeEach(async () => {
    const fs = await loadTestGlobalConfig();
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    lance = await lancedb.connect("memory://ema-checkpoint");
    dbService = DBService.createSync(fs, mongo, lance);
  });

  afterEach(async () => {
    await mongo.close();
    await lance.close();
  });

  test("preserves all short-term memory buckets in checkpoint snapshots", async () => {
    const roleId = await dbService.roleDB.upsertRole({
      name: "EMA",
      prompt: "role-book",
    });
    await dbService.actorDB.upsertActor({ id: 1, roleId });

    const memoryManager = new MemoryManager({ dbService } as Server);
    await memoryManager.appendShortTermMemory(1, {
      kind: "activity",
      date: "2026-04-01",
      memory: "activity-1",
      createdAt: 1_700_000_000_000,
    });
    await memoryManager.appendShortTermMemory(1, {
      kind: "day",
      date: "2026-04-01",
      memory: "day-1",
      createdAt: 1_700_000_000_000,
    });
    await memoryManager.appendShortTermMemory(1, {
      kind: "day",
      date: "2026-04-02",
      memory: "day-2",
      createdAt: 1_700_086_400_000,
    });
    await memoryManager.appendShortTermMemory(1, {
      kind: "month",
      date: "2026-04",
      memory: "month-1",
      createdAt: 1_700_000_000_000,
    });

    const snapshot = await buildTrainingCheckpointSnapshot(
      { dbService } as Server,
      1,
    );

    expect(snapshot.shortTermMemory.activity).toMatchObject([
      {
        actorId: 1,
        kind: "activity",
        date: "2026-04-01",
        memory: "activity-1",
      },
    ]);
    expect(snapshot.shortTermMemory.day.map((item) => item.memory)).toEqual([
      "day-1",
      "day-2",
    ]);
    expect(snapshot.shortTermMemory.month).toMatchObject([
      {
        actorId: 1,
        kind: "month",
        date: "2026-04",
        memory: "month-1",
      },
    ]);
    expect(snapshot.shortTermMemory.year).toEqual([]);
  });
});
