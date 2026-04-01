import type { InputContent } from "../schema";
import type { MessageReplyRef } from "../channel";

/**
 * Represents an entity in the database
 */
export interface Entity {
  /**
   * The unique identifier for the entity
   */
  id?: number;
  /**
   * The date and time the entity was created
   */
  createdAt?: DbDate;
}

/**
 * Unix timestamp in milliseconds since the Unix epoch
 */
export type DbDate = number;

/**
 * Represents role data structure
 */
export interface RoleEntity extends Entity {
  /**
   * The name of the role
   */
  name: string;
  /**
   * The prompt of the role
   */
  prompt: string;
  /**
   * The date and time the role was last updated
   */
  updatedAt?: DbDate;
}

export interface CreatedField {
  /**
   * The date and time the entity was created
   */
  createdAt: DbDate;
}

/**
 * Interface for databases that support index creation.
 */
export interface IndexableDB {
  /**
   * Creates indices for the database collection.
   * @returns Promise resolving when indices are created.
   */
  createIndices(): Promise<void>;
}

/**
 * Interface for role database operations
 */
export interface RoleDB {
  /**
   * Lists all roles in the database
   * @returns Promise resolving to an array of role data
   */
  listRoles(): Promise<RoleEntity[]>;

  /**
   * Gets a specific role by ID
   * @param id - The unique identifier for the role
   * @returns Promise resolving to the role data or null if not found
   */
  getRole(id: number): Promise<RoleEntity | null>;

  /**
   * Inserts or updates a role in the database
   * @param entity - The role data to upsert
   * @returns Promise resolving to the ID of the created or updated role
   */
  upsertRole(entity: RoleEntity): Promise<number>;

  /**
   * Deletes a role from the database
   * @param id - The unique identifier for the role to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteRole(id: number): Promise<boolean>;
}

/**
 * Represents actor personality data structure
 */
export interface PersonalityEntity extends Entity {
  /**
   * The actor ID owning this personality memory.
   */
  actorId: number;
  /**
   * The actor personality memory in markdown text.
   */
  memory: string;
  /**
   * The date and time the personality was last updated.
   */
  updatedAt?: DbDate;
}

/**
 * Interface for personality database operations
 */
export interface PersonalityDB {
  /**
   * lists all personality records in the database
   * @returns Promise resolving to an array of personality data
   */
  listPersonalities(): Promise<PersonalityEntity[]>;

  /**
   * gets personality by actor id
   * @param actorId - The unique identifier for the actor
   * @returns Promise resolving to the personality data or null if not found
   */
  getPersonality(actorId: number): Promise<PersonalityEntity | null>;

  /**
   * inserts or updates personality in the database
   * @param entity - The personality data to upsert
   * @returns Promise resolving to the ID of the created or updated personality
   */
  upsertPersonality(entity: PersonalityEntity): Promise<number>;

  /**
   * deletes personality from the database by actor id
   * @param actorId - The unique identifier for the actor
   * @returns Promise resolving to true if deleted, false if not found
   */
  deletePersonality(actorId: number): Promise<boolean>;
}

/**
 * Represents actor data structure
 */
export interface ActorEntity extends Entity {
  /**
   * Each actor has exactly one role
   */
  roleId: number;
  /**
   * The date and time the actor was last updated
   */
  updatedAt?: DbDate;
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
  getActor(id: number): Promise<ActorEntity | null>;

  /**
   * inserts or updates an actor in the database
   * @param entity - The actor data to upsert
   * @returns Promise resolving to the ID of the created or updated actor
   */
  upsertActor(entity: ActorEntity): Promise<number>;

