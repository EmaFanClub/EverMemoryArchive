import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as lancedb from "@lancedb/lancedb";

import { ActorTrainer } from "../../trainer/actor_trainer";
import { Server } from "../../server";
import { MemFs } from "../../fs";
import { createMongo, type Mongo } from "../../db";
import { MemoryManager } from "../../memory/manager";
import { parseTimestamp } from "../../utils";
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

function createStubTrainingServer(events: string[]) {
  let messageCount = 0;
  return {
    actorDB: {
      getActor: async () => ({ id: 1, roleId: null }),
    },
    memoryManager: {
      persistChatMessage: async (message: { msgId: number }) => {
        events.push(`add:${message.msgId}`);
        messageCount += 1;
      },
      addToBuffer: async () => {},
      addShortTermMemory: async (actorId: number, item: { kind: string }) => {
        events.push(`blank:${actorId}:${item.kind}`);
      },
      upsertRolePrompt: async () => {},
    },
    createConversation: async () => ({ id: 1 }),
  };
}

describe("ActorTrainer", () => {
  let mongo: Mongo;
  let lance: lancedb.Connection;
  let server: Server;

  beforeEach(async () => {
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    lance = await lancedb.connect("memory://ema-trainer");
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

  test("normalizes raw script lines into session-scoped chat inputs", () => {
    const trainer = new ActorTrainer(server, new MemFs());
    const trainingSession = "train-1-123";

    const normalized = (trainer as any).normalizeInputs(
      [
        {
          name: "EMA",
          time: "2024-01-02 10:00:00",
          content: "I am here.",
        },
        {
          name: "Alice",
          time: "2024-01-02 09:00:00",
          content: "Hello!",
        },
      ],
      trainingSession,
      1,
    );

    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toMatchObject({
      kind: "chat",
      conversationId: 1,
      msgId: 1,
      channelMessageId: "1:1",
      time: parseTimestamp("YYYY-MM-DD HH:mm:ss", "2024-01-02 09:00:00"),
      speaker: {
        session: trainingSession,
        uid: "Alice",
        name: "Alice",
      },
      inputs: [{ type: "text", text: "Hello!" }],
    });
    expect(normalized[1]).toMatchObject({
      kind: "chat",
      conversationId: 1,
      msgId: 2,
      channelMessageId: "1:2",
      time: parseTimestamp("YYYY-MM-DD HH:mm:ss", "2024-01-02 10:00:00"),
      speaker: {
        session: trainingSession,
        uid: "EMA",
        name: "EMA",
      },
      inputs: [{ type: "text", text: "I am here." }],
    });
  });

  test("classifies actor turns using the character name as uid", () => {
    const trainer = new ActorTrainer(server, new MemFs());
    const trainingSession = "train-1-123";
    const actorUid = "EMA";
    const normalized = (trainer as any).normalizeInputs(
      [
        {
          name: "Alice",
          time: "2024-01-02 09:00:00",
          content: "Hello!",
        },
        {
          name: "EMA",
          time: "2024-01-02 10:00:00",
          content: "I am here.",
        },
      ],
      trainingSession,
      1,
    );

    const userMessage = (trainer as any).toPersistedMessage(
      normalized[0],
      actorUid,
      1,
    );
    const actorMessage = (trainer as any).toPersistedMessage(
      normalized[1],
      actorUid,
      1,
    );

    expect(userMessage).toMatchObject({
      kind: "chat",
      speaker: {
        uid: "Alice",
        name: "Alice",
        session: trainingSession,
      },
    });
    expect(actorMessage).toMatchObject({
      kind: "chat",
      actorId: 1,
      conversationId: 1,
      msgId: 2,
      ema_reply: {
        contents: "I am here.",
      },
    });
  });

  test("builds one daily rollup timestamp for each skipped calendar day", () => {
    const trainer = new ActorTrainer(server, new MemFs());

    const timestamps = (trainer as any).buildDailyRollupTimestamps(
      "2024-01-02",
      "2024-01-05",
    );

    expect(timestamps).toEqual([
      parseTimestamp("YYYY-MM-DD HH:mm:ss", "2024-01-03 00:05:00"),
      parseTimestamp("YYYY-MM-DD HH:mm:ss", "2024-01-04 00:05:00"),
      parseTimestamp("YYYY-MM-DD HH:mm:ss", "2024-01-05 00:05:00"),
    ]);
  });

  test("flushes leftover dialogue updates and creates fresh buckets at the end of training", async () => {
    const events: string[] = [];
    const trainer = new ActorTrainer(
      createStubTrainingServer(events) as any,
      new MemFs(),
    );
    vi.spyOn(trainer as any, "runMemoryUpdate").mockImplementation(
      async (...args: unknown[]) => {
        const triggeredAt = args[3] as number;
        const task = args[4] as string;
        events.push(`update:${task}:${triggeredAt}`);
      },
    );
    vi.spyOn(trainer as any, "saveCheckpoint").mockResolvedValue(undefined);

    await trainer.train({
      actorId: 1,
      characterName: "EMA",
      dataset: {
        description: "test",
        inputs: [
          {
            name: "Alice",
            time: "2024-01-02 09:00:00",
            content: "Hello!",
          },
          {
            name: "EMA",
            time: "2024-01-02 09:00:30",
            content: "Hi.",
          },
        ],
      },
      bufferWindowSize: 30,
      diaryUpdateEvery: 3,
      checkpointDir: "/tmp/checkpoints",
    });

    expect(events).toEqual([
      "add:1",
      "add:2",
      `update:dialogue_tick:${parseTimestamp(
        "YYYY-MM-DD HH:mm:ss",
        "2024-01-02 09:00:30",
      )}`,
      "blank:1:day",
      "blank:1:week",
      "blank:1:month",
    ]);
  });

  test("rolls up before the next day and keeps pending dialogue count across days", async () => {
    const events: string[] = [];
    const trainer = new ActorTrainer(
      createStubTrainingServer(events) as any,
      new MemFs(),
    );
    vi.spyOn(trainer as any, "runMemoryUpdate").mockImplementation(
      async (...args: unknown[]) => {
        const triggeredAt = args[3] as number;
        const task = args[4] as string;
        events.push(`update:${task}:${triggeredAt}`);
      },
    );
    vi.spyOn(trainer as any, "saveCheckpoint").mockResolvedValue(undefined);

    await trainer.train({
      actorId: 1,
      characterName: "EMA",
      dataset: {
        description: "test",
        inputs: [
          {
            name: "Alice",
            time: "2024-01-01 10:00:00",
            content: "One",
          },
          {
            name: "EMA",
            time: "2024-01-01 10:00:30",
            content: "Two",
          },
          {
            name: "Alice",
            time: "2024-01-02 09:00:00",
            content: "Three",
          },
        ],
      },
      bufferWindowSize: 30,
      diaryUpdateEvery: 3,
      checkpointDir: "/tmp/checkpoints",
    });

    expect(events).toEqual([
      "add:1",
      "add:2",
      `update:calendar_rollup:${parseTimestamp(
        "YYYY-MM-DD HH:mm:ss",
        "2024-01-02 00:05:00",
      )}`,
      "add:3",
      `update:dialogue_tick:${parseTimestamp(
        "YYYY-MM-DD HH:mm:ss",
        "2024-01-02 09:00:00",
      )}`,
      "blank:1:day",
      "blank:1:week",
      "blank:1:month",
    ]);
  });

  test("runs skipped-day calendar rollups without forcing a dialogue update", async () => {
    const events: string[] = [];
    const trainer = new ActorTrainer(
      createStubTrainingServer(events) as any,
      new MemFs(),
    );
    vi.spyOn(trainer as any, "runMemoryUpdate").mockImplementation(
      async (...args: unknown[]) => {
        const triggeredAt = args[3] as number;
        const task = args[4] as string;
        events.push(`update:${task}:${triggeredAt}`);
      },
    );
    vi.spyOn(trainer as any, "saveCheckpoint").mockResolvedValue(undefined);

    await trainer.train({
      actorId: 1,
      characterName: "EMA",
      dataset: {
        description: "test",
        inputs: [
          {
            name: "Alice",
            time: "2024-01-01 10:00:00",
            content: "One",
          },
          {
            name: "Alice",
            time: "2024-01-04 09:00:00",
            content: "Two",
          },
        ],
      },
      bufferWindowSize: 30,
      diaryUpdateEvery: 3,
      checkpointDir: "/tmp/checkpoints",
    });

    expect(events).toEqual([
      "add:1",
      `update:calendar_rollup:${parseTimestamp(
        "YYYY-MM-DD HH:mm:ss",
        "2024-01-02 00:05:00",
      )}`,
      `update:calendar_rollup:${parseTimestamp(
        "YYYY-MM-DD HH:mm:ss",
        "2024-01-03 00:05:00",
      )}`,
      `update:calendar_rollup:${parseTimestamp(
        "YYYY-MM-DD HH:mm:ss",
        "2024-01-04 00:05:00",
      )}`,
      "add:2",
      `update:dialogue_tick:${parseTimestamp(
        "YYYY-MM-DD HH:mm:ss",
        "2024-01-04 09:00:00",
      )}`,
      "blank:1:day",
      "blank:1:week",
      "blank:1:month",
    ]);
  });
});
