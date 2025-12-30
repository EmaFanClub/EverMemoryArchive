import type { Message } from "../schema";

/**
 * Interface for persisting actor state
 */
export interface ActorStateStorage {
  /**
   * Gets the state of the actor
   * @returns Promise resolving to the state of the actor
   */
  getState(): Promise<ActorState>;
  /**
   * Updates the state of the actor
   * @param state - The state to update
   * @returns Promise resolving when the state is updated
   */
  updateState(state: ActorState): Promise<void>;
}

export interface ActorState {
  /**
   * The memory buffer, in the format of messages in OpenAI chat completion API.
   */
  memoryBuffer: Message[];
  // more state can be added here.
}

/**
 * Interface for actor memory
 */
export interface ActorMemory {
  /**
   * Searches actor memory
   * @param keywords - Keywords to search for
   * @returns Promise resolving to the search result
   */
  search(keywords: string[]): Promise<SearchActorMemoryResult>;
  /**
   * Adds short term memory
   * @param item - Short term memory item
   * @returns Promise resolving when the memory is added
   */
  addShortTermMemory(item: ShortTermMemory): Promise<void>;
  /**
   * Adds long term memory
   * @param item - Long term memory item
   * @returns Promise resolving when the memory is added
   */
  addLongTermMemory(item: LongTermMemory): Promise<void>;
}

/**
 * Result of searching agent memory
 */
export interface SearchActorMemoryResult {
  /**
   * The long term memories found
   */
  items: LongTermMemory[];
}

export interface ShortTermMemory {
  /**
   * The granularity of short term memory
   */
  kind: "year" | "month" | "day";
  /**
   * The os when the actor saw the messages.
   */
  os: string;
  /**
   * The statement when the actor saw the messages.
   */
  statement: string;
  /**
   * The date and time the memory was created
   */
  createdAt: number;
}

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
   * The keywords to search
   */
  keywords: string[];
  /**
   * The os when the actor saw the messages.
   */
  os: string;
  /**
   * The statement when the actor saw the messages.
   */
  statement: string;
  /**
   * The date and time the memory was created
   */
  createdAt: number;
}
