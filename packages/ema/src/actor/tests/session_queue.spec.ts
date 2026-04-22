import { describe, expect, test } from "vitest";
import { SessionManager, SessionQueue } from "../index";
import type { ActorSystemInput } from "../index";

function createSystemInput(text: string): ActorSystemInput {
  return {
    kind: "system",
    conversationId: 1,
    time: 0,
    inputs: [{ type: "text", text }],
  };
}

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
});

describe("SessionManager", () => {
  test("picks the highest priority conversation first", () => {
    const manager = new SessionManager(() => {});

    manager.enqueue(2, createSystemInput("later"));
    manager.enqueue(1, createSystemInput("earlier"));
    manager.enqueue(1, createSystemInput("earlier-again"));

    expect(manager.pickNextConversationId(0)).toBe(1);
  });
});
