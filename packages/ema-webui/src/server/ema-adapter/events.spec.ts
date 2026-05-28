import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./dashboard", () => ({
  toActorSummary: vi.fn(),
}));

import { toWebBusEvent } from "./events";

describe("toWebBusEvent", () => {
  test("maps actor token usage change events for SSE clients", () => {
    const event: Parameters<typeof toWebBusEvent>[0] = {
      type: "actor.token_usage.changed",
      ts: 1000,
      actorId: 1,
      data: {
        conversationId: 42,
        recordId: 7,
        source: "chat",
      },
    };

    expect(toWebBusEvent(event)).toEqual({
      type: "actor.token_usage.changed",
      ts: 1000,
      actorId: "1",
      data: {
        conversationId: "42",
        source: "chat",
      },
    });
  });
});
