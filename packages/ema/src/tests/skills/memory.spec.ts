import { expect, test, describe, beforeEach, afterEach, vi } from "vitest";
import * as lancedb from "@lancedb/lancedb";

import { createMongo, DBService } from "../../db";
import type { Mongo } from "../../db";
import { GlobalConfig } from "../../config/index";
import { MemoryManager } from "../../memory/manager";
import type { Server } from "../../server";
import { MemFs } from "../../fs";
import { loadTestGlobalConfig } from "../helpers/config";

await loadTestGlobalConfig();

const googleKey = GlobalConfig.defaultLlm.google.apiKey;
const describeLLM = describe.runIf(
  process.env.EMA_RUN_LLM_INTEGRATION_TESTS === "1" &&
    googleKey.trim().length > 0 &&
    googleKey !== "DUMMY_KEY",
);

describeLLM("MemorySkill", () => {
  let mongo: Mongo;
  let memoryManager: MemoryManager;
  let dbService: DBService;
  let lance: lancedb.Connection;

  beforeEach(async () => {
    mongo = await createMongo("", "test", "memory");
    lance = await lancedb.connect("memory://ema");
    await mongo.connect();

    dbService = DBService.createSync(new MemFs(), mongo, lance);
    memoryManager = new MemoryManager({ dbService } as Server);

    await dbService.longTermMemoryVectorSearcher.createIndices();
  });

  afterEach(async () => {
    await mongo.close();
    await lance.close();
  });

  test("should search memory", async () => {
    const result = await memoryManager.search(1, "test", 10);
    expect(result).toEqual([]);
  });

  test("should mock search memory", async () => {
    const item = {
      id: 1,
      index0: "test",
      index1: "test",
      memory: "test",
      createdAt: Date.now(),
    };
    memoryManager.search = vi.fn().mockResolvedValue([item]);
    const result = await memoryManager.search(1, "test", 10);
    expect(result).toEqual([item]);
  });
});
