import { EventEmitter } from "node:events";
import type { Config } from "./config";
import { Agent, AgentEventNames, checkCompleteMessages } from "./agent";
import type { AgentEventName, AgentEvent, AgentEventUnion } from "./agent";
import {
  bufferMessageFromEma,
  bufferMessageFromUser,
  bufferMessageToUserMessage,
} from "./memory/utils";
import type { BufferMessage } from "./memory/base";
import type { Server } from "./server";
import { Logger } from "./logger";
import type { InputContent } from "./schema";
import { LLMClient } from "./llm";
import { type AgentState } from "./agent";
import { formatTimestamp } from "./utils";

/** The scope information for the actor. */
export interface ActorScope {
  actorId: number;
  userId: number;
  conversationId: number;
}

/**
 * A facade of the actor functionalities between the server (system) and the agent (actor).
 */
export class ActorWorker {
  /** Event emitter for actor events. */
  readonly events: ActorEventsEmitter =
    new EventEmitter<ActorEventMap>() as ActorEventsEmitter;
  /** The agent instance. */
  private readonly agent: Agent;
  /** The current status of the actor. */
  private currentStatus: ActorStatus = "idle";
  /** Logger */
  private readonly logger: Logger = Logger.create({
    name: "actor",
    level: "debug",
    transport: "console",
  });
  /** Cached agent state for the latest run. */
  private agentState: AgentState | null = null;
  /** Queue of pending actor input batches. */
  private queue: BufferMessage[] = [];
  /** Promise for the current agent run. */
  private currentRunPromise: Promise<void> | null = null;
  /** Ensures queue processing runs serially. */
  private processingQueue = false;
  /** Serializes buffer writes to preserve order. */
  private bufferWritePromise: Promise<void> = Promise.resolve();

  /**
   * Creates a new actor worker with storage access and event wiring.
   * @param config - Actor configuration.
   * @param userId - User identifier for message attribution.
   * @param actorId - Actor identifier for memory and storage.
   * @param conversationId - Conversation identifier for message history.
   * @param server - Server instance for shared services.
   */
  constructor(
    private readonly config: Config,
    private readonly userId: number,
    private readonly actorId: number,
    private readonly conversationId: number,
    private readonly server: Server,
  ) {
    const llm = new LLMClient(this.config.llm);
    this.agent = new Agent(config.agent, llm, this.logger);
    this.bindAgentEvent();
  }

  private bindAgentEvent(
    events: AgentEventName[] = Object.values(AgentEventNames),
  ) {
    const bind = <K extends AgentEventName>(eventName: K) => {
      this.agent.events.on(eventName, (content: AgentEvent<K>) => {
        this.emitEvent("agent", { kind: eventName, content });
      });
    };
    events.forEach(bind);
  }

  /**
   * Enqueues inputs and runs the agent sequentially for this actor.
   * @param inputs - Batch of user inputs for a single request.
   * @returns A promise that resolves after the input is handled or queued.
   * @example
   * ```ts
   * // infinite loop of REPL
   * for (;;) {
   *   const line = prompt("YOU > ");
   *   const input: Content = { type: "text", text: line };
   *   await this.work([input]);
   * }
   * ```
   */
  async work(inputs: ActorInputs, addToBuffer: boolean = true): Promise<void> {
    // TODO: implement actor stepping logic
    if (inputs.length === 0) {
      throw new Error("No inputs provided");
    }
    for (const input of inputs) {
      if (input.type !== "text") {
        throw new Error("Only text input is supported currently");
      }
    }
    const input = inputs[0];
    this.emitEvent("message", {
      kind: "message",
      content: `Received input: ${input.text}.`,
    });
    const bufferMessage = bufferMessageFromUser(this.userId, inputs);
    this.logger.debug(`Received input when [${this.currentStatus}].`, inputs);
    this.queue.push(bufferMessage);

    if (addToBuffer) {
      this.enqueueBufferWrite(bufferMessage);
    }

    if (this.isBusy()) {
      await this.abortCurrentRun();
      return;
    }

    await this.processQueue();
  }

  /**
   * Emits an event to the event stream.
   * @param event - The event to emit.
   */
  private emitEvent<K extends ActorEventName>(
    event: K,
    content: ActorEvent<K>,
  ) {
    if (isAgentEvent(content, "emaReplyReceived")) {
      const reply = content.content.reply;
      if (reply.response.length === 0) return;
      this.enqueueBufferWrite(bufferMessageFromEma(this.actorId, reply));
    }
    this.events.emit(event, content);
  }

  private setStatus(status: ActorStatus): void {
    this.currentStatus = status;
    this.events.emit("message", {
      kind: "message",
      content: `Actor status: ${status}.`,
    });
  }

  /**
   * Reports whether the actor is currently preparing or running.
   * @returns True if not idle; otherwise false.
   */
  public isBusy(): boolean {
    return this.currentStatus !== "idle";
  }

