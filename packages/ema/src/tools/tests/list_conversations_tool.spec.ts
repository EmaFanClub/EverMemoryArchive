import { describe, expect, test, vi } from "vitest";

import { ListConversationsTool } from "../list_conversations_tool";

describe("ListConversationsTool", () => {
  test("returns actor-owned conversations in a model-friendly structure", async () => {
    const tool = new ListConversationsTool();

    const result = await tool.execute(
      {},
      {
        actorId: 1,
        server: {
          dbService: {
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
          },
        } as any,
      },
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content!)).toEqual({
      conversations: [
        {
          conversationId: 12,
          session: "web-chat-1",
          name: "Alice",
          description: "和 Alice 的私聊",
          allowProactive: true,
        },
        {
          conversationId: 18,
          session: "qq-group-123456",
          name: "项目群",
          description: "项目讨论群",
          allowProactive: false,
        },
      ],
    });
  });
});
