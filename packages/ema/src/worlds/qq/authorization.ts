/**
 * @prism-shadow/ema - QQ World Authorization System
 *
 * Implements authorization guardrails for QQ companions:
 * - Only specific authorized friends (private users) and groups can query and speak.
 * - Enforces access control on inbound event ingestion (dropping or rejecting unauthorized triggers).
 * - Enforces access control on outbound message dispatch and proactive interactions.
 * - Filters channel/part query results so unauthorized groups/users are invisible.
 */

import {
  type QQAuthorizationConfig,
  type OneBotEvent,
  QQAuthorizationError,
} from "./types.js";

/**
 * Normalizes a QQ user identifier into a clean numeric or string ID.
 * Strips prefixes: "user:qq:", "qq:person:", "private:", "dm:".
 */
export function normalizeQQUserId(raw: string | number): string {
  return String(raw)
    .trim()
    .replace(/^(user:qq:|qq:person:|qq:private:|private:|dm:)/, "");
}

/**
 * Normalizes a QQ group identifier into a clean numeric or string ID.
 * Strips prefixes: "qq:group:", "group:".
 */
export function normalizeQQGroupId(raw: string | number): string {
  return String(raw)
    .trim()
    .replace(/^(qq:group:|group:)/, "");
}

/**
 * Parses a comma or whitespace delimited list of IDs into normalized strings.
 */
function parseIdList(raw: unknown, normalizer: (id: string | number) => string): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizer(item)).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,;\s]+/)
      .map((s) => normalizer(s.trim()))
      .filter(Boolean);
  }
  return [normalizer(String(raw))].filter(Boolean);
}

/**
 * Manages authorization policies for QQ World users and groups.
 */
export class QQAuthorizationManager {
  private enabled: boolean;
  private allowedUsers: Set<string>;
  private allowedGroups: Set<string>;
  private adminUsers: Set<string>;
  private requireUserAuthInGroups: boolean;
  private onUnauthorized: "reject" | "block";
  private defaultPolicy: "allow" | "deny";

  constructor(
    config?: QQAuthorizationConfig,
    env: Record<string, string | undefined> = process.env,
  ) {
    // Read from config first, fall back to environment variables
    const envUsers = env.EMA_QQ_ALLOWED_USERS || env.SNOWLUMA_ALLOWED_USERS;
    const envGroups = env.EMA_QQ_ALLOWED_GROUPS || env.SNOWLUMA_ALLOWED_GROUPS;
    const envAdmins = env.EMA_QQ_ADMIN_USERS || env.SNOWLUMA_ADMIN_USERS;
    const envEnabled = env.EMA_QQ_AUTH_ENABLED || env.SNOWLUMA_AUTH_ENABLED;
    const envPolicy = env.EMA_QQ_AUTH_POLICY || env.SNOWLUMA_AUTH_POLICY;

    const parsedUsers = [
      ...parseIdList(config?.allowedUsers, normalizeQQUserId),
      ...parseIdList(envUsers, normalizeQQUserId),
    ];
    const parsedGroups = [
      ...parseIdList(config?.allowedGroups, normalizeQQGroupId),
      ...parseIdList(envGroups, normalizeQQGroupId),
    ];
    const parsedAdmins = [
      ...parseIdList(config?.adminUsers, normalizeQQUserId),
      ...parseIdList(envAdmins, normalizeQQUserId),
    ];

    this.allowedUsers = new Set(parsedUsers);
    this.allowedGroups = new Set(parsedGroups);
    this.adminUsers = new Set(parsedAdmins);

    this.requireUserAuthInGroups = config?.requireUserAuthInGroups ?? false;
    this.onUnauthorized = config?.onUnauthorized ?? "reject";

    // If lists are provided, default to enabled = true; otherwise check config or env
    if (config?.enabled !== undefined) {
      this.enabled = config.enabled;
    } else if (envEnabled !== undefined) {
      this.enabled = envEnabled === "true" || envEnabled === "1";
    } else {
      this.enabled = this.allowedUsers.size > 0 || this.allowedGroups.size > 0;
    }

    if (config?.defaultPolicy) {
      this.defaultPolicy = config.defaultPolicy;
    } else if (envPolicy === "allow" || envPolicy === "deny") {
      this.defaultPolicy = envPolicy;
    } else {
      this.defaultPolicy = this.enabled ? "deny" : "allow";
    }
  }

