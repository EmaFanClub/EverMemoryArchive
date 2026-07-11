import { beforeEach, describe, expect, test, vi } from "vitest";

const patchActorMemoryService = vi.hoisted(() => vi.fn());
const deleteActorMemoryService = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-schedule-memory", () => ({
  deleteActorMemoryService,
  patchActorMemoryService,
}));

import { DELETE, PATCH, actorMemoryMutationStatus } from "./route";

describe("actor memory mutation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("passes patch body to memory service", async () => {
    const payload = {
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
      memory: {
        id: "9",
        kind: "day",
        date: "2026-07-06",
        maxLength: 500,
        memory: "新日记",
      },
    };
    patchActorMemoryService.mockResolvedValueOnce(payload);

    const response = await PATCH(
      new Request("http://localhost/api/v1beta1/actors/1/memories/9", {
        method: "PATCH",
        body: JSON.stringify({ memory: "新日记" }),
      }),
      { params: Promise.resolve({ actorId: "1", memoryId: "9" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(patchActorMemoryService).toHaveBeenCalledWith("1", "9", {
      memory: "新日记",
    });
  });

  test("passes delete requests to memory service", async () => {
    const payload = {
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
    };
    deleteActorMemoryService.mockResolvedValueOnce(payload);

    const response = await DELETE(
      new Request("http://localhost/api/v1beta1/actors/1/memories/9", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ actorId: "1", memoryId: "9" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(deleteActorMemoryService).toHaveBeenCalledWith("1", "9");
  });

  test("maps mutation status codes", () => {
    expect(
      [
        { ok: true },
        { ok: false, error: { code: "MEMORY_NOT_FOUND" } },
        { ok: false, error: { code: "MEMORY_UPDATE_FAILED" } },
        { ok: false, error: { code: "MEMORY_DELETE_FAILED" } },
        { ok: false, error: { code: "INVALID_MEMORY" } },
      ].map(actorMemoryMutationStatus),
    ).toEqual([200, 404, 500, 500, 400]);
  });
});
