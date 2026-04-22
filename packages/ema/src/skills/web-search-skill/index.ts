import { z } from "zod";
import { Skill } from "../base";
import type { ToolContext, ToolResult } from "../../tools/base";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const TAVILY_EXTRACT_ENDPOINT = "https://api.tavily.com/extract";
const DEFAULT_TOPIC = "general" as const;
const DEFAULT_DAYS = 7;
const DEFAULT_MAX_RESULTS = 5;
const MAX_CONTENT_LENGTH = 500;

const SearchWebSchema = z
  .object({
    action: z.literal("search"),
    query: z.string().min(1).describe("要搜索的具体问题或主题"),
    topic: z
      .enum(["general", "news", "finance"])
      .optional()
      .default(DEFAULT_TOPIC)
      .describe("搜索主题"),
    days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .default(DEFAULT_DAYS)
      .describe("仅在 news 主题下使用的最近天数"),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(DEFAULT_MAX_RESULTS)
      .describe("返回结果数量上限"),
  })
  .strict();

const ExtractWebSchema = z
  .object({
    action: z.literal("extract"),
    url: z.string().url().describe("要展开读取的网页地址"),
    query: z
      .string()
      .min(1)
      .optional()
      .describe("可选，用于让 Tavily 按该意图挑选更相关的内容片段"),
    extract_depth: z
      .enum(["basic", "advanced"])
      .optional()
      .default("basic")
      .describe("提取深度"),
    format: z
      .enum(["markdown", "text"])
      .optional()
      .default("markdown")
      .describe("返回格式"),
  })
  .strict();

const WebSearchSkillSchema = z.discriminatedUnion("action", [
  SearchWebSchema,
  ExtractWebSchema,
]);

type WebSearchSkillInput = z.infer<typeof WebSearchSkillSchema>;

interface TavilySearchResponse {
  results?: Array<{
    title?: unknown;
    url?: unknown;
    content?: unknown;
    score?: unknown;
    published_date?: unknown;
    published_at?: unknown;
  }>;
}

interface TavilyExtractResponse {
  results?: Array<{
    title?: unknown;
    url?: unknown;
    content?: unknown;
    raw_content?: unknown;
  }>;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

/**
 * Web search skill backed by Tavily.
 */
export default class WebSearchSkill extends Skill {
  description =
    "此技能用于使用 Tavily 搜索外部网页信息，在需要了解最新信息或搜索某个具体主题时使用。";

  parameters = WebSearchSkillSchema.toJSONSchema();

  /**
   * Executes a Tavily web search scoped to the current actor owner.
   * @param args - Search parameters.
   * @param context - Tool context containing server and actor scope.
   * @returns Search result payload.
   */
  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    let payload: WebSearchSkillInput;
    try {
      payload = WebSearchSkillSchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        error: `Invalid web-search-skill input: ${(err as Error).message}. Use get_skill to check the required parameters and their formats.`,
      };
    }

    const server = context?.server;
    const actorId = context?.actorId;
    if (!server) {
      return {
        success: false,
        error: "Missing server in skill context.",
      };
    }
    if (!actorId) {
      return {
        success: false,
        error: "Missing actorId in skill context.",
      };
    }

    const userId = await server.dbService.userOwnActorDB.getActorOwner(actorId);
    if (typeof userId !== "number") {
      return {
        success: false,
        error: "No owner user found for current actor.",
      };
    }
    const user = await server.dbService.userDB.getUser(userId);
    const apiKey = user?.tavilyApiKey?.trim();
    if (!apiKey) {
      return {
        success: false,
        error: "Missing Tavily API key for current user.",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(
        payload.action === "search" ? TAVILY_ENDPOINT : TAVILY_EXTRACT_ENDPOINT,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(payload.action === "search"
              ? {
                  query: payload.query,
                  topic: payload.topic,
                  ...(payload.topic === "news" ? { days: payload.days } : {}),
                  max_results: payload.max_results,
                  search_depth: "basic",
                  include_answer: false,
                  include_raw_content: false,
                }
              : {
                  urls: [payload.url],
                  ...(payload.query ? { query: payload.query } : {}),
                  extract_depth: payload.extract_depth,
                  format: payload.format,
                }),
          }),
          signal: controller.signal,
        },
      );

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          error: "Invalid Tavily API key for current user.",
        };
      }
      if (!response.ok) {
        return {
          success: false,
          error: `Tavily request failed with status ${response.status}.`,
        };
      }

      if (payload.action === "search") {
        const data = (await response.json()) as TavilySearchResponse;
        const results = Array.isArray(data.results)
          ? data.results.map((item) => ({
              title:
                typeof item.title === "string" && item.title.trim().length > 0
                  ? item.title.trim()
                  : "Untitled",
              url: typeof item.url === "string" ? item.url : "",
              content:
                typeof item.content === "string"
                  ? truncateText(item.content.trim(), MAX_CONTENT_LENGTH)
                  : "",
              ...(typeof item.score === "number" ? { score: item.score } : {}),
              ...(() => {
                const publishedAt =
                  typeof item.published_date === "string"
                    ? item.published_date
                    : typeof item.published_at === "string"
                      ? item.published_at
                      : null;
                return publishedAt ? { published_at: publishedAt } : {};
              })(),
            }))
          : [];

        return {
          success: true,
          content: JSON.stringify({
            action: "search",
            query: payload.query,
            results,
          }),
        };
      }

      const data = (await response.json()) as TavilyExtractResponse;
      const results = Array.isArray(data.results)
        ? data.results.map((item) => ({
            ...(typeof item.title === "string" && item.title.trim().length > 0
              ? { title: item.title.trim() }
              : {}),
            url: typeof item.url === "string" ? item.url : payload.url,
            content:
              typeof item.content === "string"
                ? truncateText(item.content.trim(), MAX_CONTENT_LENGTH)
                : typeof item.raw_content === "string"
                  ? truncateText(item.raw_content.trim(), MAX_CONTENT_LENGTH)
                  : "",
          }))
        : [];

      return {
        success: true,
        content: JSON.stringify({
          action: "extract",
          url: payload.url,
          results,
        }),
      };
    } catch (err) {
      return {
        success: false,
        error: `Tavily request failed: ${(err as Error).message}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