  /**
   * Whether authorization checking is active.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Sets whether authorization is enabled.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Checks whether a user ID is an admin / owner.
   */
  isAdmin(userId: string | number): boolean {
    const uId = normalizeQQUserId(userId);
    return this.adminUsers.has(uId);
  }

  /**
   * Checks whether a private user / friend is authorized to query and speak.
   */
  isAuthorizedUser(userId: string | number): boolean {
    if (!this.enabled) return true;
    const uId = normalizeQQUserId(userId);
    if (this.isAdmin(uId)) return true;
    if (this.allowedUsers.size === 0) {
      return this.defaultPolicy === "allow";
    }
    return this.allowedUsers.has(uId);
  }

  /**
   * Checks whether a group is authorized for querying and speaking.
   */
  isAuthorizedGroup(groupId: string | number): boolean {
    if (!this.enabled) return true;
    const gId = normalizeQQGroupId(groupId);
    if (this.allowedGroups.size === 0) {
      return this.defaultPolicy === "allow";
    }
    return this.allowedGroups.has(gId);
  }

  /**
   * Evaluates if an inbound OneBot event can be ingested by the companion.
   */
  canIngestEvent(event: OneBotEvent): { authorized: boolean; reason?: string } {
    if (!this.enabled) return { authorized: true };

    const isGroup = event.message_type === "group" || event.group_id !== undefined;

    if (isGroup) {
      const gId = event.group_id !== undefined ? normalizeQQGroupId(event.group_id) : "";
      if (!gId || !this.isAuthorizedGroup(gId)) {
        return {
          authorized: false,
          reason: `Inbound event rejected: QQ group '${gId}' is not authorized`,
        };
      }

      if (this.requireUserAuthInGroups && event.user_id !== undefined) {
        const uId = normalizeQQUserId(event.user_id);
        if (!this.isAuthorizedUser(uId)) {
          return {
            authorized: false,
            reason: `Inbound event rejected: QQ user '${uId}' in group '${gId}' is not authorized`,
          };
        }
      }

      return { authorized: true };
    }

    // Private message or direct notice
    const rawUserId = event.user_id ?? event.target_id;
    if (rawUserId !== undefined) {
      const uId = normalizeQQUserId(rawUserId);
      if (!this.isAuthorizedUser(uId)) {
        return {
          authorized: false,
          reason: `Inbound event rejected: QQ user '${uId}' is not authorized`,
        };
      }
    }

    return { authorized: true };
  }

  /**
   * Evaluates if the companion is authorized to speak / dispatch to a target part or channel.
   */
  canSpeak(targetId: string | number, isGroup?: boolean): { authorized: boolean; reason?: string } {
    if (!this.enabled) return { authorized: true };

    const targetStr = String(targetId).trim();

    // Check for explicit prefix or flag
    const targetIsGroup =
      isGroup === true ||
      targetStr.startsWith("group:") ||
      targetStr.startsWith("qq:group:");

    if (targetIsGroup) {
      const gId = normalizeQQGroupId(targetStr);
      if (!this.isAuthorizedGroup(gId)) {
        return {
          authorized: false,
          reason: `Speaking refused: QQ group '${gId}' is not in authorized groups list`,
        };
      }
      return { authorized: true };
    }

    // Check for private user / DM
    const targetIsPrivate =
      isGroup === false ||
      targetStr.startsWith("private:") ||
      targetStr.startsWith("dm:") ||
      targetStr.startsWith("qq:private:") ||
      targetStr.startsWith("user:qq:");

    if (targetIsPrivate) {
      const uId = normalizeQQUserId(targetStr);
      if (!this.isAuthorizedUser(uId)) {
        return {
          authorized: false,
          reason: `Speaking refused: QQ user '${uId}' is not in authorized friends list`,
        };
      }
      return { authorized: true };
    }

    // Check for Qzone feed
    if (targetStr.startsWith("qzone:") || targetStr.startsWith("qq:qzone:")) {
      return { authorized: true };
    }

    // If bare ID without prefix, check both or default
    const id = normalizeQQUserId(targetStr);
    if (this.isAuthorizedUser(id) || this.isAuthorizedGroup(id)) {
      return { authorized: true };
    }

    return {
      authorized: false,
      reason: `Speaking refused: target '${targetStr}' is not authorized`,
    };
  }

