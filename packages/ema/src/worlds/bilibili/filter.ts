/**
 * @prism-shadow/ema - Bilibili Content Filter & Host Privacy Guardrails
 *
 * Protects against accidental leakage of host machine privacy (local file paths,
 * localhost/private network URLs, API credentials/tokens, and harness system markers).
 */

import {
  BilibiliContentFilterError,
  type BilibiliContentFilterConfig,
} from "./types.js";

export const BILIBILI_LOCAL_PATH_REGEX =
  /(?:(?:~|\/(?:home|Users|root|etc|var|tmp|usr))\/(?:[a-zA-Z0-9_.\-\/]+)|[A-Za-z]:\\[a-zA-Z0-9_.\-\\]+|(?<![a-zA-Z0-9_])\.(?:vault\.toml|project_config\.toml|env(?:\.[a-zA-Z0-9_-]+)*|ssh\/id_[a-z0-9_]+)\b)/i;

export const BILIBILI_LOCALHOST_REGEX =
  /(?:https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/[^\s"'<>]*)?|\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?\b)/i;

export const BILIBILI_SECRETS_REGEX =
  /(?:\b(?:sk[-_][A-Za-z0-9_*-]{12,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|SESSDATA=[A-Za-z0-9%_-]{16,}|bili_jct=[a-f0-9]{32}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|\b(?:password|passwd|secret_key|client_secret)\s*[:=]\s*[^\s,;"']+)/i;

export const BILIBILI_SYSTEM_MARKERS_REGEX =
  /(?:\[(?:turn_aborted|turn_retried|context_summary|user_steering|use_skills|request_error|developer_instructions|org_trigger)\]|<(?:app_data_dir|session_id|agent_id)>|\bsession-\d{4}-\d{2}-\d{2}-[a-zA-Z0-9_\-]+|\bcall:default_api:\w+)/i;

/**
 * Checks message content against banned word list and local machine privacy leaks.
 * Guards against leaking local file paths, localhost/private network addresses, credentials/tokens, and harness system markers.
 * Throws BilibiliContentFilterError on "reject", or masks prohibited keywords/patterns.
 */
export function checkBilibiliContentFilter(
  text: string,
  filterConfig: Required<BilibiliContentFilterConfig>,
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
          throw new BilibiliContentFilterError(
            `Refusing to dispatch Bilibili message containing prohibited word: "${banned}"`,
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
        regex: BILIBILI_LOCAL_PATH_REGEX,
      },
      {
        enabled: filterConfig.filterLocalhost,
        type: "localhost or private network address",
        regex: BILIBILI_LOCALHOST_REGEX,
      },
      {
        enabled: filterConfig.filterSecrets,
        type: "credential, token, or secret",
        regex: BILIBILI_SECRETS_REGEX,
      },
      {
        enabled: filterConfig.filterSystemMarkers,
        type: "harness system marker",
        regex: BILIBILI_SYSTEM_MARKERS_REGEX,
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
          throw new BilibiliContentFilterError(
            `Refusing to dispatch Bilibili message containing sensitive ${type}`,
          );
        }
      }
    }
  }

  return result;
}
