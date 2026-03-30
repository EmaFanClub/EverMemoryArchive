import { describe, expect, test, vi } from "vitest";

import SearchLongTermMemorySkill from "../../skills/search-long-term-memory-skill";
import { formatTimestamp } from "../../utils";

describe("search-long-term-memory-skill", () => {
  test("returns grouped batch search results in the same order as queries", async () => {
    const firstCreatedAt = Date.UTC(2026, 2, 28, 13, 10, 0);
    const secondCreatedAt = Date.UTC(2026, 2, 27, 2, 22, 0);
    const search = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 12,
          index0: "过往事件",
          index1: "owner",
          memory: "Alice以前和我约好要一起看海。",
          createdAt: firstCreatedAt,
          messages: [101, 105],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 44,
          index0: "百科知识",
          index1: "梗知识",
          memory: "哈基米源自日语“はちみつ”的空耳并演化为萌宠梗。",
          createdAt: secondCreatedAt,
        },
      ]);
    const skill = new SearchLongTermMemorySkill(
      ".",
      "search-long-term-memory-skill",
    );

    const res = await skill.execute(
      {
        queries: [
          {
            index0: "过往事件",
            index1: "owner",
            memory: "和 owner 有关的约定、承诺、答应过的事",
            limit: 10,
          },
          {
            index0: "百科知识",
            index1: "梗知识",
            memory: "哈基米 的来源、含义和常见使用语境",
            limit: 12,
          },
        ],
      },
      {
        actorId: 1,
        server: {
          memoryManager: {
            search,
          },
        } as any,
      },
    );

    expect(search).toHaveBeenNthCalledWith(
      1,
      1,
      "和 owner 有关的约定、承诺、答应过的事",
      10,
      "过往事件",
      "owner",
    );
    expect(search).toHaveBeenNthCalledWith(
      2,
      1,
      "哈基米 的来源、含义和常见使用语境",
      12,
      "百科知识",
      "梗知识",
    );
    expect(res.success).toBe(true);
    expect(JSON.parse(res.content!)).toEqual({
      results: [
        {
          query: {
            index0: "过往事件",
            index1: "owner",
            memory: "和 owner 有关的约定、承诺、答应过的事",
            limit: 10,
          },
          hints: [
            {
              id: 12,
              memory: "Alice以前和我约好要一起看海。",
              createdAt: formatTimestamp("YYYY-MM-DD HH:mm:ss", firstCreatedAt),
              msg_ids: [101, 105],
            },
          ],
        },
        {
          query: {
            index0: "百科知识",
            index1: "梗知识",
            memory: "哈基米 的来源、含义和常见使用语境",
            limit: 12,
          },
          hints: [
            {
              id: 44,
              memory: "哈基米源自日语“はちみつ”的空耳并演化为萌宠梗。",
              createdAt: formatTimestamp(
                "YYYY-MM-DD HH:mm:ss",
                secondCreatedAt,
              ),
            },
          ],
        },
      ],
    });
  });

  test("supports empty index1 when index0 is specified", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const skill = new SearchLongTermMemorySkill(
      ".",
      "search-long-term-memory-skill",
    );

    const res = await skill.execute(
      {
        queries: [
          {
            index0: "百科知识",
            index1: "",
            memory: "和某个作品有关的设定与背景资料",
            limit: 50,
          },
        ],
      },
      {
        actorId: 1,
        server: {
          memoryManager: {
            search,
          },
        } as any,
      },
    );

    expect(res.success).toBe(true);
    expect(search).toHaveBeenNthCalledWith(
      1,
      1,
      "和某个作品有关的设定与背景资料",
      50,
      "百科知识",
      "",
    );
    expect(JSON.parse(res.content!)).toEqual({
      results: [
        {
          query: {
            index0: "百科知识",
            index1: "",
            memory: "和某个作品有关的设定与背景资料",
            limit: 50,
          },
          hints: [],
        },
      ],
    });
  });

  test("rejects empty index0", async () => {
    const skill = new SearchLongTermMemorySkill(
      ".",
      "search-long-term-memory-skill",
    );

    const res = await skill.execute(
      {
        queries: [
          {
            index0: "",
            index1: "",
            memory: "最近可能相关的长期记忆",
            limit: 50,
          },
        ],
      },
      {
        actorId: 1,
        server: {
          memoryManager: {
            search: vi.fn(),
          },
        } as any,
      },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("Use get_skill");
    expect(res.error).toContain("index0");
    expect(res.error).toContain("过往事件");
  });

  test("does not validate index0 and index1 combinations", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const skill = new SearchLongTermMemorySkill(
      ".",
      "search-long-term-memory-skill",
    );

    const res = await skill.execute(
      {
        queries: [
          {
            index0: "经验方法",
            index1: "owner",
            memory: "当 owner 丢梗时应该怎样接话",
            limit: 10,
          },
        ],
      },
      {
        actorId: 1,
        server: {
          memoryManager: {
            search,
          },
        } as any,
      },
    );

    expect(res.success).toBe(true);
    expect(search).toHaveBeenCalledWith(
      1,
      "当 owner 丢梗时应该怎样接话",
      10,
      "经验方法",
      "owner",
    );
  });

  test("rejects too-small limits", async () => {
    const skill = new SearchLongTermMemorySkill(
      ".",
      "search-long-term-memory-skill",
    );

    const res = await skill.execute(
      {
        queries: [
          {
            index0: "经验方法",
            index1: "general",
            memory: "当 owner 丢梗时应该怎样接话",
            limit: 5,
          },
        ],
      },
      {
        actorId: 1,
        server: {
          memoryManager: {
            search: vi.fn(),
          },
        } as any,
      },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("Use get_skill");
    expect(res.error).toContain("10");
  });
});
