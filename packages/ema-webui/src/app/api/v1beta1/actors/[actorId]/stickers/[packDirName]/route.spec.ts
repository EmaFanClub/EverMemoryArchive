import { describe, expect, test, vi } from "vitest";

const deleteActorStickerPackService = vi.hoisted(() => vi.fn());
const updateActorStickerPackService = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-stickers", () => ({
  actorStickerHttpStatus: (result: {
    ok: boolean;
    error?: { code: string };
  }) =>
    result.ok ? 200 : result.error?.code === "STICKER_NOT_FOUND" ? 404 : 400,
  deleteActorStickerPackService,
  updateActorStickerPackService,
}));

import { DELETE, PATCH } from "./route";

describe("actor sticker pack route", () => {
  test("passes pack patch params and body to the service", async () => {
    updateActorStickerPackService.mockResolvedValueOnce({
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
      packDirName: "custom-pack",
      pack: {
        dirName: "custom-pack",
        name: "新表情包",
        stickerCount: 0,
        stickers: [],
      },
    });

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "新表情包" }),
      }),
      {
        params: Promise.resolve({
          actorId: "1",
          packDirName: "custom-pack",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(updateActorStickerPackService).toHaveBeenCalledWith(
      "1",
      "custom-pack",
      {
        name: "新表情包",
      },
    );
  });

  test("passes pack delete params to the service", async () => {
    deleteActorStickerPackService.mockResolvedValueOnce({
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
      packDirName: "custom-pack",
    });

    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({
        actorId: "1",
        packDirName: "custom-pack",
      }),
    });

    expect(response.status).toBe(200);
    expect(deleteActorStickerPackService).toHaveBeenCalledWith(
      "1",
      "custom-pack",
    );
  });
});
