import { EventEmitter } from "node:events";

import type { LLMClient } from "../llm";
import { RetryExhaustedError, isAbortError } from "../llm/retry";
import { Logger } from "../shared/logger";
import type { Content, Message, ModelMessage, ToolResult } from "../llm/schema";
import { isToolCall } from "../llm/utils";
import type { Tool, ToolExecutionResult } from "../tools/base";
import type {
  AgentEventsEmitter,
  AgentState,
  AgentStateCallback,
} from "./base";

const AGENT_MAX_STEPS = 50;

/**
 * Reports whether the message history represents a complete model response.
 * @param messages - Message history to inspect.
 * @returns True when the last message is a model message without tool calls.
 */
export function checkCompleteMessages(messages: Message[]): boolean {
  if (messages.length === 0) {
    throw new Error("Message history is empty.");
  }
  const last = messages[messages.length - 1];
  return (
    last.role === "model" &&
    !last.contents.some((content) => isToolCall(content))
  );
}

/** Manages conversation context and message history for the agent. */
export class ContextManager {
  llmClient: LLMClient;
  events: AgentEventsEmitter;
  logger: Logger;

  state: AgentState = {
    systemPrompt: "",
    messages: [],
    tools: [],
  };

  constructor(
    llmClient: LLMClient,
    events: AgentEventsEmitter,
    logger: Logger,
  ) {
    this.llmClient = llmClient;
    this.events = events;
    this.logger = logger;
  }

  get systemPrompt(): string {
    return this.state.systemPrompt;
  }

  set systemPrompt(v: string) {
    this.state.systemPrompt = v;
  }

  get messages(): Message[] {
    return this.state.messages;
  }

  set messages(v: Message[]) {
    this.state.messages = v;
  }

  get tools(): Tool[] {
    return this.state.tools;
  }

  set tools(v: Tool[]) {
    this.state.tools = v;
  }

  /** Add a user message to context. */
  addUserMessage(contents: Content[]): void {
    this.messages.push({ role: "user", contents: contents });
  }

  /** Add an model message to context. */
  addModelMessage(message: ModelMessage): void {
    this.messages.push(message);
  }

  /** Add a tool result message to context. */
  addToolMessage(contents: ToolResult[]): void {
    this.messages.push({ role: "user", contents: contents });
  }

  /** Get message history (shallow copy). */
  getHistory(): Message[] {
    return [...this.messages];
  }
}

/** Single agent with basic tools and MCP support. */
export class Agent {
  /** Event emitter for agent lifecycle notifications. */
  readonly events: AgentEventsEmitter =
    new EventEmitter() as AgentEventsEmitter;
  /** Manages conversation context, history, and available tools. */
  private contextManager: ContextManager;
  /** Logger instance used for agent-related logging. */
  private logger: Logger = Logger.create({
    name: "agent",
    outputs: [
      { type: "console", level: "warn" },
      { type: "file", level: "warn" },
    ],
  });
  private status: "idle" | "running" = "idle";
  private abortController: AbortController | null = null;
  private abortRequested = false;

  constructor(
    /** LLM client used by the agent to generate responses. */
    private llm: LLMClient,
    /** Outside Logger used by the agent. */
    logger?: Logger,
  ) {
    if (logger) {
      this.logger = logger;
    }
    // Initialize context manager with tools
    this.contextManager = new ContextManager(
      this.llm,
      this.events,
      this.logger,
    );
  }

  isRunning(): boolean {
    return this.status !== "idle";
  }

  async abort(): Promise<void> {
    if (!this.isRunning()) {
      return;
    }
    this.abortRequested = true;
    this.abortController?.abort();
  }

  async runWithState(state: AgentState): Promise<void> {
    return this.run(async (loop) => {
      await loop(state);
    });
  }

  async run(callback: AgentStateCallback): Promise<void> {
    this.status = "running";
    this.abortRequested = false;
    this.abortController = new AbortController();
    let called = false;
    const loop = async (state: AgentState): Promise<void> => {
      if (called) {
        throw new Error("loop() has already been called.");
      }
      called = true;
      this.contextManager.state = state;
      await this.mainLoop();
    };
    try {
      await callback(loop);
    } finally {
      this.status = "idle";
      this.abortController = null;
    }
  }

