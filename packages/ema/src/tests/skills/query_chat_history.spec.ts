import { describe, expect, test } from "vitest";

import QueryChatHistorySkill from "../../skills/query-chat-history-skill";
import type { ConversationMessageEntity } from "../../db/base";

function createServer(rows: ConversationMessageEntity[]) {
  return {
    dbService: {
      conversationDB: {
        async getConversation(conversationId: number) {
          if (conversationId !== 1) {
            return null;
          }
          return {
            id: 1,
            actorId: 1,
            session: "qq-chat-10726371",
            name: "Default",
            description: "test",
          };
        },
      },
      conversationMessageDB: {
        async listConversationMessages(req: {
          msgIds?: number[];
          limit?: number;
        }) {
          if (req.msgIds) {
            return rows.filter((row) => req.msgIds?.includes(row.msgId));
          }
          return rows.slice(0, req.limit);
        },
      },
    },
  };
}

describe("QueryChatHistorySkill", () => {
  test("formats by_ids messages using buffer-style summaries", async () => {
    const row: ConversationMessageEntity = {
      id: 1,
      actorId: 1,
      conversationId: 1,
      msgId: 7,
      createdAt: Date.UTC(2026, 2, 16, 12, 39, 31),
      message: {
        kind: "user",
        uid: "10726371",
        name: "Disviel",
        contents: [
          {
            type: "text",
            text: "[图片：test.jpg]",
          },
          {
            type: "inline_data",
            mimeType: "image/jpeg",
            data: "base64-data",
          },
        ],
      },
    };
    const skill = new QueryChatHistorySkill(".", "query-chat-history-skill");

    const result = await skill.execute(
      {
        mode: "by_ids",
        msg_ids: [7, 8],
      },
      {
        server: createServer([row]) as never,
        conversationId: 1,
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain('msg_id="7"');
    expect(result.content).toContain("[图片：test.jpg] （image/jpeg）");
    expect(result.content).not.toContain("missing_msg_ids");
  });

  test("expand_one returns media parts without redundant content", async () => {
    const row: ConversationMessageEntity = {
      id: 1,
      actorId: 1,
      conversationId: 1,
      msgId: 7,
      createdAt: Date.UTC(2026, 2, 16, 12, 39, 31),
      message: {
        kind: "user",
        uid: "10726371",
        name: "Disviel",
        contents: [
          {
            type: "inline_data",
            mimeType: "image/jpeg",
            data: "base64-data",
          },
        ],
      },
    };
    const skill = new QueryChatHistorySkill(".", "query-chat-history-skill");

    const result = await skill.execute(
      {
        mode: "expand_one",
        msg_id: 7,
      },
      {
        server: createServer([row]) as never,
        conversationId: 1,
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toBeUndefined();
    expect(result.parts).toEqual([
      {
        type: "inline_data",
        mimeType: "image/jpeg",
        data: "base64-data",
      },
    ]);
  });
});
