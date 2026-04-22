import { expect, test, describe } from "vitest";
import { Server } from "./server";
import { MemFs } from "./fs";
import { createMongo, DBService, type Mongo } from "./db";
import { AgendaScheduler } from "./scheduler";
import { MemoryManager } from "./memory/manager";
import { Gateway } from "./gateway";
import { ActorRegistry } from "./actor";
import {
  Config,
  LLMConfig,
  OpenAIApiConfig,
  GoogleApiConfig,
  AgentConfig,
  ToolsConfig,
  MongoConfig,
  SystemConfig,
} from "./config";
import * as lancedb from "@lancedb/lancedb";

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

const createServerForTest = async (
  fs: MemFs,
  mongo: Mongo,
  lance: lancedb.Connection,
) => {
  const config = createTestConfig();
  const server = new (Server as any)(fs, config) as Server;
  server.dbService = DBService.createSync(fs, config, mongo, lance);
  server.actorRegistry = new ActorRegistry(server);
  server.gateway = new Gateway(server);
  server.memoryManager = new MemoryManager(server);
  return server;
};

describe("Server", () => {
  test("should initialize default user, bindings, and conversations", async () => {
    const previousQqUid = process.env.EMA_QQ_UID;
    const previousQqGroupId = process.env.EMA_QQ_GROUP_ID;
    process.env.EMA_QQ_UID = "10726371";
    process.env.EMA_QQ_GROUP_ID = "114514";
    const fs = new MemFs();
    const mongo = await createMongo("", "test_login", "memory");
    await mongo.connect();
    const lance = await lancedb.connect("memory://ema-login");
    const server = await createServerForTest(fs, mongo, lance);

    try {
      await (server as any).createInitialCharacters();
      const user = await server.dbService.getDefaultUser();
      expect(user).not.toBeNull();
      expect(user!.id).toBe(1);
      expect(user!.name).toBe("alice");
      expect(user!.email).toBe("alice@example.com");
      const userBinding =
        await server.dbService.externalIdentityBindingDB.getExternalIdentityBindingByUid(
          "1",
        );
      expect(userBinding).toMatchObject({
        userId: 1,
        channel: "web",
        uid: "1",
      });
      const qqBinding =
        await server.dbService.externalIdentityBindingDB.getExternalIdentityBindingByUid(
          "10726371",
        );
      expect(qqBinding).toMatchObject({
        userId: 1,
        channel: "qq",
        uid: "10726371",
      });
      const qqConversation =
        await server.dbService.conversationDB.getConversationByActorAndSession(
          1,
          "qq-chat-10726371",
        );
      expect(qqConversation).toMatchObject({
        actorId: 1,
        session: "qq-chat-10726371",
        allowProactive: false,
      });
      const qqGroupConversation =
        await server.dbService.conversationDB.getConversationByActorAndSession(
          1,
          "qq-group-114514",
        );
      expect(qqGroupConversation).toMatchObject({
        actorId: 1,
        session: "qq-group-114514",
        allowProactive: false,
      });
    } finally {
      if (typeof previousQqUid === "undefined") {
        delete process.env.EMA_QQ_UID;
      } else {
        process.env.EMA_QQ_UID = previousQqUid;
      }
      if (typeof previousQqGroupId === "undefined") {
        delete process.env.EMA_QQ_GROUP_ID;
      } else {
        process.env.EMA_QQ_GROUP_ID = previousQqGroupId;
      }
      await mongo.close();
      await lance.close();
    }
  });

  test("initial character setup should not create default scheduler jobs", async () => {
    const fs = new MemFs();
    const mongo = await createMongo("", "test_login_jobs", "memory");
    await mongo.connect();
    const lance = await lancedb.connect("memory://ema-login-jobs");
    const server = await createServerForTest(fs, mongo, lance);
    server.scheduler = await AgendaScheduler.create(mongo, {
      processEvery: 20,
    });

    try {
      await (server as any).createInitialCharacters();
      await (server as any).createInitialCharacters();

      const conversation =
        await server.dbService.conversationDB.getConversationByActorAndSession(
          1,
          "web-chat-1",
        );
      expect(conversation).toMatchObject({
        actorId: 1,
        session: "web-chat-1",
        description: "这是你和你的拥有者之间在网页端私聊的对话。",
      });

      const backgroundJobs = await server.scheduler.listJobs({
        name: "actor_background",
        "data.actorId": 1,
      });
      const foregroundJobs = await server.scheduler.listJobs({
        name: "actor_foreground",
        "data.actorId": 1,
      });
      expect(backgroundJobs).toHaveLength(0);
      expect(foregroundJobs).toHaveLength(0);
    } finally {
      await server.scheduler.stop();
      await mongo.close();
      await lance.close();
    }
  });

  test("system prompt should include actor schedules", async () => {
    const fs = new MemFs();
    const mongo = await createMongo("", "test_prompt_schedule", "memory");
    await mongo.connect();
    const lance = await lancedb.connect("memory://ema-prompt-schedule");
    const server = await createServerForTest(fs, mongo, lance);
    server.scheduler = await AgendaScheduler.create(mongo, {
      processEvery: 20,
    });
    try {
      await (server as any).createInitialCharacters();
      const conversation =
        await server.dbService.conversationDB.getConversationByActorAndSession(
          1,
          "web-chat-1",
        );
      expect(conversation?.id).toBeTypeOf("number");

      await server.getActorScheduler(1).add([
        {
          task: "wake",
          interval: "0 8 * * *",
        },
        {
          type: "once",
          task: "chat",
          runAt: Date.now() + 60_000,
          prompt: "问问最近过得怎么样",
          conversationId: conversation!.id!,
        },
      ]);

      const prompt = await server.memoryManager.buildSystemPromptForChat(
        1,
        conversation!.id!,
      );
      expect(prompt).toContain("# 日程（Schedule）");
      expect(prompt).toContain('"task":"wake"');
      expect(prompt).toContain('"task":"chat"');
    } finally {
      await server.scheduler.stop();
      await mongo.close();
      await lance.close();
    }
  });
});