  /**
   * Evaluates if an RFC-0002 channel can be queried by an agent or user.
   */
  canQueryChannel(channelId: string): { authorized: boolean; reason?: string } {
    if (!this.enabled) return { authorized: true };

    const chId = channelId.trim();
    if (chId.startsWith("qq:group:") || chId.startsWith("group:")) {
      const gId = normalizeQQGroupId(chId);
      if (!this.isAuthorizedGroup(gId)) {
        return {
          authorized: false,
          reason: `Query forbidden: QQ group channel '${chId}' is not authorized`,
        };
      }
      return { authorized: true };
    }

    if (chId.startsWith("qq:private:") || chId.startsWith("private:")) {
      const uId = normalizeQQUserId(chId);
      if (!this.isAuthorizedUser(uId)) {
        return {
          authorized: false,
          reason: `Query forbidden: QQ private channel '${chId}' is not authorized`,
        };
      }
      return { authorized: true };
    }

    if (chId.startsWith("qq:qzone:") || chId.startsWith("qzone:")) {
      return { authorized: true };
    }

    return { authorized: true };
  }

  /**
   * Evaluates if an RFC-0001 world part can be queried.
   */
  canQueryPart(partId: string): { authorized: boolean; reason?: string } {
    return this.canQueryChannel(partId);
  }

  /**
   * Filters an array of channels, retaining only authorized ones.
   */
  filterChannels<T extends { id: string }>(channels: T[]): T[] {
    if (!this.enabled) return channels;
    return channels.filter((c) => this.canQueryChannel(c.id).authorized);
  }

  /**
   * Filters an array of world parts, retaining only authorized ones.
   */
  filterParts<T extends { id: string }>(parts: T[]): T[] {
    if (!this.enabled) return parts;
    return parts.filter((p) => this.canQueryPart(p.id).authorized);
  }

  /**
   * Dynamically authorizes a private user / friend.
   */
  authorizeUser(userId: string | number): void {
    const uId = normalizeQQUserId(userId);
    if (uId) {
      this.allowedUsers.add(uId);
      this.enabled = true;
    }
  }

  /**
   * Revokes authorization for a private user.
   */
  revokeUser(userId: string | number): void {
    const uId = normalizeQQUserId(userId);
    this.allowedUsers.delete(uId);
  }

  /**
   * Dynamically authorizes a QQ group.
   */
  authorizeGroup(groupId: string | number): void {
    const gId = normalizeQQGroupId(groupId);
    if (gId) {
      this.allowedGroups.add(gId);
      this.enabled = true;
    }
  }

  /**
   * Revokes authorization for a QQ group.
   */
  revokeGroup(groupId: string | number): void {
    const gId = normalizeQQGroupId(groupId);
    this.allowedGroups.delete(gId);
  }

  /**
   * Returns authorization status and lists for introspection.
   */
  getStatus(): {
    enabled: boolean;
    allowedUsers: string[];
    allowedGroups: string[];
    adminUsers: string[];
    requireUserAuthInGroups: boolean;
    onUnauthorized: "reject" | "block";
    defaultPolicy: "allow" | "deny";
  } {
    return {
      enabled: this.enabled,
      allowedUsers: Array.from(this.allowedUsers),
      allowedGroups: Array.from(this.allowedGroups),
      adminUsers: Array.from(this.adminUsers),
      requireUserAuthInGroups: this.requireUserAuthInGroups,
      onUnauthorized: this.onUnauthorized,
      defaultPolicy: this.defaultPolicy,
    };
  }
}
