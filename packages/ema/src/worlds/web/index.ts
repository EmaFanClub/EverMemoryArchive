/**
 * @prism-shadow/ema - Web World Subsystem
 *
 * Web / WebSocket Companion Portal Input & Action Adapter for EverMemoryArchive:
 * - RFC-0001 multi-part session topology, inbound chat/touch/telemetry batching,
 *   and outbound SSE token/expression/card streaming
 * - RFC-0002 Social Media Channel Architecture (EmaNode, WebChannel, EmaChannelItem,
 *   Read-Through SQLite indexing, relative temporal grounding, and message.post/reply actions)
 * - Installable Companion Portal Workbench (`companion_portal`) for Penguin agents
 */

export * from "./types.js";
export * from "./world.js";
export * from "./workbench.js";
