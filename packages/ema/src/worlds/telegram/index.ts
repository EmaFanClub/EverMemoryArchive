/**
 * @prism-shadow/ema - Telegram World Subsystem
 *
 * Telegram Bot API & MTProto World implementation for EverMemoryArchive:
 * - RFC-0001 (EmaWorld and EmaActor interfaces, multi-part topology, transactional input batching)
 * - Real HTTP Bot API client (`TelegramClient`), `sendPhoto`, `sendMediaGroup` (>10 auto-chunking,
 *   local file uploads, `has_spoiler`), `forwardMessages`, `deleteMessage`, `verifyDelivered`
 * - Strict Security & Authorization (`TelegramAuthorizationManager`, `TelegramRateLimiter`,
 *   low-privilege `executeSafeToolCall`, untrusted input sanitization, outbound host privacy filter)
 * - Real-time `BotIndex` JSONL persistence, `ops-log`, and `t.me/s/<channel>`
 *   public channel web archiver
 * - `createTelegramCompanionRunner` connecting a configured companion agent to TelegramWorld
 */

export * from "./types.js";
export * from "./filter.js";
export * from "./authorization.js";
export * from "./client.js";
export * from "./ops-log.js";
export * from "./bot-index.js";
export * from "./archive.js";
export * from "./world.js";
export * from "./protocol.js";
export * from "./runner.js";
