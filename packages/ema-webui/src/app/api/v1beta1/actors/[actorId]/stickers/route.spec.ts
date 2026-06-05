import { describe, expect, test, vi } from "vitest";

const buildActorStickerListResponse = vi.hoisted(() => vi.fn());
const createActorStickerPackService = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-stickers", () => ({
  actorStickerHttpStatus: (result: { ok: boolean }) => (result.ok ? 200 : 400),
  buildActorStickerListResponse,
  createActorStickerPackService,
}));

import { GET, POST } from "./route";

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

  test("passes pack create body to the service", async () => {
    createActorStickerPackService.mockResolvedValueOnce({
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
      packDirName: "custom-pack",
    });

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "自定义包" }),
      }),
      {
        params: Promise.resolve({ actorId: "1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(createActorStickerPackService).toHaveBeenCalledWith("1", {
      name: "自定义包",
    });
  });
});
