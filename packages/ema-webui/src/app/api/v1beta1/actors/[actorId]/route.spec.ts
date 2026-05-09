import { describe, expect, test, vi } from "vitest";

const deleteActorService = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/dashboard", () => ({
  deleteActorService,
}));

import { DELETE } from "./route";

describe("actor DELETE route", () => {
  test.each([
    ["Invalid actor id: abc", 400],
    ["Actor not found.", 404],
    ["Actor is training.", 409],
    ["Actor is transitioning.", 409],
    ["database is unavailable", 500],
  ])("maps %s to HTTP %i", async (message, status) => {
    deleteActorService.mockRejectedValueOnce(new Error(message));

    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ actorId: "abc" }),
    });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ message });
  });
});
