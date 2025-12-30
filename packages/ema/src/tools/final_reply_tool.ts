import { Tool, ToolResult } from "./base";

/** Plain data class for structured final replies. */
export class LLMReply {
  /** Inner monologue; not surfaced to the user. */
  think!: string;
  /** Facial expression or emotion description. */
  expression!: string;
  /** Action being taken. */
  action!: string;
  /** Spoken content surfaced to the user. */
  response!: string;

  /** JSON Schema contract aligned with the class fields. */
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

  /** Normalize untyped input into a strongly-typed reply object. */
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
  /** Unique tool name. */
  get name(): string {
    return "final_reply";
  }

  /** Tool purpose and usage guidance. */
  get description(): string {
    return (
      "这个工具用于客户端格式化最终回复内容，确保回复内容为特定的JSON结构。" +
      "此工具的输出你不可见，会直接传递给用户，你只需要专注于生成符合要求的JSON内容即可。" +
      "如果工具执行失败，请尝试根据错误信息修正调用参数后重新调用此工具。" +
      "如果工具执行成功，请直接结束对话并不要继续生成任何内容。"
    );
  }

  /** JSON Schema specifying the expected arguments. */
  get parameters(): Record<string, any> {
    return LLMReply.schema;
  }

  /** Validate and emit a structured reply payload. */
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
        error: `Invalid structured reply: ${(err as Error).message}`,
      });
    }
  }
}
