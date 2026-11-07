/**
 * @prism-shadow/ema - SimpleEmaInputBatcher & XML Protocol
 *
 * Coalesces incoming EmaInputs into atomic transactional batches
 * and serializes them into structured XML payloads for penguin input.
 * Conforms to RFC-0001.
 */

import type { EmaInput, EmaInputBatcher, Disposable } from "./interfaces.js";

export interface EmaBatcherOptions {
  /** Debounce window for coalescing bursty inputs (ms, default: 400) */
  debounceMs?: number;
  /** Maximum wait time before forcing a flush (ms, default: 1500) */
  maxWaitMs?: number;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Formats a batch of EmaInputs into a structured XML payload.
 */
export function formatBatchToXml(batch: ReadonlyArray<EmaInput>): string {
  if (batch.length === 0) {
    return "<Input></Input>";
  }

  const primary = batch[0];
  const worldTag = `<World>${escapeXml(primary.world)}</World>`;
  const channelTag = `<Channel>${escapeXml(primary.partId)}</Channel>`;
  const nameTag = `<Name>${escapeXml(primary.sender.name || primary.sender.id)}</Name>`;

  const messagesXml = batch
    .map((msg) => {
      const idAttr = msg.id ? ` id="${escapeXml(msg.id)}"` : "";
      return `  <Message${idAttr}>${escapeXml(msg.content)}</Message>`;
    })
    .join("\n");

  return [
    "<Input>",
    `  ${worldTag}`,
    `  ${channelTag}`,
    `  ${nameTag}`,
    messagesXml,
    "</Input>",
  ].join("\n");
}

export class SimpleEmaInputBatcher implements EmaInputBatcher {
  private debounceMs: number;
  private maxWaitMs: number;
  private buffer: EmaInput[] = [];
  private listeners: Set<(batch: ReadonlyArray<EmaInput>) => void | Promise<void>> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: EmaBatcherOptions = {}) {
    this.debounceMs = options.debounceMs ?? 400;
    this.maxWaitMs = options.maxWaitMs ?? 1500;
  }

  push(input: EmaInput): void {
    this.buffer.push(input);

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

  flush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }

    if (this.buffer.length === 0) {
      return;
    }

    const currentBatch = [...this.buffer];
    this.buffer = [];

    for (const listener of this.listeners) {
      try {
        void listener(currentBatch);
      } catch (err) {
        console.error("[EmaInputBatcher] Error in batch listener:", err);
      }
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
    this.buffer = [];
    this.listeners.clear();
  }
}
