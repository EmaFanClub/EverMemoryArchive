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
import {
  createTestActorFixture,
  loadTestGlobalConfig,
} from "./config/tests/helpers";
import { createBootstrapConfig, GlobalConfig } from "./config/index";

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
      const conversation = await createTestActorFixture(server.dbService);
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

  test("does not restore default snapshot when disabled by bootstrap", async () => {
    const fs = new MemFs();
    const baseBootstrap = createBootstrapConfig({
      mode: "dev",
      mongoKind: "memory",
    });
    const bootstrap = {
      ...baseBootstrap,
      devBootstrap: {
        restoreDefaultSnapshot: false,
      },
    };
    await fs.write(
      path.join(bootstrap.paths.dataRoot, "mongo-snapshots", "default.json"),
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

    const server = await Server.create(fs, { bootstrap });

    try {
      await expect(server.dbService.roleDB.getRole(123)).resolves.toBeNull();
    } finally {
      await sleep(50);
      await server.stop();
    }
  });
});
