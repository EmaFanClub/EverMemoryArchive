import { EventEmitter } from "node:events";
import type { Config } from "./config";
import { Agent, AgentEventNames } from "./agent";
import type { AgentEventName, AgentEvent, AgentEventUnion } from "./agent";
import type {
  ActorDB,
  LongTermMemoryDB,
  LongTermMemorySearcher,
  ShortTermMemoryDB,
  ConversationMessageDB,
} from "./db";
import type { BufferMessage } from "./memory/memory";
import {
  bufferMessageFromEma,
  bufferMessageFromUser,
  bufferMessageToPrompt,
  bufferMessageToUserMessage,
} from "./memory/utils";
import type {
  ActorState,
  SearchActorMemoryResult,
  ShortTermMemory,
  LongTermMemory,
  ActorStateStorage,
  ActorMemory,
} from "./memory/memory";
import { Logger } from "./logger";
import type { Content } from "./schema";
import { LLMClient } from "./llm";
import { type AgentState } from "./agent";

/** The scope information for the actor. */
export interface ActorScope {
  actorId: number;
  userId: number;
  conversationId?: number;
}

/**
 * A facade of the actor functionalities between the server (system) and the agent (actor).
 */
export class ActorWorker implements ActorStateStorage, ActorMemory {
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
    level: "full",
    transport: "console",
  });
  /** Cached agent state for the latest run. */
  private agentState: AgentState | null = null;
  /** Queue of pending actor input batches. */
  private queue: BufferMessage[] = [];
  /** Tracks whether a run produced any ema_reply events. */
  private hasEmaReplyInRun = false;
  /** Promise for the current agent run. */
  private currentRunPromise: Promise<void> | null = null;
  /** Ensures queue processing runs serially. */
  private processingQueue = false;
  /** Serializes buffer writes to preserve order. */
  private bufferWritePromise: Promise<void> = Promise.resolve();
  /** Whether the next run should reuse the current state after an abort. */
  private resumeStateAfterAbort = false;

  /**
   * Creates a new actor worker with storage access and event wiring.
   * @param config - Actor configuration.
   * @param userId - User identifier for message attribution.
   * @param userName - User display name for message attribution.
   * @param actorId - Actor identifier for memory and storage.
   * @param actorName - Actor display name for message attribution.
   * @param conversationId - Conversation identifier for message history.
   * @param actorDB - Actor persistence interface.
   * @param conversationMessageDB - Conversation message persistence interface.
   * @param shortTermMemoryDB - Short-term memory persistence interface.
   * @param longTermMemoryDB - Long-term memory persistence interface.
   * @param longTermMemorySearcher - Long-term memory search interface.
   */
  constructor(
    private readonly config: Config,
    private readonly userId: number,
    private readonly userName: string,
    private readonly actorId: number,
    private readonly actorName: string,
    private readonly conversationId: number,
    private readonly actorDB: ActorDB,
    private readonly conversationMessageDB: ConversationMessageDB,
    private readonly shortTermMemoryDB: ShortTermMemoryDB,
    private readonly longTermMemoryDB: LongTermMemoryDB,
    private readonly longTermMemorySearcher: LongTermMemorySearcher,
  ) {
    const llm = new LLMClient(this.config.llm);
    this.agent = new Agent(config.agent, llm);
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
   * Builds the system prompt by injecting the current short-term memory buffer.
   *
   * The placeholder `{MEMORY_BUFFER}` in the provided `systemPrompt` will be
   * replaced with a textual representation of up to the last 10 buffer items.
   * All occurrences of `{MEMORY_BUFFER}` are replaced. If the placeholder
   * does not appear in `systemPrompt`, the original string is returned.
   *
   * @param systemPrompt - The system prompt template containing `{MEMORY_BUFFER}`.
   * @returns The system prompt with the memory buffer injected.
   */
  async buildSystemPrompt(systemPrompt: string): Promise<string> {
    const bufferWindow = await this.getBuffer(10);
    const bufferText =
      bufferWindow.length === 0
        ? "None."
        : bufferWindow.map((item) => bufferMessageToPrompt(item)).join("\n");
    return systemPrompt.replaceAll("{MEMORY_BUFFER}", bufferText);
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
  async work(inputs: ActorInputs) {
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
    const bufferMessage = bufferMessageFromUser(
      this.userId,
      this.userName,
      inputs,
    );
    this.logger.debug(`Received input when [${this.currentStatus}].`, inputs);
    this.queue.push(bufferMessage);
    this.enqueueBufferWrite(bufferMessage);

    if (this.isBusy()) {
      await this.abortCurrentRun();
      this.resumeStateAfterAbort = !this.hasEmaReplyInRun;
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
      this.hasEmaReplyInRun = true;
      this.resumeStateAfterAbort = false;
      this.enqueueBufferWrite(
        bufferMessageFromEma(this.actorId, this.actorName, reply),
      );
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

  /**
   * Gets the state of the actor.
   * @returns The state of the actor.
   */
  async getState(): Promise<ActorState> {
    throw new Error("getState is not implemented yet.");
  }

  /**
   * Updates the state of the actor.
   * @param state - The state to update.
   */
  async updateState(state: ActorState): Promise<void> {
    throw new Error("updateState is not implemented yet.");
  }

  private async addBuffer(message: BufferMessage): Promise<void> {
    const payload =
      message.kind === "user"
        ? { kind: "user" as const, userId: message.id }
        : { kind: "actor" as const, actorId: message.id };
    await this.conversationMessageDB.addConversationMessage({
      conversationId: this.conversationId,
      message: {
        ...payload,
        contents: message.contents,
      },
      createdAt: message.time,
    });
  }

  private async getBuffer(count: number): Promise<BufferMessage[]> {
    const messages = await this.conversationMessageDB.listConversationMessages({
      conversationId: this.conversationId,
      limit: count,
      sort: "desc",
    });
    return [...messages].reverse().map((item) => {
      const message = item.message;
      if (message.kind === "user") {
        return {
          kind: "user",
          name: this.userName,
          id: message.userId,
          contents: message.contents,
          time: item.createdAt!,
        };
      }
      return {
        kind: "actor",
        name: this.actorName,
        id: message.actorId,
        contents: message.contents,
        time: item.createdAt!,
      };
    });
  }

  private enqueueBufferWrite(message: BufferMessage): void {
    this.bufferWritePromise = this.bufferWritePromise
      .then(() => this.addBuffer(message))
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
        if (this.resumeStateAfterAbort && this.agentState) {
          this.agentState.messages.push(
            ...batches.map((item) => bufferMessageToUserMessage(item)),
          );
        } else {
          this.agentState = {
            systemPrompt: await this.buildSystemPrompt(
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
            },
          };
        }
        this.resumeStateAfterAbort = false;
        this.hasEmaReplyInRun = false;
        this.setStatus("running");
        this.currentRunPromise = this.agent.runWithState(this.agentState);
        try {
          await this.currentRunPromise;
        } finally {
          this.currentRunPromise = null;
          if (!this.resumeStateAfterAbort) {
            this.agentState = null;
          }
          if (this.queue.length === 0 && !this.resumeStateAfterAbort) {
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

  /**
   * Searches the long-term memory for items matching the keywords.
   * @param keywords - The keywords to search for.
   * @returns The search results.
   */
  async search(keywords: string[]): Promise<SearchActorMemoryResult> {
    // todo: combine short-term memory search
    const items = await this.longTermMemorySearcher.searchLongTermMemories({
      actorId: this.actorId,
      keywords,
    });

    return { items };
  }

  /**
   * Adds a short-term memory item to the actor.
   * @param item - The short-term memory item to add.
   */
  async addShortTermMemory(item: ShortTermMemory): Promise<void> {
    // todo: enforce short-term memory limit
    await this.shortTermMemoryDB.appendShortTermMemory({
      actorId: this.actorId,
      ...item,
    });
  }

  /**
   * Adds a long-term memory item to the actor.
   * @param item - The long-term memory item to add.
   */
  async addLongTermMemory(item: LongTermMemory): Promise<void> {
    // todo: enforce long-term memory limit
    await this.longTermMemoryDB.appendLongTermMemory({
      actorId: this.actorId,
      ...item,
    });
  }
}

/**
 * A batch of actor inputs in one request.
 */
export type ActorInputs = Content[];

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
