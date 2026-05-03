import { describe, expect, test, vi } from "vitest";

import UpdateLongTermMemorySkill from "..";
import { formatTimestamp } from "../../../shared/utils";

describe("update-long-term-memory-skill", () => {
  test("uses triggeredAt from tool context data", async () => {
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
          task: "conversation_rollup",
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

  test("rejects non-add operations", async () => {
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
});