  /**
   * deletes an actor from the database
   * @param id - The unique identifier for the actor to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteActor(id: number): Promise<boolean>;
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
   * The date and time the user was last updated
   */
  updatedAt?: DbDate;
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
  getUser(id: number): Promise<UserEntity | null>;
  /**
   * inserts or updates a user in the database
   * @param entity - The user data to upsert
   * @returns Promise resolving to the ID of the created or updated user
   */
  upsertUser(entity: UserEntity): Promise<number>;
  /**
   * deletes a user from the database
   * @param id - The unique identifier for the user to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteUser(id: number): Promise<boolean>;
}

/**
 * Represents user own actor relation data structure
 */
export interface UserOwnActorRelation {
  /**
   * The user ID
   */
  userId: number;
  /**
   * The actor ID
   */
  actorId: number;
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
   * Gets the owner user ID for the given actor.
   * Returns null when no owner exists and throws if multiple owners are found.
   * @param actorId - The actor ID.
   */
  getActorOwner(actorId: number): Promise<number | null>;
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
  userId?: number;
  /**
   * The actor ID to filter user own actor relations by
   */
  actorId?: number;
}

/**
 * Represents an external identity binding.
 */
export interface ExternalIdentityBindingEntity extends Entity {
  /**
   * The local user mapped to the external UID.
   */
  userId: number;
  /**
   * The channel name for this binding.
   */
  channel: string;
  /**
   * The external UID bound to the local entity.
   */
  uid: string;
  /**
   * The date and time the binding was last updated.
   */
  updatedAt?: DbDate;
}

/**
 * Interface for external identity binding database operations.
 */
export interface ExternalIdentityBindingDB {
  /**
   * Lists identity bindings in the database.
   * @param req - Optional filters for the listing.
   * @returns Promise resolving to matching identity bindings.
   */
  listExternalIdentityBindings(
    req: ListExternalIdentityBindingsRequest,
  ): Promise<ExternalIdentityBindingEntity[]>;

  /**
   * Gets a specific identity binding by ID.
   * @param id - The unique identifier for the binding.
   * @returns Promise resolving to the binding data or null if not found.
   */
  getExternalIdentityBinding(
    id: number,
  ): Promise<ExternalIdentityBindingEntity | null>;

  /**
   * Gets an identity binding by external speaker identifier.
   * @param uid - External UID.
   * @returns Promise resolving to the binding data or null if not found.
   */
  getExternalIdentityBindingByUid(
    uid: string,
  ): Promise<ExternalIdentityBindingEntity | null>;

  /**
   * Inserts or updates an identity binding.
   * @param entity - The identity binding to upsert.
   * @returns Promise resolving to the created or updated binding ID.
   */
  upsertExternalIdentityBinding(
    entity: ExternalIdentityBindingEntity,
  ): Promise<number>;

  /**
   * Deletes an identity binding.
   * @param id - The unique identifier for the binding to delete.
   * @returns Promise resolving to true if deleted, false if not found.
   */
  deleteExternalIdentityBinding(id: number): Promise<boolean>;
}

export interface ListExternalIdentityBindingsRequest {
  /**
   * The local user ID to filter by.
   */
  userId?: number;
  /**
   * The channel name to filter by.
   */
  channel?: string;
  /**
   * The external UID to filter by.
   */
  uid?: string;
}

/**
 * Represents conversation data structure
 */
export interface ConversationEntity extends Entity {
  /**
   * The display name of the conversation.
   */
  name: string;
  /**
   * Description of the conversation source/context.
   * Defaults to "None." when no explicit source is provided.
   */
  description: string;
  /**
   * The actor owning this conversation session.
   */
  actorId: number;
  /**
   * Session identifier bound to this conversation.
   */
  session: string;
  /**
   * Whether this conversation allows heartbeat-triggered proactive messages.
   */
  allowProactive?: boolean;
  /**
   * The date and time the conversation was last updated.
   */
  updatedAt?: DbDate;
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
  getConversation(id: number): Promise<ConversationEntity | null>;

  /**
   * Gets a specific conversation by actor and session.
   * @param actorId - The actor identifier owning the conversation.
   * @param session - Session identifier.
   * @returns Promise resolving to the conversation data or null if not found.
   */
  getConversationByActorAndSession(
    actorId: number,
    session: string,
  ): Promise<ConversationEntity | null>;

