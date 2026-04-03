import { afterEach, beforeEach, describe, expect, test } from "vitest";
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

  test("builds the end-of-day memory-update timestamp for a training day", () => {
    const trainer = new ActorTrainer(server, new MemFs());

    const timestamp = (trainer as any).buildMemoryUpdateTimestamp("2024-01-02");

    expect(timestamp).toBe(
      parseTimestamp("YYYY-MM-DD HH:mm:ss", "2024-01-02 23:59:00"),
    );
  });
});
