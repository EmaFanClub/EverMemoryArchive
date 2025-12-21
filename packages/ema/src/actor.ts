// import type { Message } from "../schema";
import type { A } from "vitest/dist/chunks/environment.d.cL3nLXbE.js";
import { Agent } from "./agent";
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

export class ActorWorker implements ActorStateStorage, ActorMemory {
  private readonly actor: Agent = new Agent();

  constructor(
    private readonly actorId: number,
    private readonly actorDB: ActorDB,
    private readonly shortTermMemoryDB: ShortTermMemoryDB,
    private readonly longTermMemoryDB: LongTermMemoryDB,
    private readonly longTermMemorySearcher: LongTermMemorySearcher,
  ) {}

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
   *   const input: ActorInput = {
   *     message: { type: "text", content: line },
   *   };
   *   await this.work(input);
   * }
   * ```
   */
  async work(inputs: ActorInputs) {
    // TODO: implement actor stepping logic
    if (inputs.length === 0) {
      throw new Error("No inputs provided");
    }
    if (inputs.length > 1 || inputs[0].type !== "text") {
      throw new Error("Only single text input is supported currently");
    }
    const input = inputs[0] as ActorTextInput;
    while (true) {
      this.actor.contextManager.addUserMessage(input.content); // add user input to context
      await this.actor.run();
    }
  }

  /**
   * hold recent events
   */
  recentEvents: ActorEvents = [];
  subscribe(cb: (response: ActorResponse) => void) {
    cb({
      state: "idle",
      events: this.recentEvents,
    });
    // subscribe to events
    throw new Error("Not implemented");
  }
  unsubscribe(cb: (response: ActorResponse) => void) {
    // unsubscribe to events
    throw new Error("Not implemented");
  }

  async getState(): Promise<ActorState> {
    const actor = await this.actorDB.getActor(this.actorId);
    if (!actor) {
      throw new Error(`Actor ${this.actorId} not found`);
    }
    return actor;
  }

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

  async search(keywords: string[]): Promise<SearchActorMemoryResult> {
    const items = await this.longTermMemorySearcher.searchLongTermMemories({
      actorId: this.actorId,
      keywords,
    });

    return { items };
  }

  async addShortTermMemory(item: ShortTermMemory): Promise<void> {
    await this.shortTermMemoryDB.appendShortTermMemory({
      actorId: this.actorId,
      ...item,
    });
  }

  async addLongTermMemory(item: LongTermMemory): Promise<void> {
    await this.longTermMemoryDB.appendLongTermMemory({
      actorId: this.actorId,
      ...item,
    });
  }
}

/**
 * The response from the actor.
 */
interface ActorResponse {
  state: "running" | "idle";
  events: ActorEvents;
}

/**
 * The actor sends a message.
 */
export type ActorEvents = ActorEvent[];

export type ActorEvent = ActorMessage | AgentEvent;

interface ActorMessage {
  type: "message";
  content: string;
}

interface AgentEvent {
  type: AgentEventName;
  content: AgentEventContent<AgentEventName>;
}

/**
 * The input to the actor.
 */
export type ActorInputs = ActorInput[];

export type ActorInput = ActorTextInput | ActorOtherInput;

export interface ActorTextInput {
  type: "text";
  content: string;
}

// Facilitate the extension of other types of input
export interface ActorOtherInput {
  type: "other";
  content: any;
}
