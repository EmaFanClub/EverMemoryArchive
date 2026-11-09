/**
 * @prism-shadow/ema - QQ Message Synchronizer & Sequence Gap Perception
 *
 * Implements:
 * 1. Automatic group message synchronization from OneBot 11 gateways via get_group_msg_history.
 * 2. Monotonic sequence gap detection (message_seq tracking) to perceive dropped/missed messages.
 * 3. Automatic gap recovery fetching missed sequence windows.
 * 4. Local SQLite persistence in seen_qq_synced_messages and seen_qq_sync_state.
 * 5. Mention and @ detection (CQ:at, segment array, @all, text nickname matching, quote replies).
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  OneBotApiCall,
  OneBotApiResponse,
  OneBotSegment,
  QQGroupSyncState,
  QQMessageGap,
  QQSyncStatus,
  QQSyncedMessage,
} from "./types.js";
import { normalizeQQGroupId, type QQAuthorizationManager } from "./authorization.js";

/**
 * Parses mention information from either a raw CQ string or segment array.
 */
export function parseMentionInfo(
  rawOrSegments: string | OneBotSegment[],
  selfId?: string | number,
  nicknames?: string[],
): { atUids: string[]; isAtMe: boolean; isAtAll: boolean } {
  const atUids: string[] = [];
  const selfIdStr = selfId !== undefined && selfId !== null ? String(selfId).trim() : undefined;
  const normalizedNicknames = (nicknames || []).map((n) => n.trim().toLowerCase()).filter(Boolean);

  let rawText = "";

  if (typeof rawOrSegments === "string") {
    rawText = rawOrSegments;
    const cqRegex = /\[CQ:at,qq=([^,\]]+)[^\]]*\]/g;
    let match: RegExpExecArray | null;
    while ((match = cqRegex.exec(rawOrSegments)) !== null) {
      const qqVal = match[1].trim();
      if (qqVal) {
        atUids.push(qqVal);
      }
    }
  } else if (Array.isArray(rawOrSegments)) {
    for (const seg of rawOrSegments) {
      if (!seg || typeof seg.type !== "string") continue;
      if (seg.type === "at" && seg.data?.qq) {
        const qqVal = String(seg.data.qq).trim();
        if (qqVal) {
          atUids.push(qqVal);
        }
      } else if (seg.type === "text" && seg.data?.text) {
        rawText += String(seg.data.text);
      }
    }
  }

  let isAtMe = false;
  if (selfIdStr && atUids.includes(selfIdStr)) {
    isAtMe = true;
  }

  const isAtAll = atUids.includes("all");

  // Check text-based nickname and self ID mentions if not already matched via CQ:at / segment
  if (!isAtMe && rawText) {
    const lowerText = rawText.toLowerCase();
    if (selfIdStr && lowerText.includes(`@${selfIdStr.toLowerCase()}`)) {
      isAtMe = true;
      if (!atUids.includes(selfIdStr)) {
        atUids.push(selfIdStr);
      }
    }
    if (!isAtMe && normalizedNicknames.length > 0) {
      for (const nick of normalizedNicknames) {
        if (lowerText.includes(`@${nick}`)) {
          isAtMe = true;
          break;
        }
      }
    }
  }

  return { atUids, isAtMe, isAtAll };
}

export interface QQMessageSynchronizerOptions {
  apiCaller: (call: OneBotApiCall) => Promise<OneBotApiResponse> | OneBotApiResponse;
  db: DatabaseSync;
  groups?: Array<string | number>;
  selfId?: string | number;
  nicknames?: string[];
  intervalMs?: number;
  batchSize?: number;
  autoRecoverGaps?: boolean;
  authManager?: QQAuthorizationManager;
  onMessage?: (message: QQSyncedMessage, isGapRecovery: boolean) => Promise<void> | void;
  onGap?: (gap: QQMessageGap) => void;
}

