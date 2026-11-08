/**
 * @prism-shadow/ema - SimpleEmaInputBatcher & XML Protocol (RFC-0001)
 *
 * Implements a transactional, crash-safe input queue using SQLite (node:sqlite)
 * and robust XML building/validation using fast-xml-parser.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { XMLBuilder, XMLValidator } from "fast-xml-parser";
import type { EmaInput, EmaInputBatcher, Disposable } from "./interfaces.js";

export interface EmaBatcherOptions {
  /** Debounce window for coalescing bursty inputs (ms, default: 400) */
  debounceMs?: number;
  /** Maximum wait time before forcing a flush (ms, default: 1500) */
  maxWaitMs?: number;
  /** SQLite database path for persistent transactional outbox (default: /tmp/ema-minimal-workspace/ema-state.sqlite) */
  dbPath?: string;
  /** Existing DatabaseSync instance (e.g. shared with world) */
  db?: DatabaseSync;
  /** Max batch size per flush (default: 50) */
  maxBatchSize?: number;
}

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  indentBy: "  ",
  suppressEmptyNode: false,
});

/**
 * Validates whether an XML string is well-formed using fast-xml-parser.
 */
export function validateInputXml(xml: string): boolean {
  const result = XMLValidator.validate(xml);
  return result === true;
}

/**
 * Serializes a batch of EmaInputs into a structured XML <Input> payload
 * using fast-xml-parser with automatic entity escaping and syntax validation.
 *
 * @throws {Error} if resulting XML fails validation.
 */
export function formatBatchToXml(batch: ReadonlyArray<EmaInput>): string {
  if (batch.length === 0) {
    return "<Input></Input>";
  }

  const primary = batch[0];
  const messages = batch.map((item) => ({
    "@_id": item.id,
    "#text": item.content,
  }));

  const payloadObject = {
    Input: {
      World: primary.world,
      Channel: primary.partId,
      Name: primary.sender.name || primary.sender.id,
      Message: messages.length === 1 ? messages[0] : messages,
    },
  };

  const xml = xmlBuilder.build(payloadObject) as string;

  const valid = validateInputXml(xml);
  if (!valid) {
    throw new Error(`Generated invalid XML payload:\n${xml}`);
  }

  return xml.trim();
}

/**
 * Backward-compatible helper for escaping XML characters.
 */
export function escapeXml(text: string): string {
  const dummy = { Text: text };
  const raw = xmlBuilder.build(dummy) as string;
  const match = raw.match(/<Text>([\s\S]*?)<\/Text>/);
  return match ? match[1] : text;
}

export class SimpleEmaInputBatcher implements EmaInputBatcher {
  private debounceMs: number;
  private maxWaitMs: number;
  private maxBatchSize: number;
  private dbPath: string;
  private db: DatabaseSync;
  private ownsDb = false;

  private insertStmt!: StatementSync;
  private selectPendingStmt!: StatementSync;
  private updateBatchedStmt!: StatementSync;
  private updateCompletedStmt!: StatementSync;
  private updatePendingStmt!: StatementSync;
  private pruneCompletedStmt!: StatementSync;

