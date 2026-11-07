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

export interface PenguinChannelWorldOptions {
  /** Array of monitored channel IDs (Parts), e.g. ["ch_ema_minimal_test"] */
  channels?: string[];
  /** Polling interval in ms (default: 5000) */
  pollInterval?: number;
  /** SQLite database path for persistent seen state (defaults to /tmp/ema-minimal-workspace/ema-state.sqlite) */
  dbPath?: string;
  /** Legacy alias for dbPath or JSON migration source */
  stateFile?: string;
  /** Custom channel fetcher for testing or alternative transports */
  channelFetcher?: (channel: string, limit?: number) => RawChannelMessage[];
  /** Custom channel sender for testing or alternative transports */
  channelSender?: (channel: string, text: string) => Promise<void> | void;
  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
}

export interface RawChannelMessage {
  id?: string;
  sender?: string;
  channel?: string;
  text?: string;
  timestamp?: string;
  reply_to?: string;
}

export class PenguinChannelWorld extends EmaWorld {
  private channels: string[];
  private pollInterval: number;
  private dbPath?: string;
  private legacyStateFile?: string;
  private channelFetcher: (channel: string, limit?: number) => RawChannelMessage[];
  private channelSender: (channel: string, text: string) => Promise<void> | void;
  private env: Record<string, string | undefined>;
  private seenIds: Set<string> = new Set();
  private messageHistory: Map<string, EmaInput> = new Map();
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  private db: DatabaseSync | null = null;
  private insertSeenStmt: StatementSync | null = null;
  private selectAllSeenStmt: StatementSync | null = null;

  constructor(options: PenguinChannelWorldOptions = {}) {
    super();
    this.channels = options.channels ?? ["ch_ema_minimal_test"];
    this.pollInterval = options.pollInterval ?? 5000;
    this.env = options.env ?? process.env;

    // Resolve SQLite database path
    if (options.dbPath) {
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
            { encoding: "utf8", env: this.env }
          );
          const parsed = JSON.parse(stdout);
          if (Array.isArray(parsed)) return parsed as RawChannelMessage[];
          if (parsed && Array.isArray(parsed.messages)) return parsed.messages as RawChannelMessage[];
          return [];
        } catch (err) {
          console.error(`[PenguinChannelWorld] Failed to tail channel ${channel}:`, err);
          return [];
        }
      });

    this.channelSender =
      options.channelSender ??
      ((channel: string, text: string) => {
        execFileSync("penguin", ["org", "channel", "send", "--channel", channel, "-m", text], {
          encoding: "utf8",
          env: this.env,
        });
      });

    this.initSqlite();
    this.loadState();
  }

  private initSqlite(): void {
    if (!this.dbPath) return;
    try {
      if (this.dbPath !== ":memory:") {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec(`
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
        "INSERT OR IGNORE INTO seen_messages (id, channel, timestamp) VALUES (?, ?, ?)"
      );
      this.selectAllSeenStmt = this.db.prepare(
        "SELECT id FROM seen_messages"
      );
    } catch (err) {
      console.error("[PenguinChannelWorld] Failed to initialize SQLite database:", err);
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
          console.error("[PenguinChannelWorld] Failed to migrate legacy JSON state to SQLite:", migrationErr);
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
   * Starts the world: mounts resource routes and launches input polling.
   */
  start(ctx: EmaCtx): Disposable {
    this.active = true;

    // 1. Mount Router Endpoints for this World
    const routeHandle = ctx.router.serve(
      "/world/channel",
      (routeCtx) => {
        const subpath = routeCtx.path.replace(/^\/world\/channel\/?/, "");

        if (subpath === "" || subpath === "parts") {
          return {
            world: "channel",
            parts: this.listParts(),
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
          const partId = decodeURIComponent(subpath.replace(/^parts\//, ""));
          const part = this.listParts().find((p) => p.id === partId);
          if (!part) {
            throw new Error(`Part not found: ${partId}`);
          }
          return part;
        }

        return {
          world: "channel",
          parts: this.listParts(),
        };
      },
      "Penguin Channel World resource router"
    );

    // 2. Start input polling loop
    const poll = () => {
      if (!this.active) return;
      for (const channel of this.channels) {
        const rawList = this.channelFetcher(channel, 10);
        for (const raw of rawList) {
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

          const input: EmaInput = {
            id,
            world: "channel",
            partId: channel,
            sender: {
              id: sender,
              name: sender,
              isOwner: sender === "user:admin",
            },
            content: text,
            timestamp: raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now(),
            replyTo: raw.reply_to,
          };

          this.messageHistory.set(id, input);
          ctx.inputBatcher.push(input);
        }
      }
    };

    // Run first poll immediately, then periodically
    poll();
    this.pollingTimer = setInterval(poll, this.pollInterval);

    return {
      dispose: () => {
        this.active = false;
        if (this.pollingTimer) {
          clearInterval(this.pollingTimer);
          this.pollingTimer = null;
        }
        routeHandle.dispose();
      },
    };
  }

  /**
   * Interacts with a specific channel part on behalf of an EMA Actor.
   * Enforces agent identity verification before any dispatch.
   */
  interact(
    _ctx: EmaCtx,
    _actor: EmaActor,
    id: Id,
    ...args: unknown[]
  ): Disposable {
    // Strictly verify operating employee identity
    assertAgentIdentity(this.env);

    let messageText = "";
    if (args.length > 0) {
      if (typeof args[0] === "string") {
        messageText = args[0] === "reply" && typeof args[1] === "string" ? args[1] : args[0];
      } else if (typeof args[0] === "object" && args[0] !== null) {
        const obj = args[0] as Record<string, unknown>;
        messageText = String(obj.message || obj.text || "");
      }
    }

    if (!messageText) {
      throw new Error("No message text provided for channel interaction");
    }

    void this.channelSender(id, messageText);

    return {
      dispose: () => {},
    };
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
}
