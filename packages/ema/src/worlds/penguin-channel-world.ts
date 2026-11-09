/**
 * @prism-shadow/ema - PenguinChannelWorld
 *
 * Penguin Channel World implementation for EverMemoryArchive.
 * Treats each Penguin Channel as a distinct Part within the World.
 * Conforms to EmaWorld interface from RFC-0001.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  EmaWorld,
  type EmaCtx,
  type EmaActor,
  type EmaInput,
  type Disposable,
  type EmaWorldPart,
  type Id,
} from "../interfaces.js";
import { assertAgentIdentity } from "../minimal.js";

export interface ChannelSendOptions {
  /** Reference ticket ID to attach (--ref-ticket) */
  refTicket?: string;
  /** Reference session ID to attach (--ref-session) */
  refSession?: string;
  /** Target user to address with @mention */
  targetUser?: string;
  /** Reply-to message ID */
  replyTo?: string;
}

export interface PenguinChannelWorldOptions {
  /** Array of monitored channel IDs (Parts), e.g. ["ch_ema_minimal_test"] */
  channels?: string[];
  /** Polling interval in ms (default: 5000) */
  pollInterval?: number;
  /** SQLite database path for persistent seen state (defaults to /tmp/ema-minimal-workspace/ema-state.sqlite) */
  dbPath?: string;
  /** Legacy alias for dbPath or JSON migration source */
  stateFile?: string;
  /** Existing DatabaseSync instance (e.g. shared with inputBatcher) */
  db?: DatabaseSync;
  /** World name identifier for route mounting and EmaInput.world (default: "channel") */
  worldName?: string;
  /** Max message history to retain for router queries (default: 200) */
  historyLimit?: number;
  /** Custom channel fetcher for testing or alternative transports */
  channelFetcher?: (
    channel: string,
    limit?: number,
  ) => RawChannelMessage[] | Promise<RawChannelMessage[]>;
  /** Custom channel sender for testing or alternative transports */
  channelSender?: (
    channel: string,
    text: string,
    options?: ChannelSendOptions,
  ) => Promise<void> | void;
  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
  /** If true, mounts routes without starting active polling (useful for CLI/inspection) */
  passive?: boolean;
}

export interface RawChannelMessage {
  id?: string;
  sender?: string;
  sender_name?: string;
  senderName?: string;
  name?: string;
  channel?: string;
  channelId?: string;
  text?: string;
  timestamp?: string;
  time?: string;
  reply_to?: string;
  replyTo?: string;
  mentions?: string[];
  hop?: number;
  is_owner?: boolean;
}

export class PenguinChannelWorld extends EmaWorld {
  private channels: string[];
  private pollInterval: number;
  private dbPath?: string;
  private legacyStateFile?: string;
  private channelFetcher: (
    channel: string,
    limit?: number,
  ) => RawChannelMessage[] | Promise<RawChannelMessage[]>;
  private channelSender: (
    channel: string,
    text: string,
    options?: ChannelSendOptions,
  ) => Promise<void> | void;
  private env: Record<string, string | undefined>;
  private seenIds: Set<string> = new Set();
  private messageHistory: Map<string, EmaInput> = new Map();
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private passive = false;
  private isPolling = false;
  private worldName: string;
  private historyLimit: number;
  private ownsDb = true;

  private db: DatabaseSync | null = null;
  private insertSeenStmt: StatementSync | null = null;
  private selectAllSeenStmt: StatementSync | null = null;

  public lastPollTime: number | null = null;
  public lastDispatchTime: number | null = null;
  public lastPollError: Error | null = null;
  public lastDispatchError: Error | null = null;