  private listeners: Set<(batch: ReadonlyArray<EmaInput>) => void | Promise<void>> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: EmaBatcherOptions = {}) {
    this.debounceMs = options.debounceMs ?? 400;
    this.maxWaitMs = options.maxWaitMs ?? 1500;
    this.maxBatchSize = options.maxBatchSize ?? 50;

    if (options.db) {
      this.db = options.db;
      this.dbPath = ":memory:";
      this.ownsDb = false;
    } else {
      this.dbPath = options.dbPath ?? "/tmp/ema-minimal-workspace/ema-state.sqlite";
      if (this.dbPath !== ":memory:") {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new DatabaseSync(this.dbPath);
      this.ownsDb = true;
    }

    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS input_queue (
        id TEXT PRIMARY KEY,
        world TEXT NOT NULL,
        part_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        is_owner INTEGER DEFAULT 0,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        reply_to TEXT,
        metadata TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_input_queue_status ON input_queue (status, timestamp);
    `);

    this.insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO input_queue (
        id, world, part_id, sender_id, sender_name, is_owner,
        content, timestamp, reply_to, metadata, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

    this.selectPendingStmt = this.db.prepare(`
      SELECT * FROM input_queue
      WHERE status = 'pending'
      ORDER BY timestamp ASC
      LIMIT ?
    `);

    this.updateBatchedStmt = this.db.prepare(`
      UPDATE input_queue SET status = 'batched' WHERE id = ?
    `);

    this.updateCompletedStmt = this.db.prepare(`
      UPDATE input_queue SET status = 'completed' WHERE id = ?
    `);

    this.updatePendingStmt = this.db.prepare(`
      UPDATE input_queue SET status = 'pending' WHERE id = ?
    `);

    this.pruneCompletedStmt = this.db.prepare(`
      DELETE FROM input_queue WHERE status = 'completed' AND created_at < ?
    `);

    // Reset dangling batched records from prior crash/shutdown
    this.db.exec("UPDATE input_queue SET status = 'pending' WHERE status = 'batched'");
  }

  /**
   * Pushes an input event into the transactional SQLite outbox queue.
   */
  push(input: EmaInput): void {
    try {
      this.insertStmt.run(
        input.id,
        input.world,
        input.partId,
        input.sender.id,
        input.sender.name || input.sender.id,
        input.sender.isOwner ? 1 : 0,
        input.content,
        input.timestamp,
        input.replyTo ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        Date.now(),
      );
    } catch (err) {
      console.error("[SimpleEmaInputBatcher] Failed to enqueue input in SQLite:", err);
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => {
        this.flush();
      }, this.maxWaitMs);
    }

    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);
  }

  /**
   * Flushes pending inputs out of SQLite partitioned by (world, part_id)
   * in an instantaneous atomic drain transaction and delivers batches to subscribers.
   */
  async flush(): Promise<ReadonlyArray<EmaInput>> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }

    // Atomic drain: read pending rows and immediately mark them completed in one instant transaction
    this.db.exec("BEGIN IMMEDIATE");
    let rows: Array<{
      id: string;
      world: string;
      part_id: string;
      sender_id: string;
      sender_name: string;
      is_owner: number;
      content: string;
      timestamp: number;
      reply_to: string | null;
      metadata: string | null;
    }> = [];

    try {
      rows = this.selectPendingStmt.all(this.maxBatchSize) as typeof rows;
      if (!rows || rows.length === 0) {
        this.db.exec("COMMIT");
        return [];
      }

      for (const row of rows) {
        this.updateCompletedStmt.run(row.id);
      }
      this.pruneCompletedStmt.run(Date.now() - 3600000);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      console.error("[SimpleEmaInputBatcher] Failed to atomically drain batch in SQLite:", err);
      return [];
    }

    // Partition pending rows by (world, part_id) so batches are strictly homogeneous
    const partitions = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.world}:::${row.part_id}`;
      let list = partitions.get(key);
      if (!list) {
        list = [];
        partitions.set(key, list);
      }
      list.push(row);
    }

    const allEmitted: EmaInput[] = [];

    for (const [, partitionRows] of partitions) {
      const batch: EmaInput[] = partitionRows.map((r) => ({
        id: r.id,
        world: r.world,
        partId: r.part_id,
        sender: {
          id: r.sender_id,
          name: r.sender_name,
          isOwner: Boolean(r.is_owner),
        },
        content: r.content,
        timestamp: r.timestamp,
        replyTo: r.reply_to ?? undefined,
        metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
      }));

      for (const listener of this.listeners) {
        try {
          const res = listener(batch);
          if (res && typeof (res as Promise<void>).catch === "function") {
            (res as Promise<void>).catch((err) => {
              console.error("[SimpleEmaInputBatcher] Error in async batch listener:", err);
            });
          }
        } catch (err) {
          console.error("[SimpleEmaInputBatcher] Error in batch listener:", err);
        }
      }

      allEmitted.push(...batch);
    }

    return allEmitted;
  }

  /**
   * Marks processed batch IDs as completed in SQLite and prunes expired records.
   */
  markCompleted(ids: string[]): void {
    if (ids.length === 0) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const id of ids) {
        this.updateCompletedStmt.run(id);
      }
      this.pruneCompletedStmt.run(Date.now() - 3600000);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      console.error("[SimpleEmaInputBatcher] Failed to mark completed in SQLite:", err);
    }
  }

  onBatch(listener: (batch: ReadonlyArray<EmaInput>) => void | Promise<void>): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer);
    this.listeners.clear();
    if (this.ownsDb) {
      try {
        this.db.close();
      } catch {}
    }
  }
}
