import { describe, expect, test, vi } from "vitest";

import UpdateLongTermMemorySkill from "../../skills/update-long-term-memory-skill";
import UpdateShortTermMemorySkill from "../../skills/update-short-term-memory-skill";
import { formatTimestamp } from "../../utils";
import { isAllowedIndex1 } from "../../memory/utils";

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
    const addLongTermMemory = vi
      .fn()
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(102);
    const skill = new UpdateLongTermMemorySkill(
      ".",
      "update-long-term-memory-skill",
    );

    const res = await skill.execute(
      {
        operations: [
          {
            op: "add",
            index0: "人物画像",
            index1: "owner",
            memory: "喜欢打招呼",
            msg_ids: [11],
          },
          {
            op: "add",
            index0: "过往事件",
            index1: "owner",
            memory: "之前约好了一起去海边",
          },
        ],
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
    expect(addLongTermMemory).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({
        index0: "人物画像",
        index1: "owner",
        memory: "喜欢打招呼",
        createdAt: 1234567890,
        messages: [11],
      }),
    );
    expect(addLongTermMemory).toHaveBeenNthCalledWith(
      2,
      1,
      expect.objectContaining({
        index0: "过往事件",
        index1: "owner",
        memory: "之前约好了一起去海边",
        createdAt: 1234567890,
      }),
    );
    expect(JSON.parse(res.content!)).toEqual({
      results: [
        {
          id: 101,
          createdAt: formatTimestamp("YYYY-MM-DD HH:mm:ss", 1234567890),
        },
        {
          id: 102,
          createdAt: formatTimestamp("YYYY-MM-DD HH:mm:ss", 1234567890),
        },
      ],
    });
  });

  test("update-long-term-memory-skill rejects non-add operations", async () => {
    const skill = new UpdateLongTermMemorySkill(
      ".",
      "update-long-term-memory-skill",
    );

    const res = await skill.execute(
      {
        operations: [
          {
            op: "update",
            id: 1,
            index0: "人物画像",
            index1: "owner",
            memory: "喜欢打招呼",
          },
        ],
      },
      {
        actorId: 1,
        server: {
          memoryManager: {
            addLongTermMemory: vi.fn(),
          },
        } as any,
      },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("Use get_skill");
    expect(res.error).toContain('"add"');
  });

  test("人物画像 now allows self as index1", () => {
    expect(isAllowedIndex1("人物画像", "self")).toBe(true);
  });
});
