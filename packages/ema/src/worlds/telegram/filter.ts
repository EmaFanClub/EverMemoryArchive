/**
 * @prism-shadow/ema - Telegram Content Filter, Privacy Guardrails & Untrusted Sanitizer
 *
 * Implements two-way boundary protection for TelegramWorld:
 * 1. Inbound Untrusted Sanitization:
 *    - Strips zero-width characters, bidirectional overrides, and C0/C1 control characters
 *      so external users cannot spoof system markers or hide prompt-injection payloads.
 *    - Escapes XML metacharacters (`& < > " '`) when wrapping untrusted Telegram text.
 *    - Normalizes and caps speaker display names.
 * 2. Outbound Host Privacy Guardrails:
 *    - Blocks or masks local machine filesystem paths (`/home/...`, `.vault.toml`, `.project_config.toml`).
 *    - Blocks or masks localhost and private network addresses (`127.0.0.1`, `192.168.*`, `10.*`).
 *    - Blocks or masks API keys, Bearer tokens, bot tokens, and secrets.
 *    - Blocks or masks PenguinHarness internal system markers (`[turn_aborted]`, `<app_data_dir>`, `session-*`).
 */

import {
  TelegramContentFilterError,
  type TelegramContentFilterConfig,
} from "./types.js";

export const TELEGRAM_LOCAL_PATH_REGEX =
  /(?:(?:~|\/(?:home|Users|root|etc|var|tmp|usr|opt|srv|mnt|proc|run|dev))\/(?:[a-zA-Z0-9_.\-\/]+)|(?<![a-zA-Z0-9_])[A-Za-z]:(?:\\|\/(?!\/))[a-zA-Z0-9_.\-\\/]+|(?:\.\.[\/\\])*\.(?:vault\.toml|project_config\.toml|env(?:\.[a-zA-Z0-9_-]+)*|ssh\/id_[a-z0-9_]+)\b)/i;

