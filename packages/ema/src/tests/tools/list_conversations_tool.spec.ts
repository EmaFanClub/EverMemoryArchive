import { describe, expect, test, vi } from "vitest";

import { ListConversationsTool } from "../../tools/list_conversations_tool";

describe("ListConversationsTool", () => {
  test("returns actor-owned conversations in a model-friendly structure", async () => {
    const tool = new ListConversationsTool();

    const result = await tool.execute(
      {},
      {
        actorId: 1,
        server: {
          conversationDB: {
            listConversations: vi.fn().mockResolvedValue([
              {
                id: 18,
                name: "项目群",
                session: "qq-group-123456",
                description: "项目讨论群",
                allowProactive: false,
              },
              {
                id: 12,
                name: "Alice",
                session: "web-chat-1",
                description: "和 Alice 的私聊",
                allowProactive: true,
              },
            ]),
          },
        } as any,
      },
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content!)).toEqual({
      conversations: [
        {
          id: 12,
          name: "Alice",
          session: "web-chat-1",
          description: "和 Alice 的私聊",
        },
        {
          id: 18,
          name: "项目群",
          session: "qq-group-123456",
          description: "项目讨论群（不允许主动对话）",
        },
      ],
    });
  });
});
