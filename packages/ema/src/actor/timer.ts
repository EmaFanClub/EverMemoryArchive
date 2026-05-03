export type HeartbeatTimerListener = () => void;

/**
 * Lightweight resettable timer that keeps firing at a fixed interval until stopped.
 */
export class HeartbeatTimer {
  private readonly listeners = new Set<HeartbeatTimerListener>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly intervalMs: number) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error("HeartbeatTimer interval must be a positive number.");
    }
  }

  /**
   * Starts the timer. Starting an already running timer resets its countdown.
   */
  start(): void {
    this.running = true;
    this.scheduleNext();
  }

  /**
   * Stops the timer and clears any pending countdown.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Resets the countdown when running, or starts the timer otherwise.
   */
  reset(): void {
    if (!this.running) {
      this.start();
      return;
    }
    this.scheduleNext();
  }

  /**
   * Registers a listener invoked on every timer tick.
   * @param listener - Callback executed when the timer fires.
   * @returns Cleanup function that removes the listener.
   */
  on(listener: HeartbeatTimerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Returns whether the timer is currently active.
   */
  isRunning(): boolean {
    return this.running;
  }

  private scheduleNext(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      for (const listener of this.listeners) {
        listener();
      }
      if (this.running) {
        this.scheduleNext();
      }
    }, this.intervalMs);
    this.timer.unref?.();
  }
}
