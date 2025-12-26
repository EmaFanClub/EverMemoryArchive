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
 * @module @internals/db
 */

export * from "./base";

export * from "./mongo";
export * from "./mongo.role";
export * from "./mongo.actor";
export * from "./mongo.user";
export * from "./mongo.user_own_actor";
export * from "./mongo.conversation";
export * from "./mongo.conversation_message";
export * from "./mongo.short_term_memory";
export * from "./mongo.long_term_memory";

export * from "./lance.long_term_memory";
