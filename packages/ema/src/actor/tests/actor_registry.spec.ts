import { describe, expect, test } from "vitest";
import * as lancedb from "@lancedb/lancedb";

import { ActorRegistry } from "../actor_registry";
import { MemFs } from "../../fs";
import { Gateway } from "../../gateway";
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
import { createMongo, DBService, type Mongo } from "../../db";
import { Server } from "../../server";

const createTestConfig = () =>
  new Config(
    new LLMConfig(
      new OpenAIApiConfig(
        "test-openai-key",
        "https://example.com/openai/v1/",
      ),
      new GoogleApiConfig(
        "test-google-key",
        "https://example.com/google/v1/",
      ),
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

describe("ActorRegistry", () => {
  test("get only reads loaded runtimes and ensure loads existing actors", async () => {
    const fs = new MemFs();
    const mongo = await createMongo("", "test_actor_registry", "memory");
    await mongo.connect();
    const lance = await lancedb.connect("memory://ema-actor-registry");
    const server = await createServerForTest(fs, mongo, lance);

    try {
      expect(server.actorRegistry.get(1)).toBeNull();
      await expect(server.actorRegistry.ensure(1)).rejects.toThrow(
        "Actor 1 not found.",
      );

      await (server as any).createInitialCharacters();

      expect(server.actorRegistry.get(1)).toBeNull();

      const actor = await server.actorRegistry.ensure(1);
      const actorAgain = await server.actorRegistry.ensure(1);
      expect(actor).toBe(actorAgain);
      expect(server.actorRegistry.get(1)).toBe(actor);

      const conversation =
        await server.dbService.conversationDB.getConversationByActorAndSession(
          1,
          "web-chat-1",
        );
      expect(conversation?.description).toBe(
        "这是你和你的拥有者之间在网页端私聊的对话。",
      );
    } finally {
      await mongo.close();
      await lance.close();
    }
  });
});
