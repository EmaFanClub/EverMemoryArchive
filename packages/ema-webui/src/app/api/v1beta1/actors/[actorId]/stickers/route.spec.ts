import { describe, expect, test, vi } from "vitest";

const buildActorStickerListResponse = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-stickers", () => ({
  actorStickerHttpStatus: (result: { ok: boolean }) => (result.ok ? 200 : 400),
  buildActorStickerListResponse,
}));

import { GET } from "./route";

describe("actor stickers route", () => {
  test("returns sticker list status from the service result", async () => {
    buildActorStickerListResponse.mockResolvedValueOnce({
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
      packs: [],
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ actorId: "1" }),
    });

    expect(response.status).toBe(200);
    expect(buildActorStickerListResponse).toHaveBeenCalledWith("1");
  });
});
