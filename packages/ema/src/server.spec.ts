import path from "node:path";

import { afterEach, expect, test, describe } from "vitest";
import * as lancedb from "@lancedb/lancedb";

import { Server } from "./server";
import { MemFs } from "./shared/fs";
import { createMongo, DBService, type Mongo } from "./db";
import { AgendaScheduler } from "./scheduler";
import { MemoryManager } from "./memory/manager";
import { Gateway } from "./gateway";
import { ActorRegistry } from "./actor";
import { loadTestGlobalConfig } from "./config/tests/helpers";
import { GlobalConfig } from "./config/index";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createServerForTest = async (
  fs: MemFs,
  mongo: Mongo,
  lance: lancedb.Connection,
) => {
  await loadTestGlobalConfig(fs);
  const server = new (Server as any)() as Server;
  (server as any).fs = fs;
  server.dbService = DBService.createSync(fs, mongo, lance);
  server.actorRegistry = new ActorRegistry(server);
  server.gateway = new Gateway(server);
  server.memoryManager = new MemoryManager(server);
  return server;
};

describe("Server", () => {
  afterEach(() => {
    GlobalConfig.resetForTests();
  });

  test("should initialize default user, bindings, and conversations", async () => {
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
    } finally {
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

  test("does not restore default snapshot when disabled by config", async () => {
    const fs = new MemFs();
    await fs.write(
      GlobalConfig.configPath,
      GlobalConfig.example
        .replace(
          "restore_default_snapshot = true",
          "restore_default_snapshot = false",
        )
        .replace("require_dev_seed = true", "require_dev_seed = false"),
    );
    await fs.write(
      path.join(
        path.dirname(GlobalConfig.configPath),
        "..",
        ".data",
        "mongo-snapshots",
        "default.json",
      ),
      JSON.stringify({
        roles: [
          {
            id: 123,
            name: "Snapshot Role",
            prompt: "should not restore",
          },
        ],
      }),
    );

    const server = await Server.create(fs);

    try {
      await expect(server.dbService.roleDB.getRole(123)).resolves.toBeNull();
    } finally {
      await server.scheduler.stop();
      await sleep(50);
      await server.dbService.mongo.close();
      await server.dbService.lancedb.close();
    }
  });
});
