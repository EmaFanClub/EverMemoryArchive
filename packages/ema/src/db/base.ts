/**
 * Database interfaces for EverMemoryArchive.
 *
 * + We associate roles with prompt and assets.
 * + We can clone roles to create actor entities. Each actor entity has a unique state, such as memory buffer.
 * + We can create users to access multiple actor entities.
 * + We can create conversations with actors. The conversations are not the same as the conversations in the system,
 *   but the messages array passed to the llm agent when calling openai APIs (`chat.completions.create`).
 * + We can create conversation messages, associated with a conversation.
 * + We can create short term memories for actors. The short term memories are associated with conversation messages (
 *   for debugging purpose).
 * + We can create long term memories for actors. The long term memories are associated with conversation messages (
 *   for debugging purpose).
 * + We can search long term memories. We can have multiple implementations, such as text-based searcher, vector-
 *   based searcher.
 *
 * All of the above interfaces, except the searcher, are implemented in mongo db. The searcher can be implemented by backends other
 * than mongo, like elasticsearch.
 *
 * See:
 * - {@link RoleDB}
 * - {@link ActorDB}
 * - {@link UserDB}
 * - {@link UserOwnActorDB}
 * - {@link ConversationDB}
 * - {@link ConversationMessageDB}
 * - {@link ShortTermMemoryDB}
 * - {@link LongTermMemoryDB}
 * - {@link LongTermMemorySearcher}
 */

import type { Message } from "../schema";

export interface Entity {
  id: string;
}

/**
 * Unix timestamp in milliseconds since the Unix epoch
 */
export type DbDate = number;

/**
 * Represents role data structure
 */
export interface RoleData {
  id?: number;
  name?: string;
  description?: string;
  prompt?: string;
  createTime?: number;
}

/**
 * Interface for role database operations
 */
export interface RoleDB {
  /**
   * Lists all roles in the database
   * @returns Promise resolving to an array of role data
   */
  listRoles(): Promise<RoleData[]>;

  /**
   * Gets a specific role by ID
   * @param roleId - The unique identifier for the role
   * @returns Promise resolving to the role data or null if not found
   */
  getRole(roleId: number): Promise<RoleData | null>;

  /**
   * Inserts or updates a role in the database
   * @param roleData - The role data to upsert
   * @returns Promise resolving to the ID of the created or updated role
   */
  upsertRole(roleData: RoleData): Promise<number>;

  /**
   * Deletes a role from the database
   * @param roleId - The unique identifier for the role to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteRole(roleId: number): Promise<boolean>;
}

/**
 * Represents actor data structure
 */
export interface ActorEntity extends Entity {
  /**
   * Each actor has exactly one role
   */
  roleId: string;
  /**
   * The memory buffer
   */
  memoryBuffer: Message[];
  /**
   * The date and time the actor was last updated
   */
  updatedAt: DbDate;
}

/**
 * Interface for actor database operations
 */
export interface ActorDB {
  /**
   * lists actors in the database
   * @returns Promise resolving to an array of actor data
   */
  listActors(): Promise<ActorEntity[]>;

  /**
   * gets an actor by id
   * @param id - The unique identifier for the actor
   * @returns Promise resolving to the actor data or null if not found
   */
  getActor(id: string): Promise<ActorEntity | null>;

  /**
   * inserts or updates an actor in the database
   * @param entity - The actor data to upsert
   * @returns Promise resolving when the operation completes
   */
  upsertActor(entity: ActorEntity): Promise<void>;

