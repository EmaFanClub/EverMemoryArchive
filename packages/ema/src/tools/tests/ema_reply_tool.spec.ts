import { describe, it, expect, beforeEach, vi } from "vitest";
import { EmaReplyTool } from "../ema_reply_tool";

vi.mock("../../skills/sticker-skill/pack", () => ({
  getStickerById: vi.fn(async (id: string) =>
    id === "test_sticker_1"
      ? {
          id: "test_sticker_1",
          name: "测试表情",
          description: "用于测试",
          file: "test.png",
          pack: "测试表情包",
          packDirName: "test-pack",
          packDirPath: "/mock/stickers/test-pack",
          filePath: "/mock/stickers/test-pack/test.png",
        }
      : null,
  ),
}));

describe("EmaReplyTool", () => {
  let tool: EmaReplyTool;

  beforeEach(() => {
    tool = new EmaReplyTool();
  });

  it("should have correct name and description", () => {
    expect(tool.name).toBe("ema_reply");
    expect(tool.description).toContain("唯一方式");
    expect(tool.description).toContain("避免用文字过度解释");
    expect(tool.description).toContain("sticker-skill");
  });

  it("should expose required parameters schema", () => {
    const params = tool.parameters;
    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("kind");
    expect(params.properties).toHaveProperty("think");
    expect(params.properties).toHaveProperty("content");
    expect(params.required).toContain("kind");
    expect(params.required).not.toContain("think");
    expect(params.required).toContain("content");
  });

  it("should execute successfully with valid inputs", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "我应该回复用户",
      content: "  你好，很高兴见到你  ",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBeTruthy();

    const parsed = JSON.parse(result.content as string);
    expect(parsed.kind).toBe("text");
    expect(parsed.think).toBe("我应该回复用户");
    expect(parsed.content).toBe("  你好，很高兴见到你  ");
  });

  it("normalizes think into one line", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "先看情况\\n再回复\n如果不确定\r\n就短问一句",
      content: "第一行\\n第二行",
    });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content as string);
    expect(parsed.think).toBe("先看情况 再回复 如果不确定 就短问一句");
    expect(parsed.content).toBe("第一行\n第二行");
  });

  it("rejects think that becomes empty after normalization", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "\\n\n\r\n",
      content: "回复",
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("think must not be empty");
  });

  it("accepts text replies without think", async () => {
    const result = await tool.execute({
      kind: "text",
      content: "回复",
    });

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content as string)).toEqual({
      kind: "text",
      content: "回复",
    });
  });

  it("accepts empty reply text", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "先不说话",
      content: "",
    });

    expect(result.success).toBe(true);
  });

  it("accepts sticker replies with valid sticker ids", async () => {
    const result = await tool.execute({
      kind: "sticker",
      think: "发个比心更贴切",
      content: "test_sticker_1",
    });

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content as string)).toMatchObject({
      kind: "sticker",
      content: "test_sticker_1",
    });
  });

  it("rejects unknown sticker ids", async () => {
    const result = await tool.execute({
      kind: "sticker",
      think: "试试看",
      content: "missing_sticker",
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("Unknown sticker id");
  });

  it("rejects empty think when provided", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "",
      content: "回复",
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("Invalid structured reply");
  });
});
