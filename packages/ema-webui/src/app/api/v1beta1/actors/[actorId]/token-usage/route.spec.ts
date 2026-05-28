import { beforeEach, describe, expect, test, vi } from "vitest";

const buildActorTokenUsageResponse = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-token-usage", () => ({
  buildActorTokenUsageResponse,
}));

import { GET, actorTokenUsageErrorStatus } from "./route";

describe("actor token usage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("passes the requested range to the actor token usage service", async () => {
    const payload = {
      apiVersion: "v1beta1",
      actorId: "1",
      range: "week",
      rangeLabel: "7天",
      total: {
        cacheReadTokens: 1,
        cacheWriteTokens: 2,
        outputTokens: 3,
        totalTokens: 6,
      },
      bySource: [],
      trendByDay: [],
    };
    buildActorTokenUsageResponse.mockResolvedValueOnce(payload);

    const response = await GET(
      new Request(
        "http://localhost/api/v1beta1/actors/1/token-usage?range=week",
      ),
      {
        params: Promise.resolve({ actorId: "1" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(buildActorTokenUsageResponse).toHaveBeenCalledWith("1", "week");
  });

  test("rejects invalid ranges before reading the service", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1beta1/actors/1/token-usage?range=bad",
      ),
      {
        params: Promise.resolve({ actorId: "1" }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Invalid token usage range: bad",
    });
    expect(buildActorTokenUsageResponse).not.toHaveBeenCalled();
  });

  test.each([
    ["Invalid actor id: abc", 400],
    ["Actor not found.", 404],
    ["database is unavailable", 500],
  ])("maps %s to HTTP %i", async (message, status) => {
    buildActorTokenUsageResponse.mockRejectedValueOnce(new Error(message));

    const response = await GET(
      new Request("http://localhost/api/v1beta1/actors/abc/token-usage"),
      {
        params: Promise.resolve({ actorId: "abc" }),
      },
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ message });
  });

  test("classifies known token usage errors", () => {
    expect(actorTokenUsageErrorStatus("Invalid actor id: abc")).toBe(400);
    expect(actorTokenUsageErrorStatus("Actor not found.")).toBe(404);
    expect(actorTokenUsageErrorStatus("database is unavailable")).toBe(500);
  });
});
