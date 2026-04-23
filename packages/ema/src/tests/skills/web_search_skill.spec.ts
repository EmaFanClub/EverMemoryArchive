import { afterEach, describe, expect, test, vi } from "vitest";

import WebSearchSkill from "../../skills/web-search-skill";

describe("web-search-skill", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("returns error when Tavily API key is missing", async () => {
    const skill = new WebSearchSkill(".", "web-search-skill");

    const res = await skill.execute(
      { action: "search", query: "今天适合看什么新闻" },
      {
        actorId: 1,
        server: {
          dbService: {
            getActorWebSearchConfig: vi.fn().mockResolvedValue({
              enabled: false,
              tavilyApiKey: "",
            }),
          },
        } as any,
      },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("Web search is not configured");
  });

  test("returns error when Tavily API key is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      } satisfies Partial<Response>),
    );
    const skill = new WebSearchSkill(".", "web-search-skill");

    const res = await skill.execute(
      { action: "search", query: "最近有什么有趣新闻" },
      {
        actorId: 1,
        server: {
          dbService: {
            getActorWebSearchConfig: vi.fn().mockResolvedValue({
              enabled: true,
              tavilyApiKey: "bad-key",
            }),
          },
        } as any,
      },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("Invalid Tavily API key");
  });

  test("returns trimmed search results for the current actor", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "第一条结果",
            url: "https://example.com/a",
            content: "A".repeat(520),
            score: 0.98,
            published_date: "2026-04-09",
          },
          {
            title: "第二条结果",
            url: "https://example.com/b",
            content: "简短摘要",
          },
        ],
      }),
    } satisfies Partial<Response>);
    vi.stubGlobal("fetch", fetchMock);
    const skill = new WebSearchSkill(".", "web-search-skill");

    const res = await skill.execute(
      {
        action: "search",
        query: "最近关于猫耳魔女的有趣话题",
        topic: "news",
        days: 3,
        max_results: 2,
      },
      {
        actorId: 1,
        server: {
          dbService: {
            getActorWebSearchConfig: vi.fn().mockResolvedValue({
              enabled: true,
              tavilyApiKey: "good-key",
            }),
          },
        } as any,
      },
    );

    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer good-key",
        }),
      }),
    );
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      query: "最近关于猫耳魔女的有趣话题",
      topic: "news",
      days: 3,
      max_results: 2,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
    });
    expect(JSON.parse(res.content!)).toEqual({
      action: "search",
      query: "最近关于猫耳魔女的有趣话题",
      results: [
        {
          title: "第一条结果",
          url: "https://example.com/a",
          content: `${"A".repeat(499)}…`,
          score: 0.98,
          published_at: "2026-04-09",
        },
        {
          title: "第二条结果",
          url: "https://example.com/b",
          content: "简短摘要",
        },
      ],
    });
  });

  test("extracts a specific url after search", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "展开后的文章",
            url: "https://example.com/article",
            raw_content: "B".repeat(520),
          },
        ],
      }),
    } satisfies Partial<Response>);
    vi.stubGlobal("fetch", fetchMock);
    const skill = new WebSearchSkill(".", "web-search-skill");

    const res = await skill.execute(
      {
        action: "extract",
        url: "https://example.com/article",
        query: "文章里和魔女设定有关的内容",
        extract_depth: "advanced",
        format: "markdown",
      },
      {
        actorId: 1,
        server: {
          dbService: {
            getActorWebSearchConfig: vi.fn().mockResolvedValue({
              enabled: true,
              tavilyApiKey: "good-key",
            }),
          },
        } as any,
      },
    );

    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tavily.com/extract",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer good-key",
        }),
      }),
    );
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      urls: ["https://example.com/article"],
      query: "文章里和魔女设定有关的内容",
      extract_depth: "advanced",
      format: "markdown",
    });
    expect(JSON.parse(res.content!)).toEqual({
      action: "extract",
      url: "https://example.com/article",
      results: [
        {
          title: "展开后的文章",
          url: "https://example.com/article",
          content: `${"B".repeat(499)}…`,
        },
      ],
    });
  });
});
