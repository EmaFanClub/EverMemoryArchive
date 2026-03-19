import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as lancedb from "@lancedb/lancedb";

import { buildTrainingCheckpointSnapshot } from "../../trainer/checkpoint";
import { Server } from "../../server";
import { MemFs } from "../../fs";
import { createMongo, type Mongo } from "../../db";
import { MemoryManager } from "../../memory/manager";
import {
  Config,
  LLMConfig,
  OpenAIApiConfig,
  GoogleApiConfig,
  AgentConfig,
  ToolsConfig,
  MongoConfig,
  SystemConfig,
} from "../../config";

const createTestConfig = () =>
  new Config(
    new LLMConfig(
      new OpenAIApiConfig("test-openai-key", "https://example.com/openai/v1/"),
      new GoogleApiConfig("test-google-key", "https://example.com/google/v1/"),
    ),
    new AgentConfig(),
    new ToolsConfig(),
    new MongoConfig(),
    new SystemConfig(),
  );

describe("buildTrainingCheckpointSnapshot", () => {
  let mongo: Mongo;
  let lance: lancedb.Connection;
  let server: Server;

  beforeEach(async () => {
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    lance = await lancedb.connect("memory://ema-checkpoint");
    server = Server.createSync(new MemFs(), mongo, lance, createTestConfig());
    server.memoryManager = new MemoryManager(
      server.roleDB,
      server.personalityDB,
      server.actorDB,
      server.userDB,
      server.userOwnActorDB,
      server.externalIdentityBindingDB,
      server.conversationDB,
      server.conversationMessageDB,
      server.shortTermMemoryDB,
      server.longTermMemoryDB,
      server.longTermMemoryVectorSearcher,
    );
  });

  afterEach(async () => {
    await mongo.close();
    await lance.close();
  });

  test("preserves all short-term memory buckets in checkpoint snapshots", async () => {
    const roleId = await server.roleDB.upsertRole({
      name: "EMA",
      prompt: "role-book",
    });
    await server.actorDB.upsertActor({ id: 1, roleId });

    const day1CreatedAt = 1_700_000_000_000;
    const day2CreatedAt = 1_700_086_400_000;
    const week1CreatedAt = 1_700_000_000_000;

    await server.memoryManager.addShortTermMemory(1, {
      kind: "day",
      memory: "day-1",
      createdAt: day1CreatedAt,
    });
    await server.memoryManager.addShortTermMemory(1, {
      kind: "day",
      memory: "day-2",
      createdAt: day2CreatedAt,
    });
    await server.memoryManager.addShortTermMemory(1, {
      kind: "week",
      memory: "week-1",
      createdAt: week1CreatedAt,
    });

    const snapshot = await buildTrainingCheckpointSnapshot(server, 1);

    expect(snapshot.shortTermMemory.day).toHaveLength(2);
    expect(snapshot.shortTermMemory.day.map((item) => item.memory)).toEqual([
      "day-1",
      "day-2",
    ]);
    expect(snapshot.shortTermMemory.day[0]?.createdAt).toBe(day1CreatedAt);
    expect(snapshot.shortTermMemory.day[1]?.createdAt).toBe(day2CreatedAt);

    expect(snapshot.shortTermMemory.week).toMatchObject([
      {
        id: expect.any(Number),
        actorId: 1,
        kind: "week",
        createdAt: week1CreatedAt,
        memory: "week-1",
      },
    ]);
    expect(snapshot.shortTermMemory.month).toEqual([]);
    expect(snapshot.shortTermMemory.year).toEqual([]);
  });
});
