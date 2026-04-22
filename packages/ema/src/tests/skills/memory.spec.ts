import { expect, test, describe, beforeEach, afterEach, vi } from "vitest";
import { createMongo, DBService } from "../../db";
import type { Mongo } from "../../db";
import { Config } from "../../config";
import { MemoryManager } from "../../memory/manager";
import type { Server } from "../../server";
import { MemFs } from "../../fs";
import * as lancedb from "@lancedb/lancedb";

const describeLLM = describe.runIf(
  !!process.env.GEMINI_API_KEY?.trim() &&
    process.env.GEMINI_API_KEY !== "DUMMY_KEY",
);
describeLLM("MemorySkill", () => {
  const { shouldSkip, skipReason } = (() => {
    try {
      Config.load();
      return { shouldSkip: false, skipReason: "" };
    } catch (error) {
      return {
        shouldSkip: true,
        skipReason: `Config load failed: ${(error as Error).message}`,
      };
    }
  })();

  if (shouldSkip) {
    test.skip("skipped because " + skipReason, () => {});
    return;
  }

  let mongo: Mongo;
  let memoryManager: MemoryManager;
  let dbService: DBService;
  let lance: lancedb.Connection;

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    lance = await lancedb.connect("memory://ema");
    await mongo.connect();

    dbService = DBService.createSync(new MemFs(), Config.load(), mongo, lance);
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
