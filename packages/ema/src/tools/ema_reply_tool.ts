import { z } from "zod";

import { Tool, ToolResult } from "./base";

const EmaReplySchema = z
  .object({
    think: z
      .string()
      .trim()
      .min(1)
      .describe("内心独白或心里想法，语气可口语化，不直接说给对方听"),
    expression: z
      .enum(["neutral", "smile", "serious", "confused", "surprised", "sad"])
      .describe("表情或情绪状态"),
    action: z
      .enum(["none", "nod", "shake", "wave", "jump", "point"])
      .describe("肢体动作"),
    response: z
      .string()
      .trim()
      .min(1)
      .describe("说出口的内容，直接传达给用户的话语"),
  })
  .strict();

/** Tool that enforces JSON output matching the EmaReply shape. */
export class EmaReplyTool extends Tool {
  /** Unique tool name. */
  get name(): string {
    return "ema_reply";
  }

  /** Tool purpose and usage guidance. */
  get description(): string {
    // TODO: If we need to support multiple sentence replies, we need to modify the description here.
    return (
      "这个工具用于客户端格式化最终回复内容，确保回复内容为特定的JSON结构。" +
      "此工具的输出你不可见，会直接传递给用户，你只需要专注于生成符合要求的JSON内容即可。" +
      "如果工具执行失败，请尝试根据错误信息修正调用参数后重新调用此工具。" +
      "如果工具执行成功，请直接结束对话并不要继续生成任何内容。"
    );
  }

  /** JSON Schema specifying the expected arguments. */
  get parameters(): Record<string, any> {
    return EmaReplySchema.toJSONSchema();
  }

  /** Validate and emit a structured reply payload. */
  async execute(
    think: string,
    expression: string,
    action: string,
    response: string,
  ): Promise<ToolResult> {
    try {
      const payload = EmaReplySchema.parse({
        think,
        expression,
        action,
        response,
      });
      return new ToolResult({
        success: true,
        content: JSON.stringify(payload, null, 2),
      });
    } catch (err) {
      return new ToolResult({
        success: false,
        error: `Invalid structured reply: ${(err as Error).message}`,
      });
    }
  }
}
