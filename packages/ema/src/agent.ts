import { EventEmitter } from "node:events";
import { type LLMClient } from "./llm";
import { AgentConfig } from "./config";
import { Logger } from "./logger";
import { RetryExhaustedError, isAbortError } from "./retry";
import {
  type LLMResponse,
  type Message,
  type Content,
  isModelMessage,
  isToolMessage,
  isUserMessage,
} from "./schema";
import type { Tool, ToolResult, ToolContext } from "./tools/base";
import type { EmaReply } from "./tools/ema_reply_tool";

/** Event emitted when the agent finishes a run. */
export interface RunFinishedEvent {
  ok: boolean;
  msg: string;
  error?: Error;
}

/* Emitted when the ema_reply tool is called successfully. */
export interface EmaReplyReceivedEvent {
  reply: EmaReply;
}

/** Map of agent event names to their corresponding event data types. */
export interface AgentEventMap {
  runFinished: [RunFinishedEvent];
  emaReplyReceived: [EmaReplyReceivedEvent];
}

/** Union type of all agent event names. */
export type AgentEventName = keyof AgentEventMap;

/** Type mapping of agent event names to their corresponding event data types. */
export type AgentEvent<K extends AgentEventName> = AgentEventMap[K][0];

/** Union type of all agent event contents. */
export type AgentEventUnion = AgentEvent<AgentEventName>;

/** Constant mapping of agent event names for iteration */
export const AgentEventNames: Record<AgentEventName, AgentEventName> = {
  runFinished: "runFinished",
  emaReplyReceived: "emaReplyReceived",
};

/** Event source interface for the agent. */
export interface AgentEventSource {
  on<K extends AgentEventName>(
    event: K,
    handler: (content: AgentEvent<K>) => void,
  ): this;
  off<K extends AgentEventName>(
    event: K,
    handler: (content: AgentEvent<K>) => void,
  ): this;
  once<K extends AgentEventName>(
    event: K,
    handler: (content: AgentEvent<K>) => void,
  ): this;
  emit<K extends AgentEventName>(event: K, content: AgentEvent<K>): boolean;
}

export type AgentEventsEmitter = EventEmitter<AgentEventMap> & AgentEventSource;

/** The state of the agent. */
export type AgentState = {
  systemPrompt: string;
  messages: Message[];
  tools: Tool[];
  toolContext?: ToolContext;
};

/** Callback type for running the agent with a given state. */
export type AgentStateCallback = (
  next: (state: AgentState) => Promise<void>,
) => Promise<void>;

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
    tokenLimit: number = 80000,
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
  addModelMessage(response: LLMResponse): void {
    this.messages.push(response.message);
  }

  /** Add a tool result message to context. */
  addToolMessage(result: ToolResult, name: string, toolCallId?: string): void {
    this.messages.push({
      role: "tool",
      id: toolCallId,
      name: name,
      result: result,
    });
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
    new EventEmitter<AgentEventMap>() as AgentEventsEmitter;
  /** Manages conversation context, history, and available tools. */
  private contextManager: ContextManager;
  /** Logger instance used for agent-related logging. */
  private logger: Logger = Logger.create({
    name: "agent",
    level: "full",
    transport: "console",
  });
  private status: "idle" | "running" = "idle";
  private abortController: AbortController | null = null;
  private abortRequested = false;

  constructor(
    /** Configuration for the agent. */
    private config: AgentConfig,
    /** LLM client used by the agent to generate responses. */
    private llm: LLMClient,
  ) {
    // Initialize context manager with tools
    this.contextManager = new ContextManager(
      this.llm,
      this.events,
      this.logger,
      this.config.tokenLimit,
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
    const maxSteps = this.config.maxSteps;
    let step = 0;

    this.logger.debug("System prompt:", this.contextManager.systemPrompt);

    this.logger.debug(
      `request ${this.contextManager.messages.length} messages`,
      this.contextManager.messages,
    );

    while (step < maxSteps) {
      if (this.abortRequested) {
        this.finishAborted();
        return;
      }
      this.logger.debug(`Step ${step + 1}/${maxSteps}`);

      // Call LLM with context from context manager
      let response: LLMResponse;
      try {
        response = await this.llm.generate(
          this.contextManager.messages,
          this.contextManager.tools,
          this.contextManager.systemPrompt,
          this.abortController?.signal,
        );
        this.logger.debug(`LLM response received.`, response);
      } catch (error) {
        if (isAbortError(error)) {
          this.finishAborted();
          return;
        }
        if (error instanceof RetryExhaustedError) {
          const errorMsg = `LLM call failed after ${error.attempts} retries. Last error: ${String(error.lastException)}`;
          this.events.emit("runFinished", {
            ok: false,
            msg: errorMsg,
            error: error as RetryExhaustedError,
          });
          this.logger.error(errorMsg);
          return;
        }
        this.logger.error(`LLM call failed: ${(error as Error).message}`);
        return;
      }

      if (this.abortRequested) {
        this.finishAborted();
        return;
      }

      // Add model message to context
      this.contextManager.addModelMessage(response);

      // Check if task is complete (no tool calls)
      if (
        !response.message.toolCalls ||
        response.message.toolCalls.length === 0
      ) {
        this.events.emit("runFinished", {
          ok: true,
          msg: response.finishReason,
        });
        this.logger.debug(`Run finished: ${response.finishReason}`);
        return;
      }

      // Execute tool calls
      for (const toolCall of response.message.toolCalls) {
        if (this.abortRequested) {
          this.finishAborted();
          return;
        }
        const toolCallId = toolCall.id;
        const functionName = toolCall.name;
        const callArgs = toolCall.args;

        this.logger.debug(`Tool call [${functionName}]`, callArgs);

        // Execute tool
        let result: ToolResult;
        const tool = toolDict.get(functionName);
        if (!tool) {
          result = {
            success: false,
            error: `Unknown tool: ${functionName}`,
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
              error: `Tool execution failed: ${errorDetail}\n\nTraceback:\n${errorTrace}`,
            };
          }
        }

        // Log tool execution result
        if (result.success) {
          if (functionName === "ema_reply" && result.success) {
            this.events.emit("emaReplyReceived", {
              reply: JSON.parse(result.content!),
            });
            result.content = undefined;
          }
          this.logger.debug(`Tool [${functionName}] done.`, result.content);
        } else {
          this.logger.error(`Tool [${functionName}] failed.`, result.error);
        }

        // Add tool result message to context
        this.contextManager.addToolMessage(result, functionName, toolCallId);
      }

      step += 1;
    }

    // Max steps reached
    const errorMsg = `Task couldn't be completed after ${maxSteps} steps.`;
    this.events.emit("runFinished", {
      ok: false,
      msg: errorMsg,
      error: new Error(errorMsg),
    });
    this.logger.error(errorMsg);
    return;
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
}