  /**
   * inserts or updates a conversation in the database
   * @param entity - The conversation data to upsert
   * @returns Promise resolving to the ID of the created or updated conversation
   */
  upsertConversation(entity: ConversationEntity): Promise<number>;

  /**
   * deletes a conversation from the database
   * @param id - The unique identifier for the conversation to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteConversation(id: number): Promise<boolean>;
}

export interface ListConversationsRequest {
  /**
   * The actor ID to filter conversations by
   */
  actorId?: number;
  /**
   * The session identifier to filter conversations by.
   */
  session?: string;
}

/**
 * Represents conversation message data structure
 */
export interface ConversationMessageEntity extends Entity {
  /**
   * The conversation ID
   */
  conversationId: number;
  /**
   * The actor identifier owning the actor-scoped message index.
   */
  actorId: number;
  /**
   * The actor-scoped readable message ID.
   */
  msgId: number;
  /**
   * Platform-scoped message identifier.
   */
  channelMessageId?: string;
  /**
   * Whether the message has already been merged into actor runtime state and
   * is therefore eligible to appear in rebuilt buffer prompts.
   */
  resumed?: boolean;
  /**
   * The conversation message
   */
  message: ConversationMessage;
}

/**
 * Represents conversation message
 */
export type ConversationMessage =
  | ConversationUserMessage
  | ConversationActorMessage;

export interface ConversationMessageBase<K extends "user" | "actor"> {
  kind: K;
  msgId?: number;
  contents: InputContent[];
  replyTo?: MessageReplyRef;
}

/**
 * Represents conversation message from the user
 */
export interface ConversationUserMessage extends ConversationMessageBase<"user"> {
  /**
   * External UID visible to the model.
   */
  uid: string;
  /**
   * Display name shown to the model.
   */
  name: string;
}

/**
 * Represents conversation message from the actor
 */
export interface ConversationActorMessage extends ConversationMessageBase<"actor"> {
  /**
   * Display name shown to the model.
   */
  name: string;
  /**
   * Internal thought persisted with the actor reply.
   */
  think?: string;
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
   * counts conversation messages in the database
   * @param conversationId - The conversation ID to count messages for
   * @param resumed - Optional resumed-state filter
   * @returns Promise resolving to the number of matching messages
   */
  countConversationMessages(
    conversationId: number,
    resumed?: boolean,
  ): Promise<number>;

  /**
   * Reserves the next message ID for a conversation.
   * @param conversationId - The conversation ID to reserve a message ID for
   * @returns Promise resolving to the reserved conversation-scoped msgId
   */
  reserveMessageId(conversationId: number): Promise<number>;

  /**
   * gets a conversation message by id
   * @param id - The unique identifier for the conversation message
   * @returns Promise resolving to the conversation message data or null if not found
   */
  getConversationMessage(id: number): Promise<ConversationMessageEntity | null>;

  /**
   * inserts a conversation message in the database
   * @param entity - The conversation message to add
   * @returns Promise resolving to the stored message entity with assigned IDs
   */
  addConversationMessage(
    entity: Omit<ConversationMessageEntity, "id" | "msgId"> & {
      msgId?: number;
    },
  ): Promise<ConversationMessageEntity & { id: number; msgId: number }>;

  /**
   * Updates the platform-scoped message identifier for a stored conversation message.
   * @param conversationId - The conversation ID of the target message
   * @param msgId - The conversation-scoped msgId of the target message
   * @param channelMessageId - The platform message identifier to persist
   * @returns Promise resolving to true if the message exists and was updated
   */
  updateConversationMessageChannelMessageId(
    conversationId: number,
    msgId: number,
    channelMessageId: string,
  ): Promise<boolean>;

  /**
   * Marks conversation-scoped messages as resumed so they can participate in
   * rebuilt buffer prompts.
   * @param conversationId - The conversation ID of the target messages
   * @param msgIds - Conversation-scoped msgIds to update
   * @returns Promise resolving to the number of updated rows
   */
  markConversationMessagesResumed(
    conversationId: number,
    msgIds: number[],
  ): Promise<number>;

