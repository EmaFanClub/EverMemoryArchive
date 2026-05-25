import { describe, expect, test } from "vitest";

import QueryChatHistorySkill from "..";
import type { ConversationMessageEntity } from "../../../db/base";
import type { BufferMessage } from "../../../memory/base";

function createServer(rows: ConversationMessageEntity[]) {
  const conversations = [
    {
      id: 1,
      actorId: 1,
      session: "qq-chat-10726371",
      name: "Default",
      description: "test",
    },
    {
      id: 2,
      actorId: 1,
      session: "qq-group-123456",
      name: "Group",
      description: "group",
    },
  ];
  return {
    dbService: {
      async getConversationBySession(actorId: number, session: string) {
        return (
          conversations.find(
            (item) => item.actorId === actorId && item.session === session,
          ) ?? null
        );
      },
      conversationDB: {
        async getConversation(conversationId: number) {
          return (
            conversations.find((item) => item.id === conversationId) ?? null
          );
        },
      },
      conversationMessageDB: {
        async listConversationMessages(req: {
          conversationId?: number;
          msgIds?: number[];
          limit?: number;
          sort?: "asc" | "desc";
        }) {
          let filtered = rows;
          if (typeof req.conversationId === "number") {
            filtered = filtered.filter(
              (row) => row.conversationId === req.conversationId,
            );
          }
          if (req.msgIds) {
            filtered = filtered.filter((row) =>
              req.msgIds?.includes(row.msgId),
            );
          }
          if (req.sort === "desc") {
            filtered = [...filtered].reverse();
          }
          return filtered.slice(0, req.limit);
        },
      },
    },
    memoryManager: {
      bufferWindowSize: 30,
      async getBuffer(conversationId: number): Promise<BufferMessage[]> {
        return rows
          .filter((row) => row.conversationId === conversationId)
          .map((row) => {
            if (row.message.kind === "user") {
              return {
                kind: "user" as const,
                speaker: {
                  session:
                    conversations.find((item) => item.id === conversationId)
                      ?.session ?? "",
                  uid: row.message.uid,
                  name: row.message.name,
                },
                msgId: row.msgId,
                contents: row.message.contents,
                time: row.createdAt ?? Date.now(),
              };
            }
            return {
              kind: "actor" as const,
              msgId: row.msgId,
              contents: row.message.contents,
              time: row.createdAt ?? Date.now(),
            };
          });
      },
      async getOwnerUid() {
        return null;
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
        session: "qq-chat-10726371",
        msg_ids: [7, 8],
      },
      {
        server: createServer([row]) as never,
        actorId: 1,
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain('msg_id="7"');
    expect(result.content).toContain("[图片：test.jpg] （image/jpeg）");
    expect(result.content).not.toContain("missing_msg_ids");
  });

  test("expand_one returns media images without redundant content", async () => {
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
        session: "qq-chat-10726371",
        msg_id: 7,
      },
      {
        server: createServer([row]) as never,
        actorId: 1,
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toBeUndefined();
    expect(result.images).toEqual([
      {
        type: "inline_data",
        mimeType: "image/jpeg",
        data: "base64-data",
      },
    ]);
  });

  test("window queries the fixed recent window for the provided session", async () => {
    const row: ConversationMessageEntity = {
      id: 2,
      actorId: 1,
      conversationId: 2,
      msgId: 9,
      createdAt: Date.UTC(2026, 2, 16, 12, 40, 31),
      message: {
        kind: "user",
        uid: "123456",
        name: "GroupUser",
        contents: [
          {
            type: "text",
            text: "有人在吗",
          },
        ],
      },
    };
    const skill = new QueryChatHistorySkill(".", "query-chat-history-skill");

    const result = await skill.execute(
      {
        mode: "window",
        session: "qq-group-123456",
      },
      {
        server: createServer([row]) as never,
        actorId: 1,
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain('msg_id="9"');
    expect(result.content).toContain("有人在吗");
  });

  test("requires session for every query mode", async () => {
    const skill = new QueryChatHistorySkill(".", "query-chat-history-skill");

    const result = await skill.execute(
      {
        mode: "by_ids",
        msg_ids: [7],
      },
      {
        server: createServer([]) as never,
        actorId: 1,
      },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("session");
  });
});