export class QQMessageSynchronizer {
  private apiCaller: (call: OneBotApiCall) => Promise<OneBotApiResponse> | OneBotApiResponse;
  private db: DatabaseSync;
  private groups: Set<string> = new Set();
  private selfId?: string;
  private nicknames: string[] = [];
  private intervalMs: number;
  private batchSize: number;
  private autoRecoverGaps: boolean;
  private authManager?: QQAuthorizationManager;
  private onMessage?: (message: QQSyncedMessage, isGapRecovery: boolean) => Promise<void> | void;
  private onGap?: (gap: QQMessageGap) => void;

  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private syncing = false;

  private syncStateByGroup: Map<string, QQGroupSyncState> = new Map();
  private gapHistory: QQMessageGap[] = [];

  // Prepared SQLite Statements
  private insertSyncedMsgStmt!: StatementSync;
  private selectSyncedMsgsStmt!: StatementSync;
  private selectSyncedMsgByIdStmt!: StatementSync;
  private selectMsgSenderStmt!: StatementSync;
  private upsertSyncStateStmt!: StatementSync;
  private selectAllSyncStateStmt!: StatementSync;

  constructor(options: QQMessageSynchronizerOptions) {
    this.apiCaller = options.apiCaller;
    this.db = options.db;
    this.selfId = options.selfId !== undefined ? String(options.selfId) : undefined;
    this.nicknames = options.nicknames ? [...options.nicknames] : [];
    this.intervalMs = Math.max(500, options.intervalMs ?? 3000);
    this.batchSize = Math.min(100, Math.max(1, options.batchSize ?? 20));
    this.autoRecoverGaps = options.autoRecoverGaps ?? true;
    this.authManager = options.authManager;
    this.onMessage = options.onMessage;
    this.onGap = options.onGap;

    if (options.groups) {
      for (const g of options.groups) {
        this.addGroup(g);
      }
    }

    this.initDatabase();
    this.loadStateFromDb();
  }