  /**
   * deletes an actor from the database
   * @param id - The unique identifier for the actor to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteActor(id: string): Promise<boolean>;
}

/**
 * Represents user data structure
 */
export interface UserEntity extends Entity {
  /**
   * The name of the user
   */
  name: string;
  /**
   * The description of the user
   */
  description: string;
  /**
   * The avatar of the user
   */
  avatar: string;
  /**
   * The email of the user
   */
  email: string;
  /**
   * The date and time the user was created
   */
  createdAt: DbDate;
  /**
   * The date and time the user was last updated
   */
  updatedAt: DbDate;
}

/**
 * Interface for user database operations
 */
export interface UserDB {
  /**
   * gets a user by id
   * @param id - The unique identifier for the user
   * @returns Promise resolving to the user data or null if not found
   */
  getUser(id: string): Promise<UserEntity | null>;
  /**
   * inserts or updates a user in the database
   * @param entity - The user data to upsert
   * @returns Promise resolving when the operation completes
   */
  upsertUser(entity: UserEntity): Promise<void>;
  /**
   * deletes a user from the database
   * @param id - The unique identifier for the user to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteUser(id: string): Promise<boolean>;
}

/**
 * Represents user own actor relation data structure
 */
export interface UserOwnActorRelation {
  /**
   * The user ID
   */
  userId: string;
  /**
   * The actor ID
   */
  actorId: string;
}

/**
 * Interface for user own actor relation database operations
 */
export interface UserOwnActorDB {
  /**
   * lists user own actor relations by user id
   * @param req - The request to list user own actor relations
   * @returns Promise resolving to an array of user own actor relation data
   */
  listUserOwnActorRelations(
    req: ListUserOwnActorRelationsRequest,
  ): Promise<UserOwnActorRelation[]>;
  /**
   * adds an actor to a user
   * @param entity - The user own actor relation data to add
   * @returns Promise resolving when the operation completes
   */
  addActorToUser(entity: UserOwnActorRelation): Promise<boolean>;
  /**
   * removes an actor from a user
   * @param entity - The user own actor relation data to remove
   * @returns Promise resolving when the operation completes
   */
  removeActorFromUser(entity: UserOwnActorRelation): Promise<boolean>;
}

export interface ListUserOwnActorRelationsRequest {
  /**
   * The user ID to filter user own actor relations by
   */
  userId?: string;
  /**
   * The actor ID to filter user own actor relations by
   */
  actorId?: string;
}

/**
 * Represents conversation data structure
 */
export interface ConversationEntity extends Entity {
  /**
   * The name of the conversation
   */
  name: string;
  /**
   * Which actor is the owner of this conversation
   */
  actorId: string;
  /**
   * The user ID that issues this conversation
   */
  userId: string;
  /**
   * The date and time the conversation was created
   */
  createdAt: DbDate;
  /**
   * The date and time the conversation was last updated
   */
  updatedAt: DbDate;
}

/**
 * Interface for conversation database operations
 */
export interface ConversationDB {
  /**
   * Lists conversations in the database
   * @returns Promise resolving to an array of conversation data
   */
  listConversations(
    req: ListConversationsRequest,
  ): Promise<ConversationEntity[]>;

  /**
   * gets a conversation by id
   * @param id - The unique identifier for the conversation
   * @returns Promise resolving to the conversation data or null if not found
   */
  getConversation(id: string): Promise<ConversationEntity | null>;

  /**
   * inserts or updates a conversation in the database
   * @param entity - The conversation data to upsert
   * @returns Promise resolving when the operation completes
   */
  upsertConversation(entity: ConversationEntity): Promise<void>;

  /**
   * deletes a conversation from the database
   * @param id - The unique identifier for the conversation to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteConversation(id: string): Promise<boolean>;
}

export interface ListConversationsRequest {
  /**
   * The actor ID to filter conversations by
   */
  actorId?: string;
  /**
   * The user ID to filter conversations by
   */
  userId?: string;
}

/**
 * Represents conversation message data structure
 */
export interface ConversationMessageEntity extends Entity {
  /**
   * The conversation ID
   */
  conversationId: string;
  /**
   * The message
   */
  message: Message;
  /**
   * The date and time the message was created
   */
  createdAt: DbDate;
}

/**
 * Interface for conversation message database operations
 */
export interface ConversationMessageDB {
  /**
   * lists conversation messages in the database
   * @returns Promise resolving to an array of conversation message data
   */
  listConversationMessages(
    req: ListConversationMessagesRequest,
  ): Promise<ConversationMessageEntity[]>;

  /**
   * gets a conversation message by id
   * @param id - The unique identifier for the conversation message
   * @returns Promise resolving to the conversation message data or null if not found
   */
  getConversationMessage(id: string): Promise<ConversationMessageEntity | null>;

