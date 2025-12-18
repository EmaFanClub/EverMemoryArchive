/** Base tool classes. */

/** Tool execution result. */
export class ToolResult {
  success: boolean;
  content: string;
  error: string | null;

  constructor(options: {
    success: boolean;
    content?: string;
    error?: string | null;
  }) {
    this.success = options.success;
    this.content = options.content ?? "";
    this.error = options.error ?? null;
  }
}

/** Base class for all tools. */
export abstract class Tool {
  /** Tool name. */
  abstract get name(): string;

  /** Tool description. */
  abstract get description(): string;

  /** Tool parameters schema (JSON Schema format). */
  abstract get parameters(): Record<string, any>;

  /** Execute the tool with arbitrary arguments. */
  abstract execute(...args: any[]): Promise<ToolResult>;

  /** Convert tool to Anthropic tool schema. */
  toSchema(): Record<string, any> {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.parameters,
    };
  }

  /** Convert tool to OpenAI tool schema. */
  toOpenaiSchema(): Record<string, any> {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}
