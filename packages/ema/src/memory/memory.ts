import dayjs from "dayjs";

import type { EmaReply } from "../tools/ema_reply_tool";
import type { Content, EmaMessage, UserMessage } from "../schema";

/**
 * Represents a persisted message with metadata for buffer history.
 */
export class BufferMessage {
  id: number;
  name: string;
  message: UserMessage | EmaMessage;
  time: number;

  /**
   * Creates a buffer message with user/actor metadata.
   *
   * Args:
   *   id: User or actor identifier.
   *   name: Display name for the sender.
   *   message: Message payload for persistence and rendering.
   *   time: Optional timestamp (milliseconds since epoch).
   */
  constructor(params: {
    id: number;
    name: string;
    message: UserMessage | EmaMessage;
    time?: number;
  }) {
    this.time = params.time ?? Date.now();
    this.id = params.id;
    this.name = params.name;
    this.message = params.message;
  }

  /**
   * Converts the buffer message to a user message for API calls.
   *
   * Returns:
   *   UserMessage with a context header prepended.
   */
  toUserMessage(): UserMessage {
    if (this.message.role !== "user") {
      throw new Error(`Expected user message, got ${this.message.role}`);
    }
    const context = [
      "[CONTEXT]",
      `time: ${dayjs(this.time).format("YYYY-MM-DD HH:mm:ss")}`,
      `id: ${this.id}`,
      `name: ${this.name}`,
      "[/CONTEXT]",
    ].join("\n");
    return {
      role: "user",
      contents: [{ type: "text", text: context }, ...this.message.contents],
    };
  }

  /**
   * Formats the message into a single line for prompt injection.
   *
   * Returns:
   *   Prompt line containing time, role, id, name, and message text.
   */
  toPrompt(): string {
    const contents = this.message.contents
      .map((part) => (part.type === "text" ? part.text : JSON.stringify(part)))
      .join("\n");
    return `- [${dayjs(this.time).format("YYYY-MM-DD HH:mm:ss")}][role:${
      this.message.role
    }][id:${this.id}][name:${this.name}] ${contents}`;
  }

  /**
   * Builds a buffer message from user inputs.
   *
   * Args:
   *   userId: User identifier.
   *   userName: User display name.
   *   inputs: User message contents.
   *   time: Optional timestamp (milliseconds since epoch).
   * Returns:
   *   A BufferMessage representing the user message.
   */
  static fromUser(
    userId: number,
    userName: string,
    inputs: Content[],
    time?: number,
  ): BufferMessage {
    return new BufferMessage({
      id: userId,
      name: userName,
      message: { role: "user", contents: inputs },
      time,
    });
  }

  /**
   * Builds a buffer message from an EMA reply.
   *
   * Args:
   *   actorId: Actor identifier.
   *   reply: EMA reply payload.
   *   time: Optional timestamp (milliseconds since epoch).
   * Returns:
   *   A BufferMessage representing the EMA reply.
   */
  static fromEma(
    actorId: number,
    reply: EmaReply,
    time?: number,
  ): BufferMessage {
    return new BufferMessage({
      id: actorId,
      name: "ema",
      message: {
        role: "ema",
        contents: [{ type: "text", text: JSON.stringify(reply) }],
      },
      time,
    });
  }
}

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
   * The memory buffer containing lightweight historical messages.
   */
  memoryBuffer: BufferMessage[];
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
  kind: "year" | "month" | "week" | "day";
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
