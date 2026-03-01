import type { Message } from "../schema";

/**
 * Compatibility-only types for legacy actor implementation in this branch.
 * These are intentionally not exported from `concept/index.ts`.
 */

export interface ActorStateStorage {
  getState(): Promise<ActorState>;
  updateState(state: ActorState): Promise<void>;
}

export interface ActorState {
  memoryBuffer: Message[];
}

export interface ActorMemory {
  search(keywords: string[]): Promise<SearchActorMemoryResult>;
  addShortTermMemory(item: ShortTermMemory): Promise<void>;
  addLongTermMemory(item: LongTermMemory): Promise<void>;
}

export interface SearchActorMemoryResult {
  items: LongTermMemory[];
}

export interface ShortTermMemory {
  kind: "year" | "month" | "day";
  os: string;
  statement: string;
  createdAt: number;
}

export interface LongTermMemory {
  index0: string;
  index1: string;
  keywords: string[];
  os: string;
  statement: string;
  createdAt: number;
}
