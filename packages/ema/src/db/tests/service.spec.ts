import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as lancedb from "@lancedb/lancedb";
import path from "node:path";

import { DBService, createMongo, type Mongo } from "..";
import { GlobalConfig } from "../../config/index";
import { MemFs } from "../../fs";
import { loadTestGlobalConfig } from "../../tests/helpers/config";

describe("DBService", () => {
  let fs: MemFs;
  let mongo: Mongo;
  let lance: lancedb.Connection;
  let dbService: DBService;

  beforeEach(async () => {
    fs = await loadTestGlobalConfig();
    mongo = await createMongo("", "db_service_test", "memory");
    await mongo.connect();
    lance = await lancedb.connect("memory://ema-db-service");
    dbService = DBService.createSync(fs, mongo, lance);
  });

  afterEach(async () => {
    await mongo.close();
    await lance.close();
  });

  test("creates indices without throwing", async () => {
    await expect(dbService.createIndices()).resolves.toBeUndefined();
  });

  test("creates and resolves conversations by session", async () => {
    const conversation = await dbService.createConversation(
      1,
      "web-chat-1",
      "Default",
      "测试会话",
      false,
    );

    expect(conversation).toMatchObject({
      actorId: 1,
      session: "web-chat-1",
      name: "Default",
      description: "测试会话",
      allowProactive: false,
    });

    const fetched = await dbService.getConversationBySession(1, "web-chat-1");
    expect(fetched).toMatchObject({
      id: conversation.id,
      actorId: 1,
      session: "web-chat-1",
    });
  });

  test("snapshots and restores managed collections", async () => {
    await dbService.roleDB.upsertRole({
      id: 1,
      name: "EMA",
      prompt: "role-book",
    });

    const result = await dbService.snapshot("db-service-snapshot");
    expect(result.fileName).toBe(
      path.join(
        GlobalConfig.system.dataRoot,
        "mongo-snapshots",
        "db-service-snapshot.json",
      ),
    );

    await mongo.restoreFromSnapshot({ roles: [] });
    expect(await dbService.roleDB.listRoles()).toEqual([]);

    const restored = await dbService.restoreFromSnapshot("db-service-snapshot");
    expect(restored).toBe(true);
    expect(await dbService.roleDB.listRoles()).toMatchObject([
      {
        id: 1,
        name: "EMA",
        prompt: "role-book",
      },
    ]);
  });
});
