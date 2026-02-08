import type { InputContent } from "../schema";

/**
 * Represents a persisted message with metadata for buffer history.
 */
export interface BufferMessage {
  /**
   * The role that produced the message.
   */
  kind: "user" | "actor";
  /**
   * The identifier of the message author (userId / actorId).
   */
  role_id: number;
  /**
   * The unique identifier of the persisted message.
   * May be absent before the message is stored.
   */
  msg_id?: number;
  /**
   * The message contents.
   */
  contents: InputContent[];
  /**
   * The time the message was recorded (Unix timestamp in milliseconds).
   */
  time: number;
}

/**
 * Interface for persisting and reading buffer messages.
 */
export interface BufferStorage {
  /**
   * Gets buffer messages.
   * @param conversationId - The conversation identifier to read.
   * @param count - The number of messages to return.
   * @returns Promise resolving to the buffer messages.
   */
  getBuffer(conversationId: number, count: number): Promise<BufferMessage[]>;
  /**
   * Adds a buffer message.
   * @param conversationId - The conversation identifier to write.
   * @param message - The buffer message to add.
   * @returns Promise resolving when the message is stored.
   */
  addBuffer(conversationId: number, message: BufferMessage): Promise<void>;
}

/**
 * Interface for persisting actor state.
 */
export interface ActorStateStorage {
  /**
   * Gets the state of the actor
   * @param actorId - The actor identifier to read.
   * @param conversationId - The conversation identifier to read.
   * @returns Promise resolving to the state of the actor
   */
  getState(actorId: number, conversationId: number): Promise<ActorState>;
}

/**
 * Runtime state for an actor.
 */
export interface ActorState {
  /**
   * The lastest short-term memory for the actor.
   */
  memoryDay: ShortTermMemory;
  memoryWeek: ShortTermMemory;
  memoryMonth: ShortTermMemory;
  memoryYear: ShortTermMemory;
  /**
   * The buffer messages for the actor.
   */
  buffer: BufferMessage[];
}

/**
 * Interface for actor memory.
 */
export interface ActorMemory {
  /**
   * Searches actor memory
   * @param actorId - The actor identifier to search.
   * @param memory - The memory text to search against.
   * @param limit - Maximum number of memories to return.
   * @param index0 - Optional index0 filter.
   * @param index1 - Optional index1 filter.
   * @returns Promise resolving to the search result
   */
  search(
    actorId: number,
    memory: string,
    limit: number,
    index0?: string,
    index1?: string,
  ): Promise<LongTermMemoryRecord[]>;
  /**
   * Lists short term memories for the actor
   * @param actorId - The actor identifier to query.
   * @param kind - Optional memory kind filter.
   * @param limit - Optional maximum number of memories to return.
   * @returns Promise resolving to short term memory records sorted by newest first.
   */
  getShortTermMemory(
    actorId: number,
    kind?: ShortTermMemory["kind"],
    limit?: number,
  ): Promise<ShortTermMemoryRecord[]>;
  /**
   * Adds short term memory
   * @param actorId - The actor identifier to update.
   * @param item - Short term memory item
   * @returns Promise resolving when the memory is added
   */
  addShortTermMemory(actorId: number, item: ShortTermMemory): Promise<void>;
  /**
   * Adds long term memory
   * @param actorId - The actor identifier to update.
   * @param item - Long term memory item
   * @returns Promise resolving when the memory is added
   */
  addLongTermMemory(actorId: number, item: LongTermMemory): Promise<void>;
}

/**
 * Result of searching actor memory.
 */

/**
 * Short-term memory item captured at a specific granularity.
 */
export interface ShortTermMemory {
  /**
   * The granularity of short term memory.
   */
  kind: "year" | "month" | "week" | "day";
  /**
   * The memory text when the actor saw the messages.
   */
  memory: string;
  /**
   * The date and time the memory was created.
   */
  createdAt?: number;
  /**
   * Related conversation message IDs for traceability.
   */
  messages?: number[];
}

/**
 * Short-term memory record with identifier.
 */
export type ShortTermMemoryRecord = ShortTermMemory & {
  /**
   * The unique identifier for the memory record.
   */
  id: number;
};

/**
 * Long-term memory item used for retrieval.
 */
export interface LongTermMemory {
  /**
   * The 0-index to search, a.k.a. 一级分类
   */
  index0: string;
  /**
   * The 1-index to search, a.k.a. 二级分类
   */
  index1: string;
  /**
   * The memory text when the actor saw the messages.
   */
  memory: string;
  /**
   * The date and time the memory was created
   */
  createdAt?: number;
  /**
   * Related conversation message IDs for traceability.
   */
  messages?: number[];
}

/**
 * Long-term memory record with identifier.
 */
export type LongTermMemoryRecord = LongTermMemory & {
  /**
   * The unique identifier for the memory record.
   */
  id: number;
};
