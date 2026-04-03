import type { ActorChatInput, ActorChatResponse } from "../actor";
import type { MessageReplyRef, SpeakerInformation } from "../channel";
import type { InputContent } from "../schema";

export type BufferWriteMessage = ActorChatInput | ActorChatResponse;

/**
 * Shared fields for persisted buffer messages.
 */
export interface BufferMessageBase<
  K extends "user" | "actor" = "user" | "actor",
> {
  kind: K;
  /**
   * The actor-scoped readable message identifier.
   */
  msgId: number;
  /**
   * Optional message reply reference.
   */
  replyTo?: MessageReplyRef;
  /**
   * Visible contents of the message.
   */
  contents: InputContent[];
  /**
   * The time the message was recorded (Unix timestamp in milliseconds).
   */
  time: number;
}

export interface BufferUserMessage extends BufferMessageBase<"user"> {
  speaker: SpeakerInformation;
}

export interface BufferActorMessage extends BufferMessageBase<"actor"> {
  think?: string;
}

/**
 * Represents a persisted message with metadata for buffer history.
 */
export type BufferMessage = BufferUserMessage | BufferActorMessage;

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
   * Saves a chat message before it is added to the resumed buffer.
   * @param message - The runtime message to persist.
   * @returns Promise resolving when the message is stored.
   */
  persistChatMessage(message: BufferWriteMessage): Promise<void>;
  /**
   * Adds a persisted chat message into the resumed buffer.
   * @param conversationId - The conversation identifier.
   * @param msgId - Actor-scoped message identifier.
   * @param triggerActivityTick - Whether this add should participate in activity-tick triggering.
   * @param triggeredAt - Optional timestamp used when triggering activity-tick jobs.
   */
  addToBuffer(
    conversationId: number,
    msgId: number,
    triggerActivityTick: boolean,
    triggeredAt?: number,
  ): Promise<void>;
}

/**
 * Interface for actor memory.
 */
export interface ActorMemory {
  /**
   * Searches actor memory.
   * @param actorId - The actor identifier to search.
   * @param memory - The memory text to search against.
   * @param limit - Maximum number of memories to return.
   * @param index0 - Optional index0 filter.
   * @param index1 - Optional index1 filter.
   * @returns Promise resolving to the search result.
   */
  search(
    actorId: number,
    memory: string,
    limit: number,
    index0?: string,
    index1?: string,
  ): Promise<LongTermMemoryRecord[]>;
  /**
   * Lists short-term memories for the actor.
   * @param actorId - The actor identifier to query.
   * @param kind - Optional memory kind filter.
   * @param limit - Optional maximum number of memories to return.
   * @returns Promise resolving to short-term memory records sorted by newest first.
   */
  getShortTermMemory(
    actorId: number,
    kind?: ShortTermMemory["kind"],
    limit?: number,
  ): Promise<ShortTermMemoryRecord[]>;
  /**
   * Appends a new short-term memory item to the actor.
   * @param actorId - The actor identifier to update.
   * @param item - Short-term memory item.
   */
  appendShortTermMemory(actorId: number, item: ShortTermMemory): Promise<void>;
  /**
   * Inserts or updates a short-term memory item identified by kind and date.
   * @param actorId - The actor identifier to update.
   * @param item - Short-term memory item.
   */
  upsertShortTermMemory(actorId: number, item: ShortTermMemory): Promise<void>;
  /**
   * Marks the specified short-term memory records as processed.
   * @param actorId - The actor identifier to update.
   * @param ids - Memory record identifiers to mark.
   * @param processedAt - Processing timestamp.
   */
  markShortTermMemoryRecordsProcessed(
    actorId: number,
    ids: number[],
    processedAt: number,
  ): Promise<void>;
  /**
   * Adds long-term memory.
   * @param actorId - The actor identifier to update.
   * @param item - Long-term memory item.
   * @returns Promise resolving to the created memory identifier.
   */
  addLongTermMemory(actorId: number, item: LongTermMemory): Promise<number>;
}

/**
 * Short-term memory item captured at a specific granularity.
 */
export interface ShortTermMemory {
  /**
   * The granularity of short-term memory.
   */
  kind: "activity" | "day" | "month" | "year";
  /**
   * Canonical date key for the memory record.
   */
  date: string;
  /**
   * The memory text.
   */
  memory: string;
  /**
   * The date and time the memory was created.
   */
  createdAt?: number;
  /**
   * The date and time the memory was last updated.
   */
  updatedAt?: number;
  /**
   * The date and time the memory was consumed by a higher-level rollup.
   */
  processedAt?: number;
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
   * The 0-index to search, a.k.a. 一级分类.
   */
  index0: string;
  /**
   * The 1-index to search, a.k.a. 二级分类.
   */
  index1: string;
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
 * Long-term memory record with identifier.
 */
export type LongTermMemoryRecord = LongTermMemory & {
  /**
   * The unique identifier for the memory record.
   */
  id: number;
};
