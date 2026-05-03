import { describe, expect, test } from "vitest";
import * as lancedb from "@lancedb/lancedb";

import { ActorRegistry } from "../actor_registry";
import { MemFs } from "../../shared/fs";
import { Gateway } from "../../gateway";
import { MemoryManager } from "../../memory/manager";
import {
  createTestActorFixture,
  loadTestGlobalConfig,
} from "../../config/tests/helpers";
import { createMongo, DBService, type Mongo } from "../../db";
import { Server } from "../../server";
import { EmaBus } from "../../bus";
import { EmaController } from "../../controller";

const createServerForTest = async (
  fs: MemFs,
  mongo: Mongo,
  lance: lancedb.Connection,
) => {
  await loadTestGlobalConfig(fs);
  const server = new (Server as any)() as Server;
  (server as any).fs = fs;
  server.dbService = DBService.createSync(fs, mongo, lance);
  server.bus = new EmaBus();
  server.controller = new EmaController(server);
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

      await createTestActorFixture(server.dbService);

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
      expect(conversation).toMatchObject({
        name: "和alice的网页聊天",
        description: "",
        allowProactive: true,
      });
    } finally {
      await mongo.close();
      await lance.close();
    }
  });

  test("restoreAll skips disabled actors and ensure rejects them", async () => {
    const fs = new MemFs();
    const mongo = await createMongo(
      "",
      "test_actor_registry_disabled",
      "memory",
    );
    await mongo.connect();
    const lance = await lancedb.connect("memory://ema-actor-registry-disabled");
    const server = await createServerForTest(fs, mongo, lance);

    try {
      await createTestActorFixture(server.dbService);
      await server.dbService.roleDB.upsertRole({
        id: 2,
        name: "Disabled",
        prompt: "disabled role",
      });
      await server.dbService.actorDB.upsertActor({
        id: 2,
        roleId: 2,
        enabled: false,
      });

      await server.actorRegistry.restoreAll();

      expect(server.actorRegistry.has(1)).toBe(true);
      expect(server.actorRegistry.has(2)).toBe(false);
      await expect(server.actorRegistry.ensure(2)).rejects.toThrow(
        "Actor 2 is disabled.",
      );
    } finally {
      await mongo.close();
      await lance.close();
    }
  });
});