  private initDatabase(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS seen_qq_synced_messages (
          message_id TEXT PRIMARY KEY,
          group_id TEXT,
          user_id TEXT NOT NULL,
          sender_name TEXT,
          message_seq INTEGER,
          content TEXT NOT NULL,
          raw_message TEXT,
          is_at_me INTEGER NOT NULL DEFAULT 0,
          at_uids TEXT,
          reply_to TEXT,
          timestamp INTEGER NOT NULL,
          created_at_iso TEXT NOT NULL,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_qq_sync_group_seq ON seen_qq_synced_messages (group_id, message_seq);
        CREATE INDEX IF NOT EXISTS idx_qq_sync_group_time ON seen_qq_synced_messages (group_id, timestamp);

        CREATE TABLE IF NOT EXISTS seen_qq_sync_state (
          group_id TEXT PRIMARY KEY,
          last_seq INTEGER NOT NULL,
          last_synced_at INTEGER NOT NULL,
          total_synced INTEGER NOT NULL DEFAULT 0,
          gaps_detected INTEGER NOT NULL DEFAULT 0,
          messages_missed INTEGER NOT NULL DEFAULT 0,
          messages_recovered INTEGER NOT NULL DEFAULT 0
        );
      `);

      this.insertSyncedMsgStmt = this.db.prepare(`
        INSERT OR REPLACE INTO seen_qq_synced_messages (
          message_id, group_id, user_id, sender_name, message_seq, content, raw_message,
          is_at_me, at_uids, reply_to, timestamp, created_at_iso, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      this.selectSyncedMsgsStmt = this.db.prepare(`
        SELECT * FROM seen_qq_synced_messages
        WHERE group_id = ?
        ORDER BY message_seq ASC, timestamp ASC
        LIMIT ?
      `);

      this.selectSyncedMsgByIdStmt = this.db.prepare(
        "SELECT message_id FROM seen_qq_synced_messages WHERE message_id = ?",
      );

      this.selectMsgSenderStmt = this.db.prepare(
        "SELECT user_id FROM seen_qq_synced_messages WHERE message_id = ?",
      );

      this.upsertSyncStateStmt = this.db.prepare(`
        INSERT INTO seen_qq_sync_state (
          group_id, last_seq, last_synced_at, total_synced, gaps_detected, messages_missed, messages_recovered
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(group_id) DO UPDATE SET
          last_seq = excluded.last_seq,
          last_synced_at = excluded.last_synced_at,
          total_synced = excluded.total_synced,
          gaps_detected = excluded.gaps_detected,
          messages_missed = excluded.messages_missed,
          messages_recovered = excluded.messages_recovered
      `);

      this.selectAllSyncStateStmt = this.db.prepare("SELECT * FROM seen_qq_sync_state");
    } catch (err) {
      console.error("[QQMessageSynchronizer] SQLite initialization error:", err);
    }
  }

  private loadStateFromDb(): void {
    try {
      const rows = this.selectAllSyncStateStmt.all() as Array<{
        group_id: string;
        last_seq: number;
        last_synced_at: number;
        total_synced: number;
        gaps_detected: number;
        messages_missed: number;
        messages_recovered: number;
      }>;

      for (const row of rows) {
        this.syncStateByGroup.set(row.group_id, {
          groupId: row.group_id,
          lastSeq: row.last_seq,
          lastSyncedAt: row.last_synced_at,
          totalSynced: row.total_synced,
          gapsDetected: row.gaps_detected,
          messagesMissed: row.messages_missed,
          messagesRecovered: row.messages_recovered,
        });
      }
    } catch {
      // Ignored if table is empty or error
    }
  }

  public setSelfId(selfId: string | number): void {
    this.selfId = String(selfId).trim();
  }

  public addNicknames(nicknames: string[]): void {
    for (const nick of nicknames) {
      const trimmed = nick.trim();
      if (trimmed && !this.nicknames.includes(trimmed)) {
        this.nicknames.push(trimmed);
      }
    }
  }

  public addGroup(groupId: string | number): void {
    const normalized = normalizeQQGroupId(groupId);
    if (normalized) {
      this.groups.add(normalized);
      if (!this.syncStateByGroup.has(normalized)) {
        this.syncStateByGroup.set(normalized, {
          groupId: normalized,
          lastSeq: 0,
          lastSyncedAt: 0,
          totalSynced: 0,
          gapsDetected: 0,
          messagesMissed: 0,
          messagesRecovered: 0,
        });
      }
    }
  }

  public removeGroup(groupId: string | number): void {
    const normalized = normalizeQQGroupId(groupId);
    if (normalized) {
      this.groups.delete(normalized);
    }
  }

  public start(): void {
    if (this.running) return;
    this.running = true;

    // Trigger immediate initial sync round
    this.syncAll().catch((err) => {
      console.error("[QQMessageSynchronizer] Initial sync failed:", err);
    });

    this.pollTimer = setInterval(() => {
      if (!this.running) return;
      this.syncAll().catch((err) => {
        console.error("[QQMessageSynchronizer] Polling sync error:", err);
      });
    }, this.intervalMs);
  }

  public stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Synchronizes all monitored and authorized groups.
   */
  public async syncAll(): Promise<Record<string, number>> {
    if (this.syncing) return {};
    this.syncing = true;
    const results: Record<string, number> = {};

    try {
      for (const groupId of this.groups) {
        if (this.authManager && !this.authManager.canQueryPart(`group:${groupId}`).authorized) {
          continue;
        }
        try {
          const syncedCount = await this.syncGroup(groupId);
          results[groupId] = syncedCount;
        } catch (err) {
          console.error(`[QQMessageSynchronizer] Failed to sync group ${groupId}:`, err);
        }
      }
    } finally {
      this.syncing = false;
    }

    return results;
  }

  /**
   * Performs a synchronization round for a specific QQ group.
   * Pulls get_group_msg_history, checks sequence continuity, detects and recovers gaps,
   * stores to SQLite, and invokes callbacks.
   */
  public async syncGroup(
    groupId: string,
    options?: { count?: number; fromSeq?: number },
  ): Promise<number> {
    const normalized = normalizeQQGroupId(groupId);
    if (!normalized) return 0;

    const state = this.syncStateByGroup.get(normalized) || {
      groupId: normalized,
      lastSeq: 0,
      lastSyncedAt: 0,
      totalSynced: 0,
      gapsDetected: 0,
      messagesMissed: 0,
      messagesRecovered: 0,
    };

    const count = options?.count ?? this.batchSize;
    const params: Record<string, unknown> = {
      group_id: Number(normalized),
      count,
    };
    if (options?.fromSeq !== undefined) {
      params.message_seq = options.fromSeq;
    }

    const res = await this.apiCaller({
      action: "get_group_msg_history",
      params,
    });

    if (!res || res.status !== "ok" || !res.data) {
      return 0;
    }

    const rawMessages = Array.isArray((res.data as Record<string, unknown>).messages)
      ? ((res.data as Record<string, unknown>).messages as Array<Record<string, unknown>>)
      : [];

    if (rawMessages.length === 0) {
      state.lastSyncedAt = Date.now();
      this.saveSyncState(state);
      return 0;
    }

    // Filter valid messages and sort ascending by message_seq
    const messages = rawMessages
      .filter((m) => m && typeof m === "object")
      .map((m) => this.normalizeOneBotHistoryItem(m, normalized))
      .sort((a, b) => (a.messageSeq ?? 0) - (b.messageSeq ?? 0));

    let newlySyncedCount = 0;

    // Check Sequence Continuity & Gap Perception
    if (state.lastSeq > 0 && messages.length > 0) {
      const firstNewSeq = messages[0].messageSeq;
      if (firstNewSeq !== undefined && firstNewSeq > state.lastSeq + 1) {
        const missedCount = firstNewSeq - state.lastSeq - 1;
        const gap: QQMessageGap = {
          groupId: normalized,
          fromSeq: state.lastSeq + 1,
          toSeq: firstNewSeq - 1,
          missedCount,
          timestamp: Date.now(),
          recovered: false,
        };

        state.gapsDetected += 1;
        state.messagesMissed += missedCount;
        state.lastGap = gap;
        this.gapHistory.unshift(gap);
        if (this.gapHistory.length > 50) this.gapHistory.pop();

        if (this.onGap) {
          this.onGap(gap);
        }

        // Auto-recover missing sequence window
        if (this.autoRecoverGaps) {
          await this.recoverGap(normalized, state.lastSeq, missedCount);
        }
      }
    }

    for (const msg of messages) {
      const isNew = this.saveSyncedMessage(msg);
      if (isNew) {
        newlySyncedCount++;
        state.totalSynced++;

        if (this.onMessage) {
          await this.onMessage(msg, false);
        }
      }

      if (msg.messageSeq !== undefined && msg.messageSeq > state.lastSeq) {
        state.lastSeq = msg.messageSeq;
      }
    }

    state.lastSyncedAt = Date.now();
    this.saveSyncState(state);

    return newlySyncedCount;
  }

  /**
   * Auto-recovers missing sequence window by fetching from gateway.
   */
  public async recoverGap(
    groupId: string,
    lastSeq: number,
    missedCount: number,
  ): Promise<number> {
    const normalized = normalizeQQGroupId(groupId);
    if (!normalized) return 0;

    const state = this.syncStateByGroup.get(normalized);
    const fetchCount = Math.min(100, Math.max(1, missedCount + 2));

    try {
      const res = await this.apiCaller({
        action: "get_group_msg_history",
        params: {
          group_id: Number(normalized),
          message_seq: lastSeq,
          count: fetchCount,
        },
      });

      if (!res || res.status !== "ok" || !res.data) {
        return 0;
      }

      const rawMessages = Array.isArray((res.data as Record<string, unknown>).messages)
        ? ((res.data as Record<string, unknown>).messages as Array<Record<string, unknown>>)
        : [];

      let recovered = 0;
      const parsed = rawMessages
        .filter((m) => m && typeof m === "object")
        .map((m) => this.normalizeOneBotHistoryItem(m, normalized))
        .sort((a, b) => (a.messageSeq ?? 0) - (b.messageSeq ?? 0));

      for (const msg of parsed) {
        const isNew = this.saveSyncedMessage(msg);
        if (isNew) {
          recovered++;
          if (state) {
            state.totalSynced++;
            state.messagesRecovered++;
          }
          if (this.onMessage) {
            await this.onMessage(msg, true);
          }
        }
      }

      if (state && state.lastGap && state.lastGap.groupId === normalized) {
        state.lastGap.recovered = true;
        state.lastGap.recoveredCount = recovered;
      }

      if (state) {
        this.saveSyncState(state);
      }

      return recovered;
    } catch (err) {
      console.error(`[QQMessageSynchronizer] Gap recovery failed for group ${normalized}:`, err);
      return 0;
    }
  }

  /**
   * Normalizes a raw OneBot message object into a QQSyncedMessage.
   */
  private normalizeOneBotHistoryItem(
    rawItem: Record<string, unknown>,
    groupId: string,
  ): QQSyncedMessage {
    const messageId = String(rawItem.message_id ?? `seq-${rawItem.message_seq ?? Date.now()}`);
    const userId = String(rawItem.user_id ?? "");
    const messageSeq =
      typeof rawItem.message_seq === "number" && Number.isFinite(rawItem.message_seq)
        ? rawItem.message_seq
        : undefined;

    const sender = (rawItem.sender || {}) as Record<string, unknown>;
    const senderName =
      String(sender.card || sender.nickname || userId || "QQ User").trim();

    const rawMessage = String(rawItem.raw_message || "");
    const messageSegments = Array.isArray(rawItem.message)
      ? (rawItem.message as OneBotSegment[])
      : undefined;

    // Parse Mentions (@) and ReplyTo
    let replyTo: string | undefined;
    let content = "";

    const mentionData = messageSegments
      ? parseMentionInfo(messageSegments, this.selfId, this.nicknames)
      : parseMentionInfo(rawMessage, this.selfId, this.nicknames);

    if (messageSegments) {
      const parts: string[] = [];
      for (const seg of messageSegments) {
        if (!seg) continue;
        if (seg.type === "reply" && seg.data?.id) {
          replyTo = String(seg.data.id);
        } else if (seg.type === "text" && seg.data?.text) {
          parts.push(String(seg.data.text));
        } else if (seg.type === "at" && seg.data?.qq) {
          parts.push(`@${seg.data.qq}`);
        } else if (seg.type === "image") {
          parts.push("[图片]");
        } else if (seg.type === "face") {
          parts.push(`[表情:${seg.data?.id ?? ""}]`);
        }
      }
      content = parts.join("").trim();
    } else {
      content = rawMessage.replace(/\[CQ:reply,id=([^,\]]+)[^\]]*\]/g, (_m, id) => {
        replyTo = id;
        return "";
      }).trim();
    }

