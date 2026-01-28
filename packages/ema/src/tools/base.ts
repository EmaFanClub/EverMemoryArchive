import type { ActorScope } from "../actor";
import type { Server } from "../server";

/** Tool execution result. */
export interface ToolResult {
  success: boolean;
  content?: string;
  error?: string;
}

/**
 * Context passed to tool executions.
 */
export interface ToolContext {
  /**
   * Server instance for accessing shared services.
   */
  server?: Server;
  /**
   * Actor scope associated with the tool invocation.
   */
  actorScope?: ActorScope;
}

/** Base class for all tools. */
export abstract class Tool {
  /** Returns the tool name. */
  abstract name: string;

  /** Returns the tool description. */
  abstract description: string;

  /** Returns the tool parameters schema (JSON Schema format). */
  abstract parameters: Record<string, any>;

  /**
   * Executes the tool with arbitrary arguments.
   * @param args - Tool-specific arguments.
   * @param context - Optional tool context (e.g. actor scope).
   */
  abstract execute(args: any, context?: ToolContext): Promise<ToolResult>;
}
