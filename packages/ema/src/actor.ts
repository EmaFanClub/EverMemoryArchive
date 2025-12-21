// import type { Message } from "../schema";
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
   *     parts: [{ type: "text", context: line }],
   *   };
   *   await this.work(input);
   * }
   * ```
   */
  async work(input: ActorInput) {
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

export interface ActorInput {
  parts: ActorTextInput[];
}

export interface ActorTextInput {
  type: "text";
  context: string;
}