  constructor(options: PenguinChannelWorldOptions = {}) {
    super();
    this.channels = [...(options.channels ?? ["ch_ema_minimal_test"])];
    this.pollInterval = options.pollInterval ?? 5000;
    this.env = options.env ?? process.env;
    this.passive = options.passive ?? false;
    this.worldName = options.worldName ?? "channel";
    this.historyLimit = options.historyLimit ?? 200;

    // Resolve SQLite database path
    if (options.db) {
      this.db = options.db;
      this.dbPath = ":memory:";
      this.ownsDb = false;
    } else if (options.dbPath) {
      this.dbPath = options.dbPath;
    } else if (options.stateFile) {
      if (options.stateFile.endsWith(".sqlite") || options.stateFile.endsWith(".db")) {
        this.dbPath = options.stateFile;
      } else if (options.stateFile.endsWith(".json")) {
        this.legacyStateFile = options.stateFile;
        this.dbPath = `${options.stateFile.replace(/\.json$/, "")}.sqlite`;
      } else {
        this.dbPath = options.stateFile;
      }
    } else {
      this.dbPath = "/tmp/ema-minimal-workspace/ema-state.sqlite";
    }

    this.channelFetcher =
      options.channelFetcher ??
      ((channel: string, limit = 10): RawChannelMessage[] => {
        try {
          const stdout = execFileSync(
            "penguin",
            ["org", "channel", "tail", "--channel", channel, "-n", String(limit), "--json"],
            { encoding: "utf8", env: this.env },
          );
          const parsed = JSON.parse(stdout);
          if (Array.isArray(parsed)) return parsed as RawChannelMessage[];
          if (parsed && Array.isArray(parsed.messages))
            return parsed.messages as RawChannelMessage[];
          return [];
        } catch (err) {
          console.error(`[PenguinChannelWorld] Failed to tail channel ${channel}:`, err);
          return [];
        }
      });

    this.channelSender =
      options.channelSender ??
      ((channel: string, text: string, opts?: ChannelSendOptions) => {
        const cmdArgs = ["org", "channel", "send", "--channel", channel, "-m", text];
        if (opts?.refTicket) {
          cmdArgs.push("--ref-ticket", opts.refTicket);
        }
        if (opts?.refSession) {
          cmdArgs.push("--ref-session", opts.refSession);
        }
        execFileSync("penguin", cmdArgs, {
          encoding: "utf8",
          env: {
            ...this.env,
            PENGUIN_AGENT_ID: this.env.PENGUIN_AGENT_ID,
            PENGUIN_ORG_ID: this.env.PENGUIN_ORG_ID,
          },
        });
      });

    this.initSqlite(options.db);
    this.loadState();
  }

