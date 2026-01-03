import type { Config } from "./config";
import { Agent, AgentEvents } from "./agent";
import type { AgentEventName, AgentEventContent } from "./agent";
import type {
  ActorDB,
  LongTermMemoryDB,
  LongTermMemorySearcher,
  ShortTermMemoryDB,
} from "./db";
import type {
  ActorState,
  SearchActorMemoryResult,
  ShortTermMemory,
  LongTermMemory,
  ActorStateStorage,
  ActorMemory,
} from "./skills/memory";
import { LLMClient } from "./llm";

/**
 * A facade of the actor functionalities between the server (system) and the agent (actor).
 */
export class ActorWorker implements ActorStateStorage, ActorMemory {
  /** The agent instance. */
  public readonly agent: Agent;
  /** The subscribers of the actor. */
  private readonly subscribers = new Set<(response: ActorResponse) => void>();
  /** The current status of the actor. */
  private currentStatus: ActorStatus = "idle";
  /** The event stream of the actor. */
  private eventStream = new EventHistory();

  constructor(
    /** The config of the actor. */
    private readonly config: Config,
    /** The ID of the actor. */
    private readonly actorId: number,
    /** The database of the actor. */
    private readonly actorDB: ActorDB,
    /** The database of the short-term memory. */
    private readonly shortTermMemoryDB: ShortTermMemoryDB,
    /** The database of the long-term memory. */
    private readonly longTermMemoryDB: LongTermMemoryDB,
    /** The searcher of the long-term memory. */
    private readonly longTermMemorySearcher: LongTermMemorySearcher,
  ) {
    const llm = new LLMClient(this.config.llm);
    this.agent = new Agent(
      config.agent,
      llm,
      config.systemPrompt,
      [],
      config.baseTools,
    );
  }

  /**
   * A low-level function to step the actor.
   * Currently, we ensure that the actor processes the input sequentially.
   *
   * @param input - The input to the actor.
   * @example
   * ```ts
   * // infinite loop of REPL
   * for(;;) {
   *   const line = prompt("YOU > ");
   *   const input: ActorInput = { kind: "text", content: line };
   *   await this.work([input]);
   * }
   * ```
   */
  async work(inputs: ActorInput[]) {
    // TODO: implement actor stepping logic
    if (inputs.length === 0) {
      throw new Error("No inputs provided");
    }
    if (inputs.length > 1 || inputs[0].kind !== "text") {
      throw new Error("Only single text input is supported currently");
    }
    const input = inputs[0] as ActorTextInput;
    this.emitEvent({
      type: "message",
      content: `Received input: ${input.content}. Start running.`,
    });

    // push user input into the agent context
    this.agent.contextManager.addUserMessage([
      { type: "text", text: input.content },
    ]);

    // setup event listeners of all agent events
    const handlers: Array<
      [AgentEventName, (content: AgentEventContent) => void]
    > = [];
    (Object.keys(AgentEvents) as AgentEventName[]).forEach((eventName) => {
      const handler = (content: AgentEventContent) => {
        this.emitEvent({ type: eventName, content: content });
      };
      this.agent.events.on(eventName, handler);
      handlers.push([eventName, handler]);
    });

    try {
      await this.agent.run();
    } finally {
      // cleanup listeners and notify idle
      for (const [eventName, handler] of handlers) {
        this.agent.events.off(eventName, handler);
      }
      this.broadcast("idle");
    }
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
  private broadcast(status: ActorStatus) {
    const response: ActorResponse = {
      status: (this.currentStatus = status),
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
    this.eventStream.push(event);
    this.broadcast("running");
  }

  /**
   * Gets the state of the actor.
   * @returns The state of the actor.
   */
  async getState(): Promise<ActorState> {
    const actor = await this.actorDB.getActor(this.actorId);
    if (!actor) {
      throw new Error(`Actor ${this.actorId} not found`);
    }
    return actor;
  }

  /**
   * Updates the state of the actor.
   * @param state - The state to update.
   */
  async updateState(state: ActorState): Promise<void> {
    // todo: only update necessary fields so that we don't have to get state
    // from database every time
    let actor = await this.actorDB.getActor(this.actorId);
    if (!actor) {
      actor = {
        id: this.actorId,
        roleId: 1,
        memoryBuffer: [],
      };
    }

    actor.memoryBuffer = state.memoryBuffer;
    await this.actorDB.upsertActor(actor);
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
 * The input to the actor, including text, image, audio, video, etc.
 */
export type ActorInput = ActorTextInput;

/**
 * The text input to the actor.
 */
export interface ActorTextInput {
  /**
   * The kind of the input.
   */
  kind: "text";
  /**
   * The content of the input.
   */
  content: string;
}

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
export type ActorStatus = "running" | "idle";

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
