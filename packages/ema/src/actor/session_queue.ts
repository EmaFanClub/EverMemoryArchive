export interface SessionQueueOptions {
  maxQueueSize?: number;
  maxDispatchesPerWindow?: number;
  rateLimitWindowMs?: number;
}

export const DEFAULT_SESSION_QUEUE_OPTIONS: Required<SessionQueueOptions> = {
  maxQueueSize: 20,
  maxDispatchesPerWindow: 3,
  rateLimitWindowMs: 10_000,
};

export type SessionQueueEvent =
  | {
      type: "rate_limited";
      queueSize: number;
      dispatchesInWindow: number;
      maxDispatchesPerWindow: number;
      rateLimitWindowMs: number;
      unlockAt: number;
      delayMs: number;
    }
  | {
      type: "unlocked";
      queueSize: number;
    }
  | {
      type: "dropped";
      queueSize: number;
      maxQueueSize: number;
    };

export class SessionQueue<T> {
  private readonly items: T[] = [];
  private readonly dequeueTimestamps: number[] = [];
  private readonly maxQueueSize: number;
  private readonly maxDispatchesPerWindow: number;
  private readonly rateLimitWindowMs: number;
  private readonly unlockedListeners = new Set<() => void>();
  private readonly eventListeners = new Set<
    (event: SessionQueueEvent) => void
  >();
  private locked = false;
  private unlockTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SessionQueueOptions = {}) {
    this.maxQueueSize =
      options.maxQueueSize ?? DEFAULT_SESSION_QUEUE_OPTIONS.maxQueueSize;
    this.maxDispatchesPerWindow =
      options.maxDispatchesPerWindow ??
      DEFAULT_SESSION_QUEUE_OPTIONS.maxDispatchesPerWindow;
    this.rateLimitWindowMs =
      options.rateLimitWindowMs ??
      DEFAULT_SESSION_QUEUE_OPTIONS.rateLimitWindowMs;
  }

  push(value: T, now: number = Date.now()): void {
    this.refreshLock(now);
    let dropped = false;
    if (this.items.length >= this.maxQueueSize) {
      this.items.shift();
      dropped = true;
    }
    this.items.push(value);
    if (dropped) {
      this.emitEvent({
        type: "dropped",
        queueSize: this.items.length,
        maxQueueSize: this.maxQueueSize,
      });
    }
  }

  tryPop(now: number = Date.now()): T | null {
    this.refreshLock(now);
    if (this.items.length === 0 || this.locked) {
      return null;
    }

    const value = this.items.shift();
    if (typeof value === "undefined") {
      return null;
    }

    this.dequeueTimestamps.push(now);
    this.pruneDequeueTimestamps(now);
    if (this.dequeueTimestamps.length >= this.maxDispatchesPerWindow) {
      this.lock(now);
    }
    return value;
  }

  size(): number {
    return this.items.length;
  }

  isLocked(now: number = Date.now()): boolean {
    this.refreshLock(now);
    return this.locked;
  }

  nextUnlockAt(now: number = Date.now()): number | null {
    this.refreshLock(now);
    if (!this.locked || this.dequeueTimestamps.length === 0) {
      return null;
    }
    return this.dequeueTimestamps[0] + this.rateLimitWindowMs;
  }

  priority(now: number = Date.now()): number {
    this.refreshLock(now);
    if (this.items.length === 0 || this.locked) {
      return 0;
    }
    return this.items.length;
  }

  onUnlocked(listener: () => void): () => void {
    this.unlockedListeners.add(listener);
    return () => {
      this.unlockedListeners.delete(listener);
    };
  }

  onEvent(listener: (event: SessionQueueEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private pruneDequeueTimestamps(now: number): void {
    while (
      this.dequeueTimestamps.length > 0 &&
      now - this.dequeueTimestamps[0] >= this.rateLimitWindowMs
    ) {
      this.dequeueTimestamps.shift();
    }
  }

  private refreshLock(now: number): void {
    this.pruneDequeueTimestamps(now);
    if (
      this.locked &&
      this.dequeueTimestamps.length < this.maxDispatchesPerWindow
    ) {
      this.unlock(false);
    }
  }

  private lock(now: number): void {
    if (this.locked) {
      return;
    }
    this.locked = true;
    const unlockAt = this.getUnlockAt();
    const delay = Math.max(0, unlockAt - now);
    this.emitEvent({
      type: "rate_limited",
      queueSize: this.items.length,
      dispatchesInWindow: this.dequeueTimestamps.length,
      maxDispatchesPerWindow: this.maxDispatchesPerWindow,
      rateLimitWindowMs: this.rateLimitWindowMs,
      unlockAt,
      delayMs: delay,
    });
    if (this.unlockTimer) {
      clearTimeout(this.unlockTimer);
    }
    this.unlockTimer = setTimeout(() => {
      this.unlockTimer = null;
      this.refreshLock(Date.now());
      if (!this.locked) {
        this.emitUnlocked();
      }
    }, delay);
  }

  private unlock(emitUnlocked: boolean): void {
    if (!this.locked) {
      return;
    }
    this.locked = false;
    this.dequeueTimestamps.length = 0;
    if (this.unlockTimer) {
      clearTimeout(this.unlockTimer);
      this.unlockTimer = null;
    }
    this.emitEvent({
      type: "unlocked",
      queueSize: this.items.length,
    });
    if (emitUnlocked) {
      this.emitUnlocked();
    }
  }

  private emitUnlocked(): void {
    for (const listener of this.unlockedListeners) {
      listener();
    }
  }

  private emitEvent(event: SessionQueueEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private getUnlockAt(): number {
    return (this.dequeueTimestamps[0] ?? Date.now()) + this.rateLimitWindowMs;
  }
}