  /** Execute agent loop until task is complete or max steps reached. */
  async mainLoop(): Promise<void> {
    const toolDict = new Map(this.contextManager.tools.map((t) => [t.name, t]));
    const maxSteps = AGENT_MAX_STEPS;
    let step = 0;
    const traceId = this.contextManager.state.traceId;

    while (step < maxSteps) {
      // Call LLM with context from context manager
      let response: ModelMessage;
      try {
        this.throwAbortIfRequested();
        this.llm.setRetryCallback((exception, attempt) => {
          this.logger.warn("LLM request retry", {
            traceId,
            step: step + 1,
            attempt,
            error: exception,
          });
        });
        response = await this.llm.generate({
          messages: this.contextManager.messages,
          tools: this.contextManager.tools,
          systemPrompt: this.contextManager.systemPrompt,
          traceId,
          signal: this.abortController?.signal,
        });
        this.throwAbortIfRequested();
      } catch (error) {
        this.handleGenerateError(error, traceId, step + 1);
        return;
      }

      this.emitLlmUsageReceived(response);

      // Add model message to context
      this.contextManager.addModelMessage(response);

      // Check if task is complete (no tool calls)
      if (checkCompleteMessages(this.contextManager.messages)) {
        const finishReason = response.metadata?.finishReason ?? "UNKNOWN";
        this.events.emit("runFinished", {
          ok: true,
          msg: finishReason,
        });
        return;
      }

      // Execute tool calls
      // The loop cannot be interrupted during the process.
      const toolCalls = response.contents.filter(isToolCall);
      const toolResults: ToolResult[] = [];
      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.toolCallId;
        const toolName = toolCall.name;
        const callArgs = toolCall.arguments;

        if (toolCalls.length > 1) {
          toolResults.push({
            type: "tool_result",
            toolCallId,
            name: toolName,
            result: {
              text: JSON.stringify({
                success: false,
                content: `Don't call multiple tools in parallel.`,
              }),
            },
          });
          this.logger.warn(
            `Multiple tool calls in a single response are not supported. Skipping tool [${toolName}].`,
            { traceId, step: step + 1, toolName },
          );
          continue;
        }

        // Execute tool
        let result: ToolExecutionResult;
        const tool = toolDict.get(toolName);
        const toolStartedAt = Date.now();
        if (!tool) {
          result = {
            success: false,
            content: `Unknown tool: ${toolName}`,
          };
        } else {
          try {
            result = await tool.execute(
              callArgs,
              this.contextManager.state.toolContext,
            );
          } catch (err) {
            const errorDetail = `${(err as Error).name}: ${(err as Error).message}`;
            const errorTrace = (err as Error).stack ?? "";
            result = {
              success: false,
              content: `Tool execution failed: ${errorDetail}\n\nTraceback:\n${errorTrace}`,
            };
          }
        }

        // Log tool execution result
        if (result.success) {
          if (toolName === "keep_silence" && result.content) {
            this.events.emit("keepSilenceReceived", {
              think: result.content,
            });
            this.contextManager.addModelMessage({
              role: "model",
              contents: [{ type: "text", text: "" }],
            });
            this.events.emit("runFinished", {
              ok: true,
              msg: "keep_silence",
            });
            return;
          }
          if (toolName === "ema_reply" && result.content) {
            this.events.emit("emaReplyReceived", {
              reply: JSON.parse(result.content!),
            });
            const { content, ...rest } = result;
            result = rest;
          }
        } else {
          this.logger.warn(`Tool [${toolName}] failed.`, {
            traceId,
            step: step + 1,
            toolName,
            durationMs: Date.now() - toolStartedAt,
            result,
          });
        }

        const { images, ...textPayload } = result;

        // Add tool result to list
        toolResults.push({
          type: "tool_result",
          toolCallId,
          name: toolName,
          result: {
            text: JSON.stringify(textPayload),
            ...(images?.length ? { images } : {}),
          },
        });
      }

      // Add all tool results to context
      this.contextManager.addToolMessage(toolResults);

      step += 1;
    }

    // Max steps reached
    const errorMsg = `Task couldn't be completed after ${maxSteps} steps.`;
    this.events.emit("runFinished", {
      ok: false,
      msg: errorMsg,
      error: new Error(errorMsg),
    });
    this.logger.error(errorMsg, { traceId, maxSteps });
    return;
  }

  private throwAbortIfRequested(): void {
    if (!this.abortRequested) {
      return;
    }
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
  }

  private handleGenerateError(
    error: unknown,
    traceId: string | undefined,
    step: number,
  ): void {
    if (isAbortError(error)) {
      this.finishAborted();
      return;
    }
    if (error instanceof RetryExhaustedError) {
      const errorMsg = `LLM call failed after ${error.attempts} retries. Last error: ${String(error.lastException)}`;
      this.events.emit("runFinished", {
        ok: false,
        msg: errorMsg,
        error,
      });
      this.logger.error(errorMsg, { traceId, step });
      return;
    }
    const resolvedError =
      error instanceof Error ? error : new Error(String(error));
    const errorMsg = `LLM call failed: ${resolvedError.message}`;
    this.events.emit("runFinished", {
      ok: false,
      msg: errorMsg,
      error: resolvedError,
    });
    this.logger.error(errorMsg, {
      traceId,
      step,
      error: resolvedError,
    });
  }

  private finishAborted(): void {
    const error = new Error("Aborted");
    this.events.emit("runFinished", {
      ok: false,
      msg: error.message,
      error,
    });
  }

  /** Get message history. */
  getHistory(): Message[] {
    return this.contextManager.getHistory();
  }

  private emitLlmUsageReceived(response: ModelMessage): void {
    const usageContext = this.contextManager.state.usageContext;
    const usageMetadata = response.metadata?.usageMetadata;
    if (!usageContext || !usageMetadata) {
      return;
    }
    this.events.emit("llmUsageReceived", {
      createdAt: Date.now(),
      model: this.llm.config.model,
      usageContext,
      usageMetadata,
    });
  }
}
