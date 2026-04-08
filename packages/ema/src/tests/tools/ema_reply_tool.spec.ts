import { describe, it, expect, beforeEach, vi } from "vitest";
import { EmaReplyTool } from "../../tools/ema_reply_tool";

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
  });

  it("should expose required parameters schema", () => {
    const params = tool.parameters;
    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("kind");
    expect(params.properties).toHaveProperty("think");
    expect(params.properties).toHaveProperty("expression");
    expect(params.properties).toHaveProperty("action");
    expect(params.properties).toHaveProperty("content");
    expect(params.required).toContain("kind");
    expect(params.required).toContain("think");
    expect(params.required).toContain("expression");
    expect(params.required).toContain("action");
    expect(params.required).toContain("content");
  });

  it("should execute successfully with valid inputs", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "  我应该回复用户  ",
      expression: "微笑",
      action: "点头",
      content: "  你好，很高兴见到你  ",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBeTruthy();

    const parsed = JSON.parse(result.content as string);
    expect(parsed.kind).toBe("text");
    expect(parsed.think).toBe("  我应该回复用户  ");
    expect(parsed.expression).toBe("微笑");
    expect(parsed.action).toBe("点头");
    expect(parsed.content).toBe("  你好，很高兴见到你  ");
  });

  it("accepts arbitrary expression values", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "想法",
      expression: "生气",
      action: "无",
      content: "回复",
    });

    expect(result.success).toBe(true);
  });

  it("accepts arbitrary action values", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "想法",
      expression: "普通",
      action: "跳舞",
      content: "回复",
    });

    expect(result.success).toBe(true);
  });

  it("accepts empty reply text", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "先不说话",
      expression: "普通",
      action: "无",
      content: "",
    });

    expect(result.success).toBe(true);
  });

  it("accepts sticker replies with valid sticker ids", async () => {
    const result = await tool.execute({
      kind: "sticker",
      think: "发个比心更贴切",
      expression: "开心",
      action: "比心",
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
      expression: "普通",
      action: "无",
      content: "missing_sticker",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown sticker id");
  });

  it("should reject empty strings", async () => {
    const result = await tool.execute({
      kind: "text",
      think: "",
      expression: "普通",
      action: "无",
      content: "",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid structured reply");
  });
});