    const timeSeconds =
      typeof rawItem.time === "number" && Number.isFinite(rawItem.time)
        ? rawItem.time
        : Math.floor(Date.now() / 1000);
    const timestamp = timeSeconds * 1000;
    const createdAtIso = new Date(timestamp).toISOString();

    // Check if message is replying to the bot
    let isReplyToMe = false;
    if (replyTo && this.selfId) {
      try {
        const row = this.selectMsgSenderStmt.get(replyTo) as { user_id: string } | undefined;
        if (row && String(row.user_id) === this.selfId) {
          isReplyToMe = true;
        }
      } catch {
        // Table lookup error
      }
    }

    return {
      messageId,
      groupId,
      userId,
      senderName,
      messageSeq,
      content,
      rawMessage,
      isAtMe: mentionData.isAtMe || isReplyToMe,
      atUids: mentionData.atUids,
      replyTo,
      timestamp,
      createdAtIso,
      metadata: {
        raw: rawItem,
        isAtAll: mentionData.isAtAll,
        isReplyToMe,
      },
    };
  }

  private saveSyncedMessage(msg: QQSyncedMessage): boolean {
    try {
      const existing = this.selectSyncedMsgByIdStmt.get(msg.messageId);
      if (existing) {
        return false;
      }

      this.insertSyncedMsgStmt.run(
        msg.messageId,
        msg.groupId || null,
        msg.userId,
        msg.senderName,
        msg.messageSeq ?? null,
        msg.content,
        msg.rawMessage || null,
        msg.isAtMe ? 1 : 0,
        JSON.stringify(msg.atUids),
        msg.replyTo || null,
        msg.timestamp,
        msg.createdAtIso,
        JSON.stringify(msg.metadata || {}),
      );
      return true;
    } catch (err) {
      console.error("[QQMessageSynchronizer] Error saving synced message:", err);
      return false;
    }
  }

  private saveSyncState(state: QQGroupSyncState): void {
    this.syncStateByGroup.set(state.groupId, state);
    try {
      this.upsertSyncStateStmt.run(
        state.groupId,
        state.lastSeq,
        state.lastSyncedAt,
        state.totalSynced,
        state.gapsDetected,
        state.messagesMissed,
        state.messagesRecovered,
      );
    } catch (err) {
      console.error("[QQMessageSynchronizer] Error saving sync state:", err);
    }
  }

  /**
   * Retrieves locally synchronized messages from SQLite.
   */
  public getSyncedMessages(
    groupId: string,
    options?: { limit?: number; sinceSeq?: number; atMeOnly?: boolean },
  ): QQSyncedMessage[] {
    const normalized = normalizeQQGroupId(groupId);
    if (!normalized) return [];

    const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
    try {
      let query = "SELECT * FROM seen_qq_synced_messages WHERE group_id = ?";
      const params: Array<string | number | bigint | null> = [normalized];

      if (options?.sinceSeq !== undefined) {
        query += " AND message_seq > ?";
        params.push(options.sinceSeq);
      }

      if (options?.atMeOnly) {
        query += " AND is_at_me = 1";
      }

      query += " ORDER BY message_seq ASC, timestamp ASC LIMIT ?";
      params.push(limit);

      const rows = this.db.prepare(query).all(...params) as Array<{
        message_id: string;
        group_id: string | null;
        user_id: string;
        sender_name: string | null;
        message_seq: number | null;
        content: string;
        raw_message: string | null;
        is_at_me: number;
        at_uids: string | null;
        reply_to: string | null;
        timestamp: number;
        created_at_iso: string;
        metadata: string | null;
      }>;

      return rows.map((r) => ({
        messageId: r.message_id,
        groupId: r.group_id || undefined,
        userId: r.user_id,
        senderName: r.sender_name || r.user_id,
        messageSeq: r.message_seq !== null ? r.message_seq : undefined,
        content: r.content,
        rawMessage: r.raw_message || undefined,
        isAtMe: r.is_at_me === 1,
        atUids: r.at_uids ? JSON.parse(r.at_uids) : [],
        replyTo: r.reply_to || undefined,
        timestamp: r.timestamp,
        createdAtIso: r.created_at_iso,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      }));
    } catch (err) {
      console.error("[QQMessageSynchronizer] Error fetching synced messages:", err);
      return [];
    }
  }

  /**
   * Returns current sync telemetry, group sequence markers, and gap perception metrics.
   */
  public getSyncStatus(): QQSyncStatus {
    const groups: Record<string, QQGroupSyncState> = {};
    let totalSynced = 0;
    let totalGapsDetected = 0;
    let totalMessagesMissed = 0;
    let totalMessagesRecovered = 0;

    for (const [gid, st] of this.syncStateByGroup.entries()) {
      groups[gid] = { ...st };
      totalSynced += st.totalSynced;
      totalGapsDetected += st.gapsDetected;
      totalMessagesMissed += st.messagesMissed;
      totalMessagesRecovered += st.messagesRecovered;
    }

    const hasActiveGaps = totalMessagesMissed > totalMessagesRecovered;

    return {
      enabled: this.running,
      syncIntervalMs: this.intervalMs,
      autoRecoverGaps: this.autoRecoverGaps,
      groups,
      summary: {
        totalSynced,
        totalGapsDetected,
        totalMessagesMissed,
        totalMessagesRecovered,
        hasActiveGaps,
      },
    };
  }

  public getGapHistory(): QQMessageGap[] {
    return [...this.gapHistory];
  }
}