  private enqueueBufferWrite(message: BufferMessage): void {
    this.bufferWritePromise = this.bufferWritePromise
      .then(() =>
        this.server.memoryManager.addBuffer(this.conversationId, message),
      )
      .catch((error) => {
        this.logger.error("Failed to write buffer:", error);
        throw error;
      });
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }
    this.processingQueue = true;
    try {
      while (this.queue.length > 0) {
        this.setStatus("preparing");
        const batches = this.queue.splice(0, this.queue.length);
        if (
          this.agentState &&
          !checkCompleteMessages(this.agentState.messages)
        ) {
          const messages = this.agentState.messages;
          if (messages.length === 0) {
            throw new Error("Cannot resume from an empty message history.");
          }
          const last = messages[messages.length - 1];
          if (last.role === "model") {
            throw new Error(
              "Cannot resume when the last message is a model message.",
            );
          }
          if (
            last.role === "user" &&
            last.contents.some(
              (content) => content.type === "function_response",
            )
          ) {
            const time = formatTimestamp("YYYY-MM-DD HH:mm:ss", Date.now());
            messages.push({
              role: "model",
              contents: [
                { type: "text", text: `<system time="${time}">` },
                {
                  type: "text",
                  text: "检测到用户插话。请综合考虑这条提示之前和之后的消息，理解上下文之间的关系后选择合适的回复方式，注意避免回复割裂和重复。",
                },
                { type: "text", text: `</system>` },
              ],
            });
          }
          messages.push(
            ...batches.map((item) => bufferMessageToUserMessage(item)),
          );
        } else {
          this.agentState = {
            systemPrompt: await this.server.memoryManager.buildSystemPrompt(
              this.actorId,
              this.conversationId,
              this.config.systemPrompt,
            ),
            messages: batches.map((item) => bufferMessageToUserMessage(item)),
            tools: this.config.baseTools,
            toolContext: {
              actorScope: {
                actorId: this.actorId,
                userId: this.userId,
                conversationId: this.conversationId,
              },
              server: this.server,
            },
          };
        }
        this.setStatus("running");
        this.currentRunPromise = this.agent.runWithState(this.agentState);
        try {
          await this.currentRunPromise;
        } finally {
          this.currentRunPromise = null;
          if (
            this.agentState &&
            checkCompleteMessages(this.agentState.messages)
          ) {
            this.agentState = null;
          }
          if (this.queue.length === 0) {
            this.setStatus("idle");
          }
        }
      }
    } finally {
      // TODO: Need to verify whether LLM is correct later.
      // this.processingQueue = false;
      // if (this.queue.length > 0) {
      //   void this.processQueue();
      // }
      this.processingQueue = false;
    }
  }

  private async abortCurrentRun(): Promise<void> {
    if (!this.currentRunPromise) {
      return;
    }
    await this.agent.abort();
    await this.currentRunPromise;
  }
}

/**
 * A batch of actor inputs in one request.
 */
export type ActorInputs = InputContent[];

/**
 * The status of the actor.
 */
export type ActorStatus = "preparing" | "running" | "idle";

/**
 * A message from the actor.
 */
export interface ActorMessageEvent {
  /** The kind of the event. */
  kind: "message";
  /** The content of the message. */
  content: string;
}

/**
 * A agent from the agent.
 */
export interface ActorAgentEvent {
  /** The kind of the event. */
  kind: AgentEventName;
  /** The content of the message. */
  content: AgentEventUnion;
}

/**
 * The event map for the actor client.
 */
export interface ActorEventMap {
  message: [ActorMessageEvent];
  agent: [ActorAgentEvent];
}

/**
 * A event from the actor.
 */
export type ActorEventName = keyof ActorEventMap;

/** Type mapping of actor event names to their corresponding event data types. */
export type ActorEvent<K extends ActorEventName> = ActorEventMap[K][0];

/** Union type of all actor event contents. */
export type ActorEventUnion = ActorEvent<ActorEventName>;

/** Constant mapping of actor event names for iteration */
export const ActorEventNames: Record<ActorEventName, ActorEventName> = {
  message: "message",
  agent: "agent",
};

/** Event source interface for the actor */
export interface ActorEventSource {
  on<K extends ActorEventName>(
    event: K,
    handler: (content: ActorEvent<K>) => void,
  ): this;
  off<K extends ActorEventName>(
    event: K,
    handler: (content: ActorEvent<K>) => void,
  ): this;
  once<K extends ActorEventName>(
    event: K,
    handler: (content: ActorEvent<K>) => void,
  ): this;
  emit<K extends ActorEventName>(event: K, content: ActorEvent<K>): boolean;
}

export type ActorEventsEmitter = EventEmitter<ActorEventMap> & ActorEventSource;

export function isAgentEvent<K extends AgentEventName | undefined>(
  event: ActorEventUnion,
  kind?: K,
): event is ActorAgentEvent &
  (K extends AgentEventName
    ? { kind: K; content: AgentEvent<K> }
    : ActorAgentEvent) {
  if (!event) return false;
  if (event.kind === "message") return false;
  return kind ? event.kind === kind : true;
}
