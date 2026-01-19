import type { Config } from "./config";
import { Agent, AgentEvents } from "./agent";
import type { AgentEventName, AgentEventContent } from "./agent";
import type {
  ActorDB,
  LongTermMemoryDB,
  LongTermMemorySearcher,
  ShortTermMemoryDB,
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
import type { Content, UserMessage } from "./schema";
import { LLMClient } from "./llm";
import { type AgentState } from "./agent";

/**
 * A facade of the actor functionalities between the server (system) and the agent (actor).
 */
export class ActorWorker implements ActorStateStorage, ActorMemory {
  /** The agent instance. */
  private readonly agent: Agent;
  /** The subscribers of the actor. */
  private readonly subscribers = new Set<(response: ActorResponse) => void>();
  /** The current status of the actor. */
  private currentStatus: ActorStatus = "idle";
  /** The event stream of the actor. */
  private eventStream = new EventHistory();
  /** Logger */
  private readonly logger: Logger = Logger.create({
    name: "actor",
    level: "full",
    transport: "console",
  });
  /** Cached agent state for the latest run. */
  private agentState: AgentState | null = null;
  /** In-memory buffer to simulate persisted records without DB. */
  private _buffer: BufferMessage[] = [];
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
   * @param actorId - Actor identifier for memory and storage.
   * @param actorDB - Actor persistence interface.
   * @param shortTermMemoryDB - Short-term memory persistence interface.
   * @param longTermMemoryDB - Long-term memory persistence interface.
   * @param longTermMemorySearcher - Long-term memory search interface.
   */
  constructor(
    private readonly config: Config,
    private readonly userId: number,
    private readonly actorId: number,
    private readonly actorDB: ActorDB,
    private readonly shortTermMemoryDB: ShortTermMemoryDB,
    private readonly longTermMemoryDB: LongTermMemoryDB,
    private readonly longTermMemorySearcher: LongTermMemorySearcher,
  ) {
    const llm = new LLMClient(this.config.llm);
    this.agent = new Agent(config.agent, llm);
    (Object.keys(AgentEvents) as AgentEventName[]).forEach((eventName) => {
      const handler = (content: AgentEventContent) => {
        this.emitEvent({ type: eventName, content: content });
      };
      this.agent.events.on(eventName, handler);
    });
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
    return systemPrompt.replace("{MEMORY_BUFFER}", bufferText);
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
    this.emitEvent({
      type: "message",
      content: `Received input: ${input.text}.`,
    });
    const bufferMessage = bufferMessageFromUser(this.userId, "User", inputs);
    this.logger.debug(`Received input when [${this.currentStatus}].`, inputs);
    this.queue.push(bufferMessage);
    this.enqueueBufferWrite(bufferMessage);

    if (this.isBusy()) {
      // Abort the current run if no ema reply has been produced yet.
      // if (!this.hasEmaReplyInRun) {
      //   this.resumeStateAfterAbort = true;
      //   await this.abortCurrentRun();
      // }
      this.resumeStateAfterAbort = !this.hasEmaReplyInRun;
      await this.abortCurrentRun();
      return;
    }

    await this.processQueue();
  }

  /**
   * Subscribes to the actor events.
   * @param cb - The callback to receive the actor events.
   */
  public subscribe(cb: (response: ActorResponse) => void) {
    cb({
      status: this.currentStatus,
      events: this.eventStream.pastEvents(),
    });
    this.subscribers.add(cb);
  }

  /**
   * Unsubscribes from the actor events.
   * @param cb - The callback to unsubscribe from.
   */
  public unsubscribe(cb: (response: ActorResponse) => void) {
    this.subscribers.delete(cb);
  }

  /**
   * Broadcasts the actor events to the subscribers.
   * @param status - The status of the actor.
   */
  private broadcast() {
    const response: ActorResponse = {
      status: this.currentStatus,
      events: this.eventStream.advance(),
    };
    for (const cb of this.subscribers) {
      cb({ ...response });
    }
  }

  /**
   * Emits an event to the event stream.
   * @param event - The event to emit.
   */
  private emitEvent(event: ActorEvent) {
    if (isAgentEvent(event, AgentEvents.emaReplyReceived)) {
      const reply = event.content.reply;
      this.hasEmaReplyInRun = true;
      this.enqueueBufferWrite(bufferMessageFromEma(this.userId, reply));
    }
    this.eventStream.push(event);
    this.broadcast();
  }

  private setStatus(status: ActorStatus): void {
    this.currentStatus = status;
    this.broadcast();
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
    // TODO: persist to DB
    await Promise.resolve();
    this._buffer.push(message);
  }

  private async getBuffer(count: number): Promise<BufferMessage[]> {
    // TODO: fetch from DB
    await Promise.resolve();
    return this._buffer.slice(-count);
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
 * Convert actor inputs to a single user message.
 */

/**
 * The response from the actor.
 */
export interface ActorResponse {
  /** A short status text of the actor. */
  status: ActorStatus;
  /** The events from the actor. */
  events: ActorEvent[];
}

/**
 * The status of the actor.
 */
export type ActorStatus = "preparing" | "running" | "idle";

/**
 * A event from the actor.
 */
export type ActorEvent = ActorMessage | AgentEvent;

/**
 * Type guard that narrows an actor event to a specific agent event (or any agent event).
 */
export function isAgentEvent<K extends AgentEventName | undefined>(
  event: ActorEvent | undefined,
  type?: K,
): event is AgentEvent &
  (K extends AgentEventName
    ? { type: K; content: AgentEventContent<K> }
    : AgentEvent) {
  if (!event) return false;
  if (event.type === "message") return false;
  return type ? event.type === type : true;
}

/**
 * A message from the actor.
 */
export interface ActorMessage {
  type: "message";
  /** The content of the message. */
  content: string;
}

/**
 * A event from the agent.
 */
export interface AgentEvent {
  /** The type of the event. */
  type: AgentEventName;
  /** The content of the event. */
  content: AgentEventContent<AgentEventName>;
}

/**
 * A history of newly produced actor events since agent started.
 */
class EventHistory {
  /** The index of the current event. */
  eventIdx = 0;
  /** The list of events. */
  events: ActorEvent[] = [];

  /** Pushes an event to the history. */
  push(event: ActorEvent) {
    this.events.push(event);
  }

  /** Advances the history to the next event. */
  advance() {
    const events = this.events.slice(this.eventIdx);
    this.eventIdx += events.length;
    return events;
  }

  /** Gets the past events. */
  pastEvents() {
    return this.events.slice(0, this.eventIdx);
  }
}
