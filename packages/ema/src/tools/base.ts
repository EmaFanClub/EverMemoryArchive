/** Tool execution result. */
export interface ToolResult {
  success: boolean;
  content?: string;
  error?: string;
}

/** Base class for all tools. */
export abstract class Tool {
  /** Returns the tool name. */
  abstract name: string;

  /** Returns the tool description. */
  abstract description: string;

  /** Returns the tool parameters schema (JSON Schema format). */
  abstract parameters: Record<string, any>;

  /** Executes the tool with arbitrary arguments. */
  abstract execute(...args: any[]): Promise<ToolResult>;
}
