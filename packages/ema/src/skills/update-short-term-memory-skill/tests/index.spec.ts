import { describe, expect, test, vi } from "vitest";

import UpdateShortTermMemorySkill from "..";
import { formatTimestamp } from "../../../shared/utils";

describe("update-short-term-memory-skill", () => {
  test("rejects add_activity outside conversation activity", async () => {
    const skill = new UpdateShortTermMemorySkill(
      ".",
      "update-short-term-memory-skill",
    );
    const res = await skill.execute(
      {
        action: "add_activity",
        memory: "test",
      },
      {
        actorId: 1,
        server: {
          memoryManager: {
            appendShortTermMemory: vi.fn(),
          },
        } as any,
        data: {
          task: "memory_rollup",
          triggeredAt: Date.now(),
          activitySnapshot: [],
        },
      },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("conversation_rollup");
  });

  test("allows add_activity in activity", async () => {
    const appendShortTermMemory = vi.fn();
    const skill = new UpdateShortTermMemorySkill(
      ".",
      "update-short-term-memory-skill",
    );
    const res = await skill.execute(
      {
        action: "add_activity",
        memory: "一个人的午后，发了会儿呆。",
      },
      {
        actorId: 1,
        server: {
          actorRegistry: {
            get: vi.fn().mockReturnValue({
              getDayDate: vi.fn().mockReturnValue("2026-04-20"),
            }),
          },
          memoryManager: {
            appendShortTermMemory,
          },
        } as any,
        data: {
          task: "activity",
          triggeredAt: 1234567890,
        },
      },
    );

    expect(res.success).toBe(true);
    expect(appendShortTermMemory).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        kind: "activity",
        date: formatTimestamp("YYYY-MM-DD", 1234567890),
        dayDate: "2026-04-20",
        memory: "一个人的午后，发了会儿呆。",
        createdAt: 1234567890,
        updatedAt: 1234567890,
      }),
    );
  });
});
