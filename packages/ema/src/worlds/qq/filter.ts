/**
 * @prism-shadow/ema - QQ Content Filter & Privacy Guardrails
 *
 * Conforms to RFC-0001 and RFC-0002.
 * Guards against accidental leakage of host machine privacy:
 * - Local filesystem paths (~/, /home, /root, /etc, /tmp, C:\, .env, .vault.toml, etc.)
 * - Localhost / private network URLs (127.0.0.1, localhost, 192.168.*, 10.*, etc.)
 * - Secrets, API keys, Bearer tokens, SESSDATA, gateway tokens
 * - Harness system markers ([turn_aborted], <app_data_dir>, session-*, etc.)
 * - Configured banned keywords
 */

import {
  QQContentFilterError,
  type QQContentFilterConfig,
} from "./types.js";

export const QQ_LOCAL_PATH_REGEX =
  /(?:(?:~|\/(?:home|Users|root|etc|var|tmp|usr))\/(?:[a-zA-Z0-9_.\-\/]+)|[A-Za-z]:\\[a-zA-Z0-9_.\-\\]+|(?<![a-zA-Z0-9_])\.(?:vault\.toml|project_config\.toml|env(?:\.[a-zA-Z0-9_-]+)*|ssh\/id_[a-z0-9_]+)\b)/i;

export const QQ_LOCALHOST_REGEX =
  /(?:https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/[^\s"'<>]*)?|\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?\b)/i;

export const QQ_SECRETS_REGEX =
  /(?:\b(?:sk[-_][A-Za-z0-9_*-]{12,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|\b(?:password|passwd|secret_key|client_secret)\s*[:=]\s*[^\s,;"']+)/i;

export const QQ_SYSTEM_MARKERS_REGEX =
  /(?:\[(?:turn_aborted|turn_retried|context_summary|user_steering|use_skills|request_error|developer_instructions|org_trigger)\]|<(?:app_data_dir|session_id|agent_id)>|\bsession-\d{4}-\d{2}-\d{2}-[a-zA-Z0-9_\-]+|\bcall:default_api:\w+)/i;

/**
 * Checks message content against banned word list and local machine privacy leaks.
 * Throws QQContentFilterError on "reject", or masks prohibited keywords/patterns.
 */
export function checkQQContentFilter(
  text: string,
  filterConfig: Required<QQContentFilterConfig>,
  bannedWords: string[] = [],
  bannedWordAction: "reject" | "mask" = "reject",
): string {
  let result = text;

  // 1. Custom banned words list check
  if (bannedWords.length > 0) {
    for (const banned of bannedWords) {
      if (!banned) continue;
      if (result.includes(banned)) {
        if (bannedWordAction === "mask") {
          const mask = "*".repeat(banned.length);
          result = result.split(banned).join(mask);
        } else {
          throw new QQContentFilterError(
            `Refusing to dispatch QQ message containing prohibited word: "${banned}"`,
          );
        }
      }
    }
  }

  // 2. Local machine & privacy leak guardrails
  if (filterConfig.enabled) {
    const checks: Array<{
      enabled: boolean;
      type: string;
      regex: RegExp;
    }> = [
      {
        enabled: filterConfig.filterLocalPaths,
        type: "local file path",
        regex: QQ_LOCAL_PATH_REGEX,
      },
      {
        enabled: filterConfig.filterLocalhost,
        type: "localhost or private network address",
        regex: QQ_LOCALHOST_REGEX,
      },
      {
        enabled: filterConfig.filterSecrets,
        type: "credential, token, or secret",
        regex: QQ_SECRETS_REGEX,
      },
      {
        enabled: filterConfig.filterSystemMarkers,
        type: "harness system marker",
        regex: QQ_SYSTEM_MARKERS_REGEX,
      },
    ];

    for (const { enabled, type, regex } of checks) {
      if (!enabled) continue;
      const testRegex = new RegExp(regex.source, regex.flags);
      if (testRegex.test(result)) {
        if (filterConfig.action === "mask") {
          const replaceRegex = new RegExp(
            regex.source,
            regex.flags.includes("g") ? regex.flags : regex.flags + "g",
          );
          result = result.replace(replaceRegex, "[redacted]");
        } else {
          throw new QQContentFilterError(
            `Refusing to dispatch QQ message containing sensitive ${type}`,
          );
        }
      }
    }
  }

  return result;
}
