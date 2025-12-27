import { Tool, ToolResult } from "./base";

/** Plain data class for structured replies. */
export class LLMReply {
  think!: string;
  expression!: string;
  action!: string;
  response!: string;

  /** JSON Schema aligned with the class fields. */
  static schema = {
    type: "object",
    properties: {
      think: {
        type: "string",
        description: "内心独白/心里想法，语气可口语化，不直接说给对方听",
      },
      expression: {
        type: "string",
        description: "脸部/表情（文字描述），可带情绪色彩",
      },
      action: {
        type: "string",
        description: "当下执行的动作（贴近生活的描述）",
      },
      response: {
        type: "string",
        description: "说出口的内容，直接传达给用户的话语",
      },
    },
    required: ["think", "expression", "action", "response"],
  };

  static normalize(input: Record<string, unknown>): LLMReply {
    return {
      think: String(input.think ?? ""),
      expression: String(input.expression ?? ""),
      action: String(input.action ?? ""),
      response: String(input.response ?? ""),
    };
  }
}

/** Tool that enforces JSON output matching the LLMReply shape. */
export class FinalReplyTool extends Tool {
  get name(): string {
    return "final_reply";
  }

  get description(): string {
    return (
      "最终输出内容的格式化工具，确保回复内容为特定的JSON格式。" +
      "包含think, expression, action, response四个字段，分别表示内心独白、表情、动作和对用户的回复。" +
      "此工具即为最终回复，必须单独调用，调用后也不应再调用其他工具和回复其他信息。"
    );
  }

  get parameters(): Record<string, any> {
    return LLMReply.schema;
  }

  async execute(
    think: string,
    expression: string,
    action: string,
    response: string,
  ): Promise<ToolResult> {
    try {
      const payload = LLMReply.normalize({
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
        content: "",
        error: `Invalid structured reply: ${(err as Error).message}`,
      });
    }
  }
}
