import { describe, it, expect, beforeEach } from "vitest";
import { EmaReplyTool } from "../../tools/ema_reply_tool";

describe("EmaReplyTool", () => {
  let tool: EmaReplyTool;

  beforeEach(() => {
    tool = new EmaReplyTool();
  });

  it("should have correct name and description", () => {
    expect(tool.name).toBe("ema_reply");
    expect(tool.description).toContain("唯一渠道");
  });

  it("should expose required parameters schema", () => {
    const params = tool.parameters;
    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("think");
    expect(params.properties).toHaveProperty("expression");
    expect(params.properties).toHaveProperty("action");
    expect(params.properties).toHaveProperty("contents");
    expect(params.required).toContain("think");
    expect(params.required).toContain("expression");
    expect(params.required).toContain("action");
    expect(params.required).toContain("contents");
  });

  it("should execute successfully with valid inputs", async () => {
    const result = await tool.execute({
      think: "  我应该回复用户  ",
      expression: "微笑",
      action: "点头",
      contents: "  你好，很高兴见到你  ",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBeTruthy();

    const parsed = JSON.parse(result.content as string);
    expect(parsed.think).toBe("  我应该回复用户  ");
    expect(parsed.expression).toBe("微笑");
    expect(parsed.action).toBe("点头");
    expect(parsed.contents).toBe("  你好，很高兴见到你  ");
  });

  it("accepts arbitrary expression values", async () => {
    const result = await tool.execute({
      think: "想法",
      expression: "生气",
      action: "无",
      contents: "回复",
    });

    expect(result.success).toBe(true);
  });

  it("accepts arbitrary action values", async () => {
    const result = await tool.execute({
      think: "想法",
      expression: "普通",
      action: "跳舞",
      contents: "回复",
    });

    expect(result.success).toBe(true);
  });

  it("accepts empty reply text", async () => {
    const result = await tool.execute({
      think: "先不说话",
      expression: "普通",
      action: "无",
      contents: "",
    });

    expect(result.success).toBe(true);
  });

  it("should reject empty strings", async () => {
    const result = await tool.execute({
      think: "",
      expression: "普通",
      action: "无",
      contents: "",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid structured reply");
  });
});