  /**
   * inserts a conversation message in the database
   * @param entity - The conversation message to add
   * @returns Promise resolving when the operation completes
   */
  addConversationMessage(entity: ConversationMessageEntity): Promise<void>;

  /**
   * deletes a conversation message from the database
   * @param id - The unique identifier for the conversation message to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteConversationMessage(id: string): Promise<boolean>;
}

export interface ListConversationMessagesRequest {
  /**
   * The conversation ID to filter conversation messages by
   */
  conversationId?: string;
}

/**
 * Represents short term memory data structure
 */
export interface ShortTermMemoryEntity extends Entity {
  /**
   * The granularity of short term memory
   */
  kind: "year" | "month" | "day";
  /**
   * The owner of the short term memory
   */
  actorId: string;
  /**
   * The os when the actor saw the messages.
   */
  os: string;
  /**
   * The statement when the actor saw the messages.
   */
  statement: string;
  /**
   * The date and time the conversation was created
   */
  createdAt: DbDate;
  /**
   * The messages ids facilitating the short term memory, for debugging purpose.
   */
  messages: string[];
}

/**
 * Interface for short term memory database operations
 */
export interface ShortTermMemoryDB {
  /**
   * lists short term memories in the database
   * @returns Promise resolving to an array of short term memory data
   */
  listShortTermMemories(
    req: ListShortTermMemoriesRequest,
  ): Promise<ShortTermMemoryEntity[]>;
  /**
   * appends a short term memory to the database
   * @param entity - The short term memory to append
   * @returns Promise resolving when the operation completes
   */
  appendShortTermMemory(entity: ShortTermMemoryEntity): Promise<void>;
  /**
   * deletes a short term memory from the database
   * @param id - The unique identifier for the short term memory to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteShortTermMemory(id: string): Promise<boolean>;
}

export interface ListShortTermMemoriesRequest {
  /**
   * The actor ID to filter short term memories by
   */
  actorId?: string;
  /**
   * Filter short term memories created before the given date and time
   */
  createdBefore?: DbDate;
  /**
   * Filter short term memories created after the given date and time
   */
  createdAfter?: DbDate;
}

/**
 * Represents long term memory data structure
 */
export interface LongTermMemoryEntity extends Entity {
  /**
   * The owner of the long term memory
   */
  actorId: string;
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
   * The date and time the conversation was created
   */
  createdAt: DbDate;
  /**
   * The messages ids facilitating the long term memory, for debugging purpose.
   */
  messages: string[];
}

/**
 * Interface for long term memory database operations
 */
export interface LongTermMemoryDB {
  /**
   * lists long term memories in the database
   * @returns Promise resolving to an array of long term memory data
   */
  listLongTermMemories(
    req: ListLongTermMemoriesRequest,
  ): Promise<LongTermMemoryEntity[]>;
  /**
   * appends a long term memory to the database
   * @param entity - The long term memory to append
   * @returns Promise resolving when the operation completes
   */
  appendLongTermMemory(entity: LongTermMemoryEntity): Promise<void>;
  /**
   * deletes a long term memory from the database
   * @param id - The unique identifier for the long term memory to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteLongTermMemory(id: string): Promise<boolean>;
}

export interface ListLongTermMemoriesRequest {
  /**
   * The actor ID to filter long term memories by
   */
  actorId?: string;
  /**
   * Filter long term memories created before the given date and time
   */
  createdBefore?: DbDate;
  /**
   * Filter long term memories created after the given date and time
   */
  createdAfter?: DbDate;
}

/**
 * Interface for long term memory searcher
 */
export interface LongTermMemorySearcher {
  /**
   * searches for long term memories
   * @param req - The request to search for long term memories
   * @returns Promise resolving to an array of long term memory data
   */
  searchLongTermMemories(
    req: SearchLongTermMemoriesRequest,
  ): Promise<LongTermMemoryEntity[]>;
}

export interface SearchLongTermMemoriesRequest {
  /**
   * The actor ID to filter long term memories by
   */
  actorId?: string;
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
  keywords?: string[];
}
