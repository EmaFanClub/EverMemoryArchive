import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as lancedb from "@lancedb/lancedb";

import { ActorTrainer } from "../actor_trainer";
import type { Server } from "../../server";
import { MemFs } from "../../shared/fs";
import { createMongo, DBService, type Mongo } from "../../db";
import { parseTimestamp } from "../../shared/utils";
import { Logger } from "../../shared/logger";

describe("ActorTrainer", () => {
  let mongo: Mongo;
  let lance: lancedb.Connection;
  let server: Server;

  beforeEach(async () => {
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    lance = await lancedb.connect("memory://ema-trainer");
    server = {} as Server;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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
        kind: "text",
        content: "I am here.",
      },
    });
  });

  test("builds the end-of-day memory-rollup timestamp for a training day", () => {
    const trainer = new ActorTrainer(server, new MemFs());

    const timestamp = (trainer as any).buildMemoryRollupTimestamp("2024-01-02");

    expect(timestamp).toBe(
      parseTimestamp("YYYY-MM-DD HH:mm:ss", "2024-01-02 23:59:00"),
    );
  });

  test("writes trainer file logs under the actor train directory", () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const createLogger = vi.spyOn(Logger, "create").mockReturnValue(logger);
    const trainer = new ActorTrainer(server, new MemFs());

    (trainer as any).createTrainingLogger(1);

    expect(createLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "trainer",
        outputs: expect.arrayContaining([
          expect.objectContaining({
            filePath: "actors/actor_1/train/trainer.jsonl",
          }),
        ]),
      }),
    );
  });

  test("reports training step progress through the observer and keeps detail logs at debug", async () => {
    const events: unknown[] = [];
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const trainer = new ActorTrainer(
      server,
      new MemFs(),
      logger as any,
      (event) => events.push(event),
    );

    const result = await (trainer as any).advanceStep(
      "conversation-activity",
      0,
      0,
      99,
      12,
      1,
      1,
      ".ema/trainer/session",
      parseTimestamp("YYYY-MM-DD HH:mm:ss", "2024-01-02 10:00:00"),
      ["activity", "day"],
      logger,
    );

    expect(result).toEqual({ checkpointId: 0, stepCount: 1 });
    expect(events).toContainEqual({
      type: "stepAdvanced",
      actorId: 1,
      step: 1,
      messageCount: 12,
      update: "conversation-activity",
      kinds: ["activity", "day"],
      gameTime: "2024-01-02 10:00:00",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      "Training step advanced",
      expect.objectContaining({
        step: 1,
        messageCount: 12,
        update: "conversation-activity",
      }),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  test("rejects training when the actor already has conversation messages", async () => {
    server.dbService = DBService.createSync(new MemFs(), mongo, lance);
    const roleId = await server.dbService.roleDB.upsertRole({
      name: "亚托莉",
      prompt: "role book",
    });
    const actorId = await server.dbService.actorDB.upsertActor({
      roleId,
      enabled: false,
    });
    const conversation = await server.dbService.createConversation(
      actorId,
      "web-chat-1",
      "Default",
      "",
      true,
    );
    await server.dbService.conversationMessageDB.addConversationMessage({
      actorId,
      conversationId: conversation.id!,
      channelMessageId: "web:1",
      buffered: true,
      createdAt: parseTimestamp("YYYY-MM-DD HH:mm:ss", "2024-01-01 10:00:00"),
      message: {
        kind: "user",
        uid: "夏生",
        name: "夏生",
        contents: [{ type: "text", text: "hello" }],
      },
    });
    const trainer = new ActorTrainer(server, new MemFs());

    await expect(
      trainer.train({
        actorId,
        characterName: "亚托莉",
        dataset: {
          description: "dataset",
          inputs: [
            {
              name: "亚托莉",
              time: "2024-01-01 10:00:00",
              content: "hello",
            },
          ],
        },
        bufferWindowSize: 30,
        diaryUpdateEvery: 20,
        checkpointDir: ".ema/trainer",
      }),
    ).rejects.toThrow("Actor has existing conversation messages");
  });

  test("rejects training when a train conversation already exists", async () => {
    server.dbService = DBService.createSync(new MemFs(), mongo, lance);
    const roleId = await server.dbService.roleDB.upsertRole({
      name: "亚托莉",
      prompt: "role book",
    });
    const actorId = await server.dbService.actorDB.upsertActor({
      roleId,
      enabled: false,
    });
    await server.dbService.createConversation(
      actorId,
      "train-group-1-existing",
      "train-group-1-existing",
      "dataset",
    );
    const trainer = new ActorTrainer(server, new MemFs());

    await expect(
      trainer.train({
        actorId,
        characterName: "亚托莉",
        dataset: {
          description: "dataset",
          inputs: [
            {
              name: "亚托莉",
              time: "2024-01-01 10:00:00",
              content: "hello",
            },
          ],
        },
        bufferWindowSize: 30,
        diaryUpdateEvery: 20,
        checkpointDir: ".ema/trainer",
      }),
    ).rejects.toThrow("Actor already has a training conversation");
  });

  test("checks existing actor messages with one actor-scoped query", async () => {
    const countConversationMessages = vi.fn(async () => 0);
    const listConversationMessages = vi.fn(async () => [
      {
        id: 1,
        actorId: 1,
        conversationId: 10,
      },
    ]);
    const trainer = new ActorTrainer({
      dbService: {
        conversationDB: {
          listConversations: vi.fn(async () => [
            { id: 10, actorId: 1, session: "web-chat-1" },
            { id: 11, actorId: 1, session: "qq-chat-1" },
          ]),
        },
        conversationMessageDB: {
          countConversationMessages,
          listConversationMessages,
        },
        shortTermMemoryDB: {
          listShortTermMemories: vi.fn(async () => []),
        },
        longTermMemoryDB: {
          listLongTermMemories: vi.fn(async () => []),
        },
        personalityDB: {
          getPersonality: vi.fn(async () => null),
        },
      },
    } as unknown as Server);

    await expect(
      (trainer as any).validateActorCanTrain({ id: 1, enabled: false }),
    ).rejects.toThrow("Actor has existing conversation messages");

    expect(listConversationMessages).toHaveBeenCalledWith({
      actorId: 1,
      limit: 1,
    });
    expect(countConversationMessages).not.toHaveBeenCalled();
  });

  test("checks existing long-term memories with a limited query", async () => {
    const listLongTermMemories = vi.fn(async () => []);
    const trainer = new ActorTrainer({
      dbService: {
        conversationDB: {
          listConversations: vi.fn(async () => []),
        },
        conversationMessageDB: {
          listConversationMessages: vi.fn(async () => []),
        },
        shortTermMemoryDB: {
          listShortTermMemories: vi.fn(async () => []),
        },
        longTermMemoryDB: {
          listLongTermMemories,
        },
        personalityDB: {
          getPersonality: vi.fn(async () => null),
        },
      },
    } as unknown as Server);

    await (trainer as any).validateActorCanTrain({ id: 1, enabled: false });

    expect(listLongTermMemories).toHaveBeenCalledWith({
      actorId: 1,
      limit: 1,
    });
  });
});