  private initSqlite(sharedDb?: DatabaseSync): void {
    if (sharedDb) {
      this.db = sharedDb;
      this.ownsDb = false;
    } else if (this.dbPath) {
      try {
        if (this.dbPath !== ":memory:") {
          const dir = path.dirname(this.dbPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
        }
        this.db = new DatabaseSync(this.dbPath);
        this.ownsDb = true;
      } catch (err) {
        console.error("[PenguinChannelWorld] Failed to initialize SQLite database:", err);
        return;
      }
    } else {
      return;
    }

    try {
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS seen_messages (
          id TEXT PRIMARY KEY,
          channel TEXT,
          timestamp INTEGER
        );
        CREATE TABLE IF NOT EXISTS world_state (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER
        );
      `);
      this.insertSeenStmt = this.db.prepare(
        "INSERT OR IGNORE INTO seen_messages (id, channel, timestamp) VALUES (?, ?, ?)",
      );
      this.selectAllSeenStmt = this.db.prepare("SELECT id FROM seen_messages");
    } catch (err) {
      console.error("[PenguinChannelWorld] Failed to initialize SQLite database tables:", err);
    }
  }

  private loadState(): void {
    if (!this.db || !this.selectAllSeenStmt) return;
    try {
      // 1. Load seen IDs from SQLite
      const rows = this.selectAllSeenStmt.all() as Array<{ id: string }>;
      for (const row of rows) {
        if (row && typeof row.id === "string") {
          this.seenIds.add(row.id);
        }
      }

      // 2. Backward compatibility migration from legacy JSON file if present
      if (this.legacyStateFile && fs.existsSync(this.legacyStateFile)) {
        try {
          const raw = fs.readFileSync(this.legacyStateFile, "utf8");
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            for (const id of list) {
              if (typeof id === "string" && !this.seenIds.has(id)) {
                this.seenIds.add(id);
                this.saveState(id, "legacy-migration");
              }
            }
          }
        } catch (migrationErr) {
          console.error(
            "[PenguinChannelWorld] Failed to migrate legacy JSON state to SQLite:",
            migrationErr,
          );
        }
      }
    } catch (err) {
      console.error("[PenguinChannelWorld] Failed to load state from SQLite:", err);
    }
  }

  private saveState(id: string, channel: string): void {
    if (!this.db || !this.insertSeenStmt) return;
    try {
      this.insertSeenStmt.run(id, channel, Date.now());
    } catch (err) {
      console.error("[PenguinChannelWorld] Failed to save seen message to SQLite:", err);
    }
  }

  /**
   * Executes a single polling sweep across all monitored channels.
   * Ingests, filters, deduplicates, and normalizes raw messages into EmaInput.
   */
  async pollOnce(ctx?: EmaCtx): Promise<EmaInput[]> {
    if (this.isPolling) {
      return [];
    }
    this.isPolling = true;
    const newInputs: EmaInput[] = [];

    try {
      for (const channel of this.channels) {
        if (!this.active && !this.passive) break;

        let rawList: RawChannelMessage[] = [];
        try {
          const fetchResult = this.channelFetcher(channel, 10);
          rawList = fetchResult instanceof Promise ? await fetchResult : fetchResult;
        } catch (fetchErr) {
          this.lastPollError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
          console.error(`[PenguinChannelWorld] Failed to tail channel ${channel}:`, fetchErr);
          continue;
        }

        if (!Array.isArray(rawList)) {
          continue;
        }

        for (const raw of rawList) {
          if (!raw || typeof raw !== "object") continue;

          const id = raw.id;
          const sender = raw.sender || "";
          const text = (raw.text || "").trim();

          // Reject non-human senders and empty messages to prevent feedback loops
          if (!id || !sender.startsWith("user:") || !text) {
            continue;
          }

          if (this.seenIds.has(id)) {
            continue;
          }

          this.seenIds.add(id);
          this.saveState(id, channel);

          let ts =
            raw.time || raw.timestamp ? new Date(raw.time || raw.timestamp!).getTime() : Date.now();
          if (isNaN(ts)) {
            ts = Date.now();
          }

          const rawAny = raw as Record<string, unknown>;
          const senderName =
            typeof rawAny.sender_name === "string"
              ? rawAny.sender_name
              : typeof rawAny.senderName === "string"
                ? rawAny.senderName
                : typeof rawAny.name === "string"
                  ? rawAny.name
                  : sender;

          const targetPartId = raw.channel || raw.channelId || channel;

          const input: EmaInput = {
            id,
            world: this.worldName,
            partId: targetPartId,
            sender: {
              id: sender,
              name: senderName,
              isOwner: sender === "user:admin" || rawAny.is_owner === true,
            },
            content: text,
            timestamp: ts,
            replyTo:
              raw.reply_to || (typeof rawAny.replyTo === "string" ? rawAny.replyTo : undefined),
            metadata: {
              ...(rawAny.mentions ? { mentions: rawAny.mentions } : {}),
              ...(typeof rawAny.hop === "number" ? { hop: rawAny.hop } : {}),
              rawSender: sender,
            },
          };

          if (this.messageHistory.size >= this.historyLimit) {
            const oldest = this.messageHistory.keys().next().value;
            if (oldest) this.messageHistory.delete(oldest);
          }
          this.messageHistory.set(id, input);

          if (ctx) {
            try {
              ctx.inputBatcher.push(input);
            } catch (pushErr) {
              console.error(
                `[PenguinChannelWorld] Failed to push input to batcher for channel ${channel}:`,
                pushErr,
              );
            }
          }

          newInputs.push(input);
        }
      }
      this.lastPollTime = Date.now();
    } finally {
      this.isPolling = false;
    }

    return newInputs;
  }

  /**
   * Starts the world: mounts resource routes and launches input polling.
   */
  start(ctx: EmaCtx): Disposable {
    this.active = true;

    // 1. Mount Router Endpoints for this World
    const routeHandle = ctx.router.serve(
      `/world/${this.worldName}/*`,
      (routeCtx) => {
        const prefixRegex = new RegExp(`^\\/world\\/${this.worldName}\\/?`);
        const subpath = routeCtx.path.replace(prefixRegex, "");

        if (subpath === "" || subpath === "parts") {
          return {
            world: this.worldName,
            parts: this.listParts(),
          };
        }

        if (subpath === "status" || subpath === "health") {
          return {
            world: this.worldName,
            active: this.active,
            passive: this.passive,
            channels: [...this.channels],
            messageCount: this.messageHistory.size,
            seenCount: this.seenIds.size,
            isPolling: this.isPolling,
            lastPollTime: this.lastPollTime,
            lastDispatchTime: this.lastDispatchTime,
            lastPollError: this.lastPollError ? this.lastPollError.message : null,
            lastDispatchError: this.lastDispatchError ? this.lastDispatchError.message : null,
          };
        }

        if (subpath === "messages") {
          let list = Array.from(this.messageHistory.values());
          const limitParam = routeCtx.query.get("limit");
          if (limitParam) {
            const limit = parseInt(limitParam, 10);
            if (!isNaN(limit) && limit > 0) {
              list = list.slice(-limit);
            }
          }
          return {
            world: this.worldName,
            messages: list,
          };
        }

        if (subpath.startsWith("messages/")) {
          const id = decodeURIComponent(subpath.replace(/^messages\//, ""));
          const msg = this.messageHistory.get(id);
          if (!msg) {
            throw new Error(`Message not found: ${id}`);
          }
          return msg;
        }

        if (subpath.startsWith("parts/")) {
          const partSub = subpath.replace(/^parts\//, "");
          if (partSub.includes("/messages")) {
            const partId = decodeURIComponent(partSub.replace(/\/messages.*$/, ""));
            const part = this.listParts().find((p) => p.id === partId);
            if (!part) {
              throw new Error(`Part not found: ${partId}`);
            }
            let list = Array.from(this.messageHistory.values()).filter((m) => m.partId === partId);
            const limitParam = routeCtx.query.get("limit");
            if (limitParam) {
              const limit = parseInt(limitParam, 10);
              if (!isNaN(limit) && limit > 0) {
                list = list.slice(-limit);
              }
            }
            return {
              world: this.worldName,
              partId,
              messages: list,
            };
          }

          const partId = decodeURIComponent(partSub);
          const part = this.listParts().find((p) => p.id === partId);
          if (!part) {
            throw new Error(`Part not found: ${partId}`);
          }
          return part;
        }

        return {
          world: this.worldName,
          parts: this.listParts(),
        };
      },
      `Penguin Channel World (${this.worldName}) resource router`,
    );

    // 2. Start input polling loop
    const poll = () => {
      if (!this.active) return;
      this.pollOnce(ctx).catch((err) => {
        console.error("[PenguinChannelWorld] Unexpected error in polling cycle:", err);
      });
    };

    // Run polling loop if not in passive mode
    if (!this.passive) {
      poll();
      this.pollingTimer = setInterval(poll, this.pollInterval);
    }

    return {
      dispose: () => {
        this.active = false;
        if (this.pollingTimer) {
          clearInterval(this.pollingTimer);
          this.pollingTimer = null;
        }
        routeHandle.dispose();
        this.dispose();
      },
    };
  }

  /**
   * Closes database handles and terminates active polling timers.
   */
  dispose(): void {
    this.active = false;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.db && this.ownsDb) {
      try {
        this.insertSeenStmt = null;
        this.selectAllSeenStmt = null;
        this.db.close();
      } catch (err) {
        console.error("[PenguinChannelWorld] Error closing SQLite database:", err);
      }
      this.db = null;
    } else if (this.db && !this.ownsDb) {
      this.insertSeenStmt = null;
      this.selectAllSeenStmt = null;
      this.db = null;
    }
  }

  /**
   * Interacts with a specific channel part on behalf of an EMA Actor.
   * Enforces agent identity verification before any dispatch.
   */
  interact(_ctx: EmaCtx, actor: EmaActor, id: Id, ...args: unknown[]): Disposable {
    // Strictly verify operating employee identity
    const operatingAgentId = assertAgentIdentity(this.env);

    // Impersonation prevention: if actor identity specifies agentId, it must match operating agent
    if (actor && actor.agentId && actor.agentId !== operatingAgentId) {
      throw new Error(
        `Actor agentId (${actor.agentId}) does not match operating environment PENGUIN_AGENT_ID (${operatingAgentId}); dispatch refused to prevent impersonation`,
      );
    }

    let messageText = "";
    let sendOptions: ChannelSendOptions = {};

    if (args.length > 0) {
      if (typeof args[0] === "string") {
        if (args[0] === "reply") {
          if (typeof args[1] === "string") {
            messageText = args[1];
            if (typeof args[2] === "object" && args[2] !== null) {
              sendOptions = args[2] as ChannelSendOptions;
            }
          } else if (typeof args[1] === "object" && args[1] !== null) {
            const obj = args[1] as Record<string, unknown>;
            messageText = String(obj.message || obj.text || "");
            sendOptions = obj as ChannelSendOptions;
          }
        } else {
          messageText = args[0];
          if (typeof args[1] === "object" && args[1] !== null) {
            sendOptions = args[1] as ChannelSendOptions;
          }
        }
      } else if (typeof args[0] === "object" && args[0] !== null) {
        const obj = args[0] as Record<string, unknown>;
        messageText = String(obj.message || obj.text || "");
        sendOptions = obj as ChannelSendOptions;
      }
    }

    if (!messageText) {
      throw new Error("No message text provided for channel interaction");
    }

    // Addressing & mentions: prepend targetUser if specified and not already addressed
    if (sendOptions.targetUser) {
      const target = sendOptions.targetUser.trim();
      if (target) {
        const mentionPrefix = target.startsWith("@") ? target : `@${target}`;
        if (!messageText.startsWith(mentionPrefix)) {
          messageText = `${mentionPrefix} ${messageText}`;
        }
      }
    }

    // Loop prevention: dispatches must never mention the sending agent itself to prevent self-triggering loops
    const selfMentionRegex = new RegExp(`@(?:agent:)?${operatingAgentId}\\b`, "g");
    if (selfMentionRegex.test(messageText)) {
      messageText = messageText
        .replace(selfMentionRegex, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }

    if (!messageText) {
      throw new Error("Message text is empty after stripping self-mentions");
    }

    let cancelled = false;
    const interactionHandle: Disposable & {
      status: "pending" | "completed" | "cancelled" | "error";
    } = {
      status: "pending",
      dispose: () => {
        cancelled = true;
        interactionHandle.status = "cancelled";
      },
    };

    try {
      const res = this.channelSender(id, messageText, sendOptions);
      if (res && typeof (res as Promise<void>).then === "function") {
        (res as Promise<void>)
          .then(() => {
            if (!cancelled) {
              interactionHandle.status = "completed";
              this.lastDispatchTime = Date.now();
            }
          })
          .catch((err) => {
            if (!cancelled) {
              interactionHandle.status = "error";
              this.lastDispatchError = err instanceof Error ? err : new Error(String(err));
            }
            console.error(
              `[PenguinChannelWorld] Failed to dispatch channel message to ${id}:`,
              err,
            );
          });
      } else {
        interactionHandle.status = "completed";
        this.lastDispatchTime = Date.now();
      }
    } catch (err) {
      interactionHandle.status = "error";
      this.lastDispatchError = err instanceof Error ? err : new Error(String(err));
      console.error(`[PenguinChannelWorld] Failed to dispatch channel message to ${id}:`, err);
    }

    return interactionHandle;
  }

  /**
   * Lists all monitored channel parts.
   */
  listParts(): EmaWorldPart[] {
    return this.channels.map((ch) => ({
      id: ch,
      type: "channel",
      name: ch,
    }));
  }

  /**
   * Dynamically adds a channel part to monitor.
   */
  addChannel(channel: string): void {
    if (!this.channels.includes(channel)) {
      this.channels.push(channel);
    }
  }

  /**
   * Dynamically removes a channel part from monitoring.
   */
  removeChannel(channel: string): void {
    this.channels = this.channels.filter((c) => c !== channel);
  }

  /**
   * Returns current list of monitored channels.
   */
  getChannels(): ReadonlyArray<string> {
    return [...this.channels];
  }

  /**
   * Checks whether a message ID has already been seen/processed.
   */
  isSeen(id: string): boolean {
    return this.seenIds.has(id);
  }

  /**
   * Manually marks a message ID as seen.
   */
  markSeen(id: string, channel: string = "manual"): void {
    this.seenIds.add(id);
    this.saveState(id, channel);
  }

  /**
   * Returns total count of deduplicated seen messages.
   */
  getSeenCount(): number {
    return this.seenIds.size;
  }
}
