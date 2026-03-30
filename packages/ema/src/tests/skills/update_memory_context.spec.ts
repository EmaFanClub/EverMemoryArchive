import { describe, expect, test, vi } from "vitest";

import UpdateLongTermMemorySkill from "../../skills/update-long-term-memory-skill";
import UpdateShortTermMemorySkill from "../../skills/update-short-term-memory-skill";

describe("memory update skills", () => {
  test("update-short-term-memory-skill enforces allowed kinds from tool context data", async () => {
    const skill = new UpdateShortTermMemorySkill(
      ".",
      "update-short-term-memory-skill",
    );
    const res = await skill.execute(
      {
        kind: "month",
        memory: "test",
      },
      {
        actorId: 1,
        server: {
          memoryManager: {
            upsertLatestShortTermMemory: vi.fn(),
          },
        } as any,
        data: {
          task: "dialogue_tick",
          triggeredAt: Date.now(),
        },
      },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("not allowed");
  });

  test("update-long-term-memory-skill uses triggeredAt from tool context data", async () => {
    const addLongTermMemory = vi.fn(async () => {});
    const skill = new UpdateLongTermMemorySkill(
      ".",
      "update-long-term-memory-skill",
    );

    const res = await skill.execute(
      {
        index0: "人物画像",
        index1: "owner",
        memory: "喜欢打招呼",
      },
      {
        actorId: 1,
        server: {
          memoryManager: {
            addLongTermMemory,
          },
        } as any,
        data: {
          task: "dialogue_tick",
          triggeredAt: 1234567890,
        },
      },
    );

    expect(res.success).toBe(true);
    expect(addLongTermMemory).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        createdAt: 1234567890,
      }),
    );
  });
});
