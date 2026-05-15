import type { ImageItem } from "../llm/schema";
import type { Server } from "../server";

/** Tool execution result. */
export interface ToolExecutionResult {
  success: boolean;
  content?: string;
  images?: ImageItem[];
}

export type ToolResult = ToolExecutionResult;

/**
 * Context passed to tool executions.
 */
export interface ToolContext {
  /**
   * Server instance for accessing shared services.
   */
  server?: Server;
  actorId?: number;
  conversationId?: number;
  data?: Record<string, unknown>;
}

/** Base class for all tools. */
export abstract class Tool {
  /** Returns the tool name. */
  abstract name: string;

  /** Returns the tool description. */
  abstract description: string;

  /** Returns the tool parameters schema (JSON Schema format). */
  abstract parameters: Record<string, unknown>;

  /**
   * Executes the tool with arbitrary arguments.
   * @param args - Tool-specific arguments.
   * @param context - Optional tool context.
   */
  abstract execute(args: unknown, context?: ToolContext): Promise<ToolResult>;
}
