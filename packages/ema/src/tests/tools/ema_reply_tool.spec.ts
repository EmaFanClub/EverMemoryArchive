import { describe, it, expect, beforeEach } from "vitest";
import { EmaReplyTool } from "../../tools/ema_reply_tool";

describe("EmaReplyTool", () => {
  let tool: EmaReplyTool;

  beforeEach(() => {
    tool = new EmaReplyTool();
  });

  it("should have correct name and description", () => {
    expect(tool.name).toBe("ema_reply");
    expect(tool.description).toContain("JSON");
  });

  it("should expose required parameters schema", () => {
    const params = tool.parameters;
    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("think");
    expect(params.properties).toHaveProperty("expression");
    expect(params.properties).toHaveProperty("action");
    expect(params.properties).toHaveProperty("response");
    expect(params.required).toContain("think");
    expect(params.required).toContain("expression");
    expect(params.required).toContain("action");
    expect(params.required).toContain("response");
  });

  it("should execute successfully with valid inputs", async () => {
    const result = await tool.execute({
      think: "  我应该回复用户  ",
      expression: "微笑",
      action: "点头",
      response: "  你好，很高兴见到你  ",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBeTruthy();

    const parsed = JSON.parse(result.content as string);
    expect(parsed.think).toBe("  我应该回复用户  ");
    expect(parsed.expression).toBe("微笑");
    expect(parsed.action).toBe("点头");
    expect(parsed.response).toBe("  你好，很高兴见到你  ");
  });

  it("should reject invalid expression enum values", async () => {
    const result = await tool.execute({
      think: "想法",
      expression: "生气",
      action: "无",
      response: "回复",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid structured reply");
  });

  it("should reject invalid action enum values", async () => {
    const result = await tool.execute({
      think: "想法",
      expression: "普通",
      action: "跳舞",
      response: "回复",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid structured reply");
  });

  it("should reject empty strings", async () => {
    const result = await tool.execute({
      think: "",
      expression: "普通",
      action: "无",
      response: "",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid structured reply");
  });
});
