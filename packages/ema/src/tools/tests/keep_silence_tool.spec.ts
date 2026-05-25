import { beforeEach, describe, expect, it } from "vitest";

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
    expect(params.required).toContain("think");
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
});
