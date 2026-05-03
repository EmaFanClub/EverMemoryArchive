import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as lancedb from "@lancedb/lancedb";
import * as nodeFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DBService,
  createMongo,
  getLanceDbDirectory,
  prepareLanceDbDirectory,
  type Mongo,
} from "..";
import { createBootstrapConfig, GlobalConfig } from "../../config/index";
import { MemFs } from "../../shared/fs";
import {
  createTestGlobalConfigRecord,
  loadTestGlobalConfig,
} from "../../config/tests/helpers";

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

describe("DBService LanceDB directory", () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), "ema-lancedb-"));
  });

  afterEach(async () => {
    GlobalConfig.resetForTests();
    await nodeFs.rm(dataRoot, { recursive: true, force: true });
  });

  test("uses a dev LanceDB directory and resets it before connecting", async () => {
    await loadGlobalConfigForLanceTest("dev", dataRoot);
    const directory = getLanceDbDirectory();
    const sentinel = path.join(directory, "sentinel.txt");
    await nodeFs.mkdir(directory, { recursive: true });
    await nodeFs.writeFile(sentinel, "stale", "utf8");

    const result = await prepareLanceDbDirectory();

    expect(result).toEqual({
      directory,
      reset: true,
    });
    await expect(nodeFs.access(sentinel)).rejects.toThrow();
  });

  test("uses a prod LanceDB directory without resetting existing data", async () => {
    await loadGlobalConfigForLanceTest("prod", dataRoot);
    const directory = getLanceDbDirectory();
    const sentinel = path.join(directory, "sentinel.txt");
    await nodeFs.mkdir(directory, { recursive: true });
    await nodeFs.writeFile(sentinel, "keep", "utf8");

    const result = await prepareLanceDbDirectory();

    expect(result).toEqual({
      directory,
      reset: false,
    });
    await expect(nodeFs.readFile(sentinel, "utf8")).resolves.toBe("keep");
  });
});

async function loadGlobalConfigForLanceTest(
  mode: "dev" | "prod",
  dataRoot: string,
): Promise<void> {
  GlobalConfig.resetForTests();
  const fs = new MemFs();
  await GlobalConfig.load(fs, {
    bootstrap: createBootstrapConfig({
      mode,
      dataRoot,
      ...(mode === "dev"
        ? { mongoKind: "memory" as const }
        : { mongoUri: "mongodb://127.0.0.1:27017" }),
    }),
  });
  GlobalConfig.applyRecord(createTestGlobalConfigRecord());
}
