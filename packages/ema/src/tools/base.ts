/** Tool execution result. */
export class ToolResult {
  success: boolean;
  content?: string;
  error?: string;

  constructor(options: {
    success: boolean;
    content?: string;
    error?: string | null;
  }) {
    this.success = options.success;
    this.content = options.content ?? undefined;
    this.error = options.error ?? undefined;
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
}
