import { beforeEach, describe, expect, test, vi } from "vitest";

const buildActorScheduleListResponse = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-schedule-memory", () => ({
  buildActorScheduleListResponse,
}));

import { GET, actorScheduleRouteErrorStatus } from "./route";

describe("actor schedules list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns actor schedule list payload", async () => {
    const payload = {
      apiVersion: "v1beta1",
      actorId: "1",
      groups: {
        overdue: [],
        upcoming: [],
        recurring: [],
        focused: [],
      },
    };
    buildActorScheduleListResponse.mockResolvedValueOnce(payload);

    const response = await GET(
      new Request("http://localhost/api/v1beta1/actors/1/schedules"),
      { params: Promise.resolve({ actorId: "1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(buildActorScheduleListResponse).toHaveBeenCalledWith("1");
  });

  test("classifies known schedule list errors", () => {
    expect(actorScheduleRouteErrorStatus("Invalid actor id: abc")).toBe(400);
    expect(actorScheduleRouteErrorStatus("Actor not found.")).toBe(404);
    expect(actorScheduleRouteErrorStatus("database unavailable")).toBe(500);
  });
});
