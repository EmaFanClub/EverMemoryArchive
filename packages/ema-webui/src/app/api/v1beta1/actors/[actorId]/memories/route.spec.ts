import { beforeEach, describe, expect, test, vi } from "vitest";

const buildActorMemoryListResponse = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-schedule-memory", () => ({
  buildActorMemoryListResponse,
}));

import { GET, actorMemoryRouteErrorStatus } from "./route";

describe("actor memories list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns actor memory list payload", async () => {
    const payload = {
      apiVersion: "v1beta1",
      actorId: "1",
      groups: {
        year: [],
        month: [],
        day: [],
        activity: [],
      },
    };
    buildActorMemoryListResponse.mockResolvedValueOnce(payload);

    const response = await GET(
      new Request("http://localhost/api/v1beta1/actors/1/memories"),
      { params: Promise.resolve({ actorId: "1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(buildActorMemoryListResponse).toHaveBeenCalledWith("1");
  });

  test("classifies known memory list errors", () => {
    expect(actorMemoryRouteErrorStatus("Invalid actor id: abc")).toBe(400);
    expect(actorMemoryRouteErrorStatus("Actor not found.")).toBe(404);
    expect(actorMemoryRouteErrorStatus("database unavailable")).toBe(500);
  });
});
