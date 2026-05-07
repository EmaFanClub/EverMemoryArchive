import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as lancedb from "@lancedb/lancedb";

import { ActorTrainer } from "../actor_trainer";
import type { Server } from "../../server";
import { MemFs } from "../../shared/fs";
import { createMongo, DBService, type Mongo } from "../../db";
import { parseTimestamp } from "../../shared/utils";

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
});
