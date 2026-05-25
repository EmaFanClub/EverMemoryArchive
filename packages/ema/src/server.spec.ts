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
import { PromptStore } from "./prompts/loader";
import { buildSession } from "./channel";
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
  server.promptStore = new PromptStore();
  server.memoryManager = new MemoryManager(server);
  return server;
};

describe("Server", () => {
  afterEach(() => {
    GlobalConfig.resetForTests();
  });

  test("system prompt injects conversation map and current conversation", async () => {
    const fs = new MemFs();
    const mongo = await createMongo("", "test_prompt_conversation", "memory");
    await mongo.connect();
    const lance = await lancedb.connect("memory://ema-prompt-conversation");
    const server = await createServerForTest(fs, mongo, lance);
    try {
      const conversation = await createTestActorFixture(server.dbService);
      expect(conversation?.id).toBeTypeOf("number");
      await server.dbService.createConversation(
        1,
        buildSession("qq", "group", "123456"),
        "小群",
        "日常闲聊群，可以偶尔冒泡。",
        false,
      );

      const prompt = await server.memoryManager.buildSystemPromptForChat(
        1,
        conversation!.id!,
      );
      expect(prompt).not.toContain("# 思考方式（Thinking）");
      expect(prompt).toContain("# 对话（Conversation）");
      expect(prompt).toContain("## 会话列表");
      expect(prompt).toContain(
        "- 和alice的网页聊天｜私聊｜session：web-chat-1｜主动联系：允许",
      );
      expect(prompt).toContain(
        "- 小群｜群聊｜session：qq-group-123456｜主动联系：禁止",
      );
      expect(prompt).toContain("日常闲聊群，可以偶尔冒泡。");
      expect(prompt).toContain(
        "## 当前会话：和alice的网页聊天｜私聊｜session：web-chat-1",
      );
    } finally {
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
          summary: "问问最近过得怎么样",
          prompt:
            "完整任务说明：问问最近过得怎么样，并根据当时状态决定是否继续聊。",
          conversationId: conversation!.id!,
        },
        {
          task: "focus",
          conversationId: conversation!.id!,
        },
      ]);
      await server.scheduler.schedule({
        name: "actor_background",
        runAt: Date.now() + 120_000,
        data: {
          actorId: 1,
          task: "activity",
          prompt: "旧格式日程没有摘要时使用完整任务说明回退",
        },
      });

      const prompt = await server.memoryManager.buildSystemPromptForChat(
        1,
        conversation!.id!,
      );
      expect(prompt).toContain("# 日程（Schedule）");
      expect(prompt).toContain("## 未来日程");
      expect(prompt).toMatch(
        /- id=[^｜\n]+｜\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}｜chat｜session=web-chat-1｜问问最近过得怎么样/,
      );
      expect(prompt).toContain("## 周期日程");
      expect(prompt).toMatch(
        /- id=[^｜\n]+｜下次 [^｜\n]+｜wake｜周期：0 8 \* \* \*/,
      );
      expect(prompt).toContain("## 关注会话");
      expect(prompt).toMatch(
        /- id=[^｜\n]+｜下次 [^｜\n]+｜focus｜session=web-chat-1｜周期：5min/,
      );
      expect(prompt).toMatch(
        /- id=[^｜\n]+｜\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}｜activity｜旧格式日程没有摘要时使用完整任务说明回退/,
      );
      expect(prompt).not.toContain(
        "完整任务说明：问问最近过得怎么样，并根据当时状态决定是否继续聊。",
      );
    } finally {
      await server.scheduler.stop();
      await mongo.close();
      await lance.close();
    }
  });

  test("background system prompt includes conversation map without current conversation", async () => {
    const fs = new MemFs();
    const mongo = await createMongo("", "test_prompt_background", "memory");
    await mongo.connect();
    const lance = await lancedb.connect("memory://ema-prompt-background");
    const server = await createServerForTest(fs, mongo, lance);
    try {
      const conversation = await createTestActorFixture(server.dbService);
      expect(conversation?.id).toBeTypeOf("number");

      const detachedPrompt =
        await server.memoryManager.buildSystemPromptForBackground(1);
      expect(detachedPrompt).not.toContain("# 思考方式（Thinking）");
      expect(detachedPrompt).toContain("# 对话（Conversation）");
      expect(detachedPrompt).toContain(
        "- 和alice的网页聊天｜私聊｜session：web-chat-1｜主动联系：允许",
      );
      expect(detachedPrompt).toContain("## 当前会话：None.");

      const conversationPrompt =
        await server.memoryManager.buildSystemPromptForBackground(1, {
          conversationId: conversation!.id!,
          bufferMessages: [],
        });
      expect(conversationPrompt).toContain("# 对话（Conversation）");
      expect(conversationPrompt).toContain(
        "## 当前会话：和alice的网页聊天｜私聊｜session：web-chat-1",
      );
    } finally {
      await mongo.close();
      await lance.close();
    }
  });

  test("does not restore default snapshot by default in dev", async () => {
    const fs = new MemFs();
    const bootstrap = createBootstrapConfig({
      mode: "dev",
      mongoKind: "memory",
    });
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
