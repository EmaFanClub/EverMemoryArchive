import { afterEach, describe, expect, test, vi } from "vitest";
import { SessionManager, SessionQueue, type SessionQueueEvent } from "../index";
import type { ActorSystemInput } from "../index";

function createSystemInput(text: string): ActorSystemInput {
  return {
    kind: "system",
    conversationId: 1,
    time: 0,
    inputs: [{ type: "text", text }],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionQueue", () => {
  test("drops the oldest item when queue is full", () => {
    const queue = new SessionQueue<string>({
      maxQueueSize: 2,
      maxDispatchesPerWindow: 10,
      rateLimitWindowMs: 1000,
    });

    queue.push("a", 0);
    queue.push("b", 1);
    queue.push("c", 2);

    expect(queue.size()).toBe(2);
    expect(queue.tryPop(3)).toBe("b");
    expect(queue.tryPop(4)).toBe("c");
  });

  test("emits a dropped event when the oldest item is discarded", () => {
    const queue = new SessionQueue<string>({
      maxQueueSize: 2,
      maxDispatchesPerWindow: 10,
      rateLimitWindowMs: 1000,
    });
    const events: SessionQueueEvent[] = [];
    queue.onEvent((event) => {
      events.push(event);
    });

    queue.push("a", 0);
    queue.push("b", 1);
    queue.push("c", 2);

    expect(events).toEqual([
      {
        type: "dropped",
        queueSize: 2,
        maxQueueSize: 2,
      },
    ]);
  });

  test("respects rate limiting when dispatching", () => {
    const queue = new SessionQueue<string>({
      maxQueueSize: 10,
      maxDispatchesPerWindow: 1,
      rateLimitWindowMs: 1000,
    });

    queue.push("a", 0);
    queue.push("b", 1);

    expect(queue.tryPop(10)).toBe("a");
    expect(queue.isLocked(11)).toBe(true);
    expect(queue.tryPop(11)).toBeNull();
    expect(queue.nextUnlockAt(11)).toBe(1010);
    expect(queue.tryPop(1010)).toBe("b");
  });

  test("resets dispatch timestamps after unlocking", () => {
    const queue = new SessionQueue<string>({
      maxQueueSize: 10,
      maxDispatchesPerWindow: 2,
      rateLimitWindowMs: 1000,
    });

    queue.push("a", 0);
    queue.push("b", 1);
    queue.push("c", 2);
    queue.push("d", 3);

    expect(queue.tryPop(10)).toBe("a");
    expect(queue.tryPop(20)).toBe("b");
    expect(queue.isLocked(30)).toBe(true);
    expect(queue.tryPop(1010)).toBe("c");
    expect(queue.isLocked(1011)).toBe(false);
    expect(queue.tryPop(1020)).toBe("d");
    expect(queue.isLocked(1021)).toBe(true);
  });

  test("emits rate-limited and unlocked events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    const queue = new SessionQueue<string>({
      maxQueueSize: 10,
      maxDispatchesPerWindow: 1,
      rateLimitWindowMs: 1000,
    });
    const events: SessionQueueEvent[] = [];
    queue.onEvent((event) => {
      events.push(event);
    });

    queue.push("a", 0);
    queue.push("b", 1);

    expect(queue.tryPop(10)).toBe("a");
    expect(events).toEqual([
      {
        type: "rate_limited",
        queueSize: 1,
        dispatchesInWindow: 1,
        maxDispatchesPerWindow: 1,
        rateLimitWindowMs: 1000,
        unlockAt: 1010,
        delayMs: 1000,
      },
    ]);

    vi.advanceTimersByTime(1000);

    expect(events).toEqual([
      {
        type: "rate_limited",
        queueSize: 1,
        dispatchesInWindow: 1,
        maxDispatchesPerWindow: 1,
        rateLimitWindowMs: 1000,
        unlockAt: 1010,
        delayMs: 1000,
      },
      {
        type: "unlocked",
        queueSize: 1,
      },
    ]);
  });

  test("emits rate-limited when the queue locks even without pending items", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    const queue = new SessionQueue<string>({
      maxQueueSize: 10,
      maxDispatchesPerWindow: 1,
      rateLimitWindowMs: 1000,
    });
    const events: SessionQueueEvent[] = [];
    queue.onEvent((event) => {
      events.push(event);
    });

    queue.push("a", 0);
    expect(queue.tryPop(10)).toBe("a");
    expect(events).toEqual([
      {
        type: "rate_limited",
        queueSize: 0,
        dispatchesInWindow: 1,
        maxDispatchesPerWindow: 1,
        rateLimitWindowMs: 1000,
        unlockAt: 1010,
        delayMs: 1000,
      },
    ]);

    vi.advanceTimersByTime(1000);

    expect(events).toEqual([
      {
        type: "rate_limited",
        queueSize: 0,
        dispatchesInWindow: 1,
        maxDispatchesPerWindow: 1,
        rateLimitWindowMs: 1000,
        unlockAt: 1010,
        delayMs: 1000,
      },
      {
        type: "unlocked",
        queueSize: 0,
      },
    ]);
  });
});

describe("SessionManager", () => {
  test("picks the highest priority conversation first", () => {
    const manager = new SessionManager(() => {});

    manager.enqueue(2, createSystemInput("later"));
    manager.enqueue(1, createSystemInput("earlier"));
    manager.enqueue(1, createSystemInput("earlier-again"));

    expect(manager.pickNextConversationId(0)).toBe(1);
  });

  test("passes queue events with conversation id", () => {
    const events: Array<{
      conversationId: number;
      event: SessionQueueEvent;
    }> = [];
    const manager = new SessionManager(
      () => {},
      {
        maxQueueSize: 10,
        maxDispatchesPerWindow: 1,
        rateLimitWindowMs: 1000,
      },
      (conversationId, event) => {
        events.push({ conversationId, event });
      },
    );

    manager.enqueue(2, createSystemInput("first"));
    manager.enqueue(2, createSystemInput("second"));
    expect(manager.tryPop(2, 10)).not.toBeNull();

    expect(events).toEqual([
      {
        conversationId: 2,
        event: {
          type: "rate_limited",
          queueSize: 1,
          dispatchesInWindow: 1,
          maxDispatchesPerWindow: 1,
          rateLimitWindowMs: 1000,
          unlockAt: 1010,
          delayMs: 1000,
        },
      },
    ]);
  });
});