export const TELEGRAM_LOCALHOST_REGEX =
  /(?:https?:\/\/(?:\[::1\]|127\.0\.0\.1|localhost|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|[a-zA-Z0-9_-]+\.(?:local|internal))(?::\d+)?(?:\/[^\s"'<>]*)?|\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})\b(?::\d+)?|(?<![a-zA-Z0-9_])::1(?![a-zA-Z0-9_])|\b[a-zA-Z0-9_-]+\.(?:local|internal)\b)/i;

export const TELEGRAM_SECRETS_REGEX =
  /(?:\b(?:sk[-_][A-Za-z0-9_*-]{12,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\d{8,12}:[A-Za-z0-9_-]{30,})\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|\b(?:password|passwd|secret_key|client_secret|TELEGRAM_API_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_[A-Z0-9_]*_KEY)\s*[:=]\s*[^\s,;"']+)/i;

export const TELEGRAM_SYSTEM_MARKERS_REGEX =
  /(?:\[(?:turn_aborted|turn_retried|context_summary|user_steering|use_skills|request_error|developer_instructions|org_trigger)\]|<(?:app_data_dir|session_id|agent_id)>|\bsession-\d{4}-\d{2}-\d{2}-[a-zA-Z0-9_\-]+|\bcall:default_api:\w+)/i;

// Zero-width characters, BOM, and bidirectional text override characters
const ZERO_WIDTH_AND_BIDI_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
// C0/C1 control characters except \t (\x09), \n (\x0A), \r (\x0D)
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

/**
 * Strips invisible zero-width characters, bidirectional text overrides, and control characters
 * from untrusted inbound Telegram text.
 */
export function sanitizeUntrustedTelegramText(raw: string): string {
  return String(raw || "")
    .replace(ZERO_WIDTH_AND_BIDI_RE, "")
    .replace(CONTROL_CHARS_RE, "");
}

/**
 * Escapes XML special characters so untrusted user input cannot break out of XML tags.
 */
export function escapeUntrustedXml(raw: string): string {
  return sanitizeUntrustedTelegramText(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Sanitizes and truncates an untrusted Telegram speaker display name (max 24 chars, single line).
 */
export function sanitizeSpeakerName(raw: string | undefined, maxLen = 24): string {
  const cleaned = sanitizeUntrustedTelegramText(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  if (!cleaned) return "未知群友";
  const chars = Array.from(cleaned);
  return chars.length > maxLen ? `${chars.slice(0, maxLen).join("")}…` : cleaned;
}

/**
 * Wraps an untrusted Telegram message in an XML envelope that explicitly marks the content
 * as untrusted external data.
 */
export function formatUntrustedTelegramEnvelope(params: {
  chatId: string | number;
  chatTitle?: string;
  senderId: string | number;
  senderName: string;
  messageId?: string | number;
  text: string;
}): string {
  const speaker = escapeUntrustedXml(sanitizeSpeakerName(params.senderName));
  const senderId = escapeUntrustedXml(String(params.senderId));
  const chatId = escapeUntrustedXml(String(params.chatId));
  const chatTitle = escapeUntrustedXml(params.chatTitle || String(params.chatId));
  const msgIdAttr =
    params.messageId !== undefined ? ` msg_id="${escapeUntrustedXml(String(params.messageId))}"` : "";
  const body = escapeUntrustedXml(params.text);
  return `<untrusted_telegram_message chat_id="${chatId}" chat_title="${chatTitle}" sender_id="${senderId}" speaker="${speaker}"${msgIdAttr}>${body}</untrusted_telegram_message>`;
}

/**
 * Wraps an entire inbound Telegram batch (including untrusted chat title, speaker names,
 * and message bodies) inside a single XML `<telegram_input>` envelope so no untrusted metadata
 * ever sits outside XML-escaped boundaries.
 */
export function formatTelegramInputXml(params: {
  chatId: string | number;
  chatType?: string;
  partId: string;
  chatTitle?: string;
  messages: Array<{
    senderId: string | number;
    senderName: string;
    isOwner?: boolean;
    messageId?: string | number;
    text: string;
  }>;
}): string {
  const chatId = escapeUntrustedXml(String(params.chatId));
  const chatType = escapeUntrustedXml(String(params.chatType || "unknown"));
  const partId = escapeUntrustedXml(String(params.partId));
  const chatTitle = escapeUntrustedXml(
    sanitizeSpeakerName(params.chatTitle || String(params.chatId), 48),
  );
  const msgLines = params.messages.map((m) => {
    const speaker = escapeUntrustedXml(sanitizeSpeakerName(m.senderName));
    const senderId = escapeUntrustedXml(String(m.senderId));
    const isOwner = m.isOwner ? "true" : "false";
    const msgIdAttr =
      m.messageId !== undefined ? ` msg_id="${escapeUntrustedXml(String(m.messageId))}"` : "";
    const body = escapeUntrustedXml(m.text);
    return `  <untrusted_telegram_message sender_id="${senderId}" speaker="${speaker}" is_owner="${isOwner}"${msgIdAttr}>${body}</untrusted_telegram_message>`;
  });
  return [
    `<telegram_input chat_id="${chatId}" chat_type="${chatType}" part_id="${partId}">`,
    `  <untrusted_chat_title>${chatTitle}</untrusted_chat_title>`,
    ...msgLines,
    `</telegram_input>`,
  ].join("\n");
}

/**
 * Checks outbound message content against banned word list and local machine privacy leaks.
 * Throws TelegramContentFilterError on "reject", or masks prohibited keywords/patterns on "mask".
 */
export function checkTelegramContentFilter(
  text: string,
  filterConfig?: TelegramContentFilterConfig,
  bannedWords: string[] = [],
  bannedWordAction: "reject" | "mask" = "reject",
): string {
  let result = String(text ?? "");

  // 1. Custom banned words list check
  if (bannedWords.length > 0) {
    for (const banned of bannedWords) {
      if (!banned) continue;
      if (result.includes(banned)) {
        if (bannedWordAction === "mask") {
          const mask = "*".repeat(banned.length);
          result = result.split(banned).join(mask);
        } else {
          throw new TelegramContentFilterError(
            `Refusing to dispatch Telegram message containing prohibited word: "${banned}"`,
          );
        }
      }
    }
  }

  // 2. Local machine & privacy leak guardrails
  const cfg: Required<TelegramContentFilterConfig> = {
    enabled: filterConfig?.enabled ?? true,
    action: filterConfig?.action ?? "reject",
    filterLocalPaths: filterConfig?.filterLocalPaths ?? true,
    filterLocalhost: filterConfig?.filterLocalhost ?? true,
    filterSecrets: filterConfig?.filterSecrets ?? true,
    filterSystemMarkers: filterConfig?.filterSystemMarkers ?? true,
  };

  if (cfg.enabled) {
    const checks: Array<{
      enabled: boolean;
      type: string;
      regex: RegExp;
    }> = [
      {
        enabled: cfg.filterLocalPaths,
        type: "local file path",
        regex: TELEGRAM_LOCAL_PATH_REGEX,
      },
      {
        enabled: cfg.filterLocalhost,
        type: "localhost or private network address",
        regex: TELEGRAM_LOCALHOST_REGEX,
      },
      {
        enabled: cfg.filterSecrets,
        type: "credential, token, or secret",
        regex: TELEGRAM_SECRETS_REGEX,
      },
      {
        enabled: cfg.filterSystemMarkers,
        type: "harness system marker",
        regex: TELEGRAM_SYSTEM_MARKERS_REGEX,
      },
    ];

    for (const { enabled, type, regex } of checks) {
      if (!enabled) continue;
      const testRegex = new RegExp(regex.source, regex.flags);
      if (testRegex.test(result)) {
        if (cfg.action === "mask") {
          const replaceRegex = new RegExp(
            regex.source,
            regex.flags.includes("g") ? regex.flags : regex.flags + "g",
          );
          result = result.replace(replaceRegex, "[redacted]");
        } else {
          throw new TelegramContentFilterError(
            `Refusing to dispatch Telegram message containing sensitive ${type}`,
          );
        }
      }
    }
  }

  return result;
}
