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

export class SessionQueue<T> {
  private readonly items: T[] = [];
  private readonly dequeueTimestamps: number[] = [];
  private readonly maxQueueSize: number;
  private readonly maxDispatchesPerWindow: number;
  private readonly rateLimitWindowMs: number;
  private readonly unlockedListeners = new Set<() => void>();
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
    if (this.items.length >= this.maxQueueSize) {
      this.items.shift();
    }
    this.items.push(value);
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
      console.log("SessionQueue is locked due to rate limiting.");
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
    const unlockAt = this.dequeueTimestamps[0] + this.rateLimitWindowMs;
    const delay = Math.max(0, unlockAt - now);
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
    if (this.unlockTimer) {
      clearTimeout(this.unlockTimer);
      this.unlockTimer = null;
    }
    if (emitUnlocked) {
      this.emitUnlocked();
    }
  }

  private emitUnlocked(): void {
    console.log("SessionQueue is unlocked.");
    for (const listener of this.unlockedListeners) {
      listener();
    }
  }
}
