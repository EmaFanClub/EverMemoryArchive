import { EventEmitter } from "node:events";
import { type LLMClient } from "./llm";
import { AgentConfig } from "./config";
import { Logger } from "./logger";
import { MessageHistory, RetryExhaustedError, isAbortError } from "./llm/base";
import type { LLMResponse, Message, Content, FunctionResponse } from "./schema";
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
    !last.contents.some((content) => content.type === "function_call")
  );
}

/** Callback type for running the agent with a given state. */
export type AgentStateCallback = (
  next: (state: AgentState) => Promise<void>,
) => Promise<void>;

/** Manages conversation context and message history for the agent. */
export class ContextManager {
  llmClient: LLMClient;
  events: AgentEventsEmitter;
  logger: Logger;

  private _state: AgentState = {
    systemPrompt: "",
    messages: [],
    tools: [],
  };

  constructor(
    llmClient: LLMClient,
    events: AgentEventsEmitter,
    logger: Logger,
    public history: MessageHistory = llmClient.createHistory(),
  ) {
    this.llmClient = llmClient;
    this.events = events;
    this.logger = logger;
  }

  get state(): AgentState {
    return this._state;
  }

  set state(v: AgentState) {
    this._state = v;
    // trigger the messages setter
    this.messages = v.messages;
  }

  get systemPrompt(): string {
    return this._state.systemPrompt;
  }

  set systemPrompt(v: string) {
    this._state.systemPrompt = v;
  }

  get messages(): Message[] {
    return this._state.messages;
  }

  set messages(v: Message[]) {
    this._state.messages = v;
    this.history = v.reduce(
      (acc, msg) => acc.appendMessage(msg),
      this.llmClient.createHistory(),
    );
  }

  get tools(): Tool[] {
    return this._state.tools;
  }

  set tools(v: Tool[]) {
    this._state.tools = v;
  }

  get toolContext(): ToolContext | undefined {
    return this._state.toolContext;
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
    level: "debug",
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
    const maxSteps = this.config.maxSteps;
    let step = 0;

    this.logger.debug(
      `request ${this.contextManager.messages.length} messages`,
      this.contextManager.messages,
    );

    const handler = this.llm.buildHandler(
      this.contextManager.tools,
      this.contextManager.systemPrompt,
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
        response = await handler.generate(
          this.contextManager.history,
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
        const errorMsg = `LLM call failed: ${(error as Error).message}`;
        this.events.emit("runFinished", {
          ok: false,
          msg: errorMsg,
          error: error as Error,
        });
        this.logger.error(errorMsg);
        return;
      }

      if (this.abortRequested) {
        this.finishAborted();
        return;
      }

      // Add model message to context
      this.contextManager.history.addModelMessage(response);

      // Check if task is complete (no tool calls)
      if (checkCompleteMessages(this.contextManager.messages)) {
        this.events.emit("runFinished", {
          ok: true,
          msg: response.finishReason,
        });
        this.logger.debug(`Run finished: ${response.finishReason}`);
        return;
      }

      // Execute tool calls
      // The loop cannot be interrupted during the process.
      const functionCalls = response.message.contents.filter(
        (content) => content.type === "function_call",
      );
      const functionResponses: FunctionResponse[] = [];
      for (const functionCall of functionCalls) {
        const toolCallId = functionCall.id;
        const functionName = functionCall.name;
        const callArgs = functionCall.args;

        this.logger.debug(`Tool call [${functionName}]`, callArgs);

        if (functionCalls.length > 1) {
          functionResponses.push({
            type: "function_response",
            id: toolCallId,
            name: functionName,
            result: {
              success: false,
              error: `Don't call multiple functions parallely.`,
            },
          });
          continue;
        }

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
              this.contextManager.toolContext,
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

        // Add function response to list
        functionResponses.push({
          type: "function_response",
          id: toolCallId,
          name: functionName,
          result: result,
        });
      }

      // Add all function responses to context
      this.contextManager.history.addToolMessage(functionResponses);

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
