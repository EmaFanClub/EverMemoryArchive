import { beforeEach, describe, expect, it, vi } from "vitest";

import { KeepSilenceTool } from "../keep_silence_tool";

describe("KeepSilenceTool", () => {
  let tool: KeepSilenceTool;

  beforeEach(() => {
    tool = new KeepSilenceTool();
  });

  it("has the expected name and description", () => {
    expect(tool.name).toBe("keep_silence");
    expect(tool.description).toContain("结束当前轮次");
    expect(tool.description).toContain("可追溯");
    expect(tool.description).toContain(
      "不要逐条复述上下文中已经可见的消息原文",
    );
    expect(tool.description).toContain("尽量写成一个自然段");
  });

  it("requires think in the parameter schema", () => {
    const params = tool.parameters;

    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("think");
    expect(params.properties).toHaveProperty("stop_following_group");
    expect(params.required).toContain("think");
    expect(params.required).not.toContain("stop_following_group");
  });

  it("returns think as the internal content", async () => {
    const result = await tool.execute({
      think:
        "这轮继续回复会重复刚才的意思，先停住；如果对方继续追问，再补充具体信息。",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe(
      "这轮继续回复会重复刚才的意思，先停住；如果对方继续追问，再补充具体信息。",
    );
  });

  it("normalizes think into one line", async () => {
    const result = await tool.execute({
      think: "先观察\\n不要追发\n如果对方继续问\r\n再重新参与",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("先观察 不要追发 如果对方继续问 再重新参与");
  });

  it("accepts the group stop-following flag", async () => {
    const result = await tool.execute(
      {
        think: "这个群聊暂时没有需要继续跟进的信息，等再次明确叫我时再参与。",
        stop_following_group: true,
      },
      {
        conversationId: 7,
        server: {
          dbService: {
            conversationDB: {
              getConversation: vi.fn(async () => ({
                id: 7,
                actorId: 1,
                session: "qq-group-1000",
              })),
            },
          },
        } as any,
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe(
      "这个群聊暂时没有需要继续跟进的信息，等再次明确叫我时再参与。",
    );
  });

  it("rejects group stop-following without a current group conversation", async () => {
    const result = await tool.execute({
      think: "私聊里不应该停止关注群聊。",
      stop_following_group: true,
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("stop_following_group");
    expect(result.content).toContain("group conversation");
  });

  it("rejects group stop-following in private conversations", async () => {
    const result = await tool.execute(
      {
        think: "私聊里不应该停止关注群聊。",
        stop_following_group: true,
      },
      {
        conversationId: 7,
        server: {
          dbService: {
            conversationDB: {
              getConversation: vi.fn(async () => ({
                id: 7,
                actorId: 1,
                session: "qq-chat-owner",
              })),
            },
          },
        } as any,
      },
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("stop_following_group");
    expect(result.content).toContain("group conversation");
  });

  it("rejects think that becomes empty after normalization", async () => {
    const result = await tool.execute({ think: "\\n\n\r\n" });

    expect(result.success).toBe(false);
    expect(result.content).toContain("think must not be empty");
  });

  it("rejects empty think", async () => {
    const result = await tool.execute({ think: "" });

    expect(result.success).toBe(false);
    expect(result.content).toContain("Invalid structured reply");
  });

  it("rejects unknown parameters", async () => {
    const result = await tool.execute({
      think: "先停住。",
      stop_following: true,
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("Invalid structured reply");
  });
});
