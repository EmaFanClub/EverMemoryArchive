/**
 * @prism-shadow/ema - QQ / Snowluma World Subsystem
 *
 * QQ & OneBot 11 World implementation for EverMemoryArchive:
 * - RFC-0001 (EmaWorld and EmaActor interfaces, multi-part topology, transactional input batching)
 * - RFC-0002 (Social Media Channel Architecture: EmaNode, QQChannel, EmaChannelItem,
 *   Read-Through SQLite indexing, anchored relative time, and hierarchical action introspection)
 * - QQLoginManager QR code login, scan status polling, and credential persistence
 * - Host machine privacy guardrails & banned word filtering
 */

export * from "./types.js";
export * from "./filter.js";
export * from "./authorization.js";
export * from "./gateway.js";
export * from "./world.js";
export {
  QQLoginManager,
  SnowlumaLoginManager,
  ensureQQPlaywrightEnvironment,
  type QQLoginOptions,
  type QQQrCodeInfo,
  type QQScanStatus,
  type QQAuthResult,
  type QQLoginSession,
} from "./login.js";
