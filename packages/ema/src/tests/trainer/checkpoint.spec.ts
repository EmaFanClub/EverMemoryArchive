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
      server,
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

    await server.memoryManager.appendShortTermMemory(1, {
      kind: "activity",
      date: "2026-04-01",
      memory: "activity-1",
      createdAt: 1_700_000_000_000,
    });
    await server.memoryManager.appendShortTermMemory(1, {
      kind: "day",
      date: "2026-04-01",
      memory: "day-1",
      createdAt: 1_700_000_000_000,
    });
    await server.memoryManager.appendShortTermMemory(1, {
      kind: "day",
      date: "2026-04-02",
      memory: "day-2",
      createdAt: 1_700_086_400_000,
    });
    await server.memoryManager.appendShortTermMemory(1, {
      kind: "month",
      date: "2026-04",
      memory: "month-1",
      createdAt: 1_700_000_000_000,
    });

    const snapshot = await buildTrainingCheckpointSnapshot(server, 1);

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