  /**
   * deletes a conversation message from the database
   * @param id - The unique identifier for the conversation message to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteConversationMessage(id: number): Promise<boolean>;
}

export interface ListConversationMessagesRequest {
  /**
   * The conversation ID to filter conversation messages by
   */
  conversationId?: number;
  /**
   * The actor ID to filter conversation messages by.
   */
  actorId?: number;
  /**
   * Max number of messages to return
   */
  limit?: number;
  /**
   * Sort order by createdAt
   */
  sort?: "asc" | "desc";
  /**
   * Filter conversation messages created before the given date and time
   */
  createdBefore?: DbDate;
  /**
   * Filter conversation messages created after the given date and time
   */
  createdAfter?: DbDate;
  /**
   * Filter conversation messages by actor-scoped message IDs.
   */
  msgIds?: number[];
  channelMessageId?: string;
  /**
   * Filter messages by resumed state. `true` should also include legacy rows
   * where the field is absent.
   */
  resumed?: boolean;
}

/**
 * Represents short term memory data structure
 */
export interface ShortTermMemoryEntity extends Entity {
  /**
   * The granularity of short term memory
   */
  kind: "year" | "month" | "week" | "day";
  /**
   * The owner of the short term memory
   */
  actorId: number;
  /**
   * The memory text when the actor saw the messages.
   */
  memory: string;
  /**
   * The date and time the short term memory was last updated.
   */
  updatedAt?: DbDate;
  /**
   * The messages ids facilitating the short term memory, for debugging purpose.
   */
  messages?: number[];
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
   * @returns Promise resolving to the ID of the created memory
   */
  appendShortTermMemory(entity: ShortTermMemoryEntity): Promise<number>;
  /**
   * upserts a short term memory in the database
   * @param entity - The short term memory to upsert
   * @returns Promise resolving to the ID of the created or updated memory
   */
  upsertShortTermMemory(entity: ShortTermMemoryEntity): Promise<number>;
  /**
   * deletes a short term memory from the database
   * @param id - The unique identifier for the short term memory to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteShortTermMemory(id: number): Promise<boolean>;
}

export interface ListShortTermMemoriesRequest {
  /**
   * The actor ID to filter short term memories by
   */
  actorId?: number;
  /**
   * The kind of short term memory to filter by
   */
  kind?: ShortTermMemoryEntity["kind"];
  /**
   * Sort order by createdAt
   */
  sort?: "asc" | "desc";
  /**
   * Max number of memories to return
   */
  limit?: number;
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
  actorId: number;
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
   * The messages ids facilitating the long term memory, for debugging purpose.
   */
  messages?: number[];
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
   * @returns Promise resolving to the ID of the created memory
   */
  appendLongTermMemory(entity: LongTermMemoryEntity): Promise<number>;
  /**
   * deletes a long term memory from the database
   * @param id - The unique identifier for the long term memory to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteLongTermMemory(id: number): Promise<boolean>;
}

export interface ListLongTermMemoriesRequest {
  /**
   * The actor ID to filter long term memories by
   */
  actorId?: number;
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
 * Interface for a long term memory indexer
 */
export interface LongTermMemoryIndexer {
  /**
   * Indexes a long term memory
   * @param entity - The long term memory to index
   * @returns Promise resolving to void
   */
  indexLongTermMemory(entity: LongTermMemoryEntity): Promise<void>;
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
  ): Promise<(LongTermMemoryEntity & CreatedField)[]>;
}

export interface SearchLongTermMemoriesRequest {
  /**
   * The actor ID to filter long term memories by
   */
  actorId: number;
  /**
   * The memory text to search against.
   */
  memory: string;
  /**
   * The maximum number of memories to return.
   */
  limit: number;
  /**
   * The 0-index to filter, a.k.a. 一级分类
   */
  index0?: string;
  /**
   * The 1-index to filter, a.k.a. 二级分类
   */
  index1?: string;
}
