import { describe, expect, test, vi } from "vitest";

const updateActorStickerService = vi.hoisted(() => vi.fn());
const deleteActorStickerService = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-stickers", () => ({
  actorStickerHttpStatus: (result: {
    ok: boolean;
    error?: { code: string };
  }) =>
    result.ok
      ? 200
      : result.error?.code === "STICKER_ID_CONFLICT"
        ? 409
        : result.error?.code === "STICKER_NOT_FOUND"
          ? 404
          : 400,
  deleteActorStickerService,
  updateActorStickerService,
}));

import { DELETE, PATCH } from "./route";

describe("actor sticker item route", () => {
  test("passes metadata patch params and body to the service", async () => {
    updateActorStickerService.mockResolvedValueOnce({
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
      packDirName: "custom-pack",
    });

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          id: "hello",
          name: "新名称",
          description: "新说明",
        }),
      }),
      {
        params: Promise.resolve({
          actorId: "1",
          packDirName: "custom-pack",
          stickerId: "wave",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(updateActorStickerService).toHaveBeenCalledWith(
      "1",
      "custom-pack",
      "wave",
      {
        id: "hello",
        name: "新名称",
        description: "新说明",
      },
    );
  });

  test("passes item delete params to the service", async () => {
    deleteActorStickerService.mockResolvedValueOnce({
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
      packDirName: "custom-pack",
    });

    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({
        actorId: "1",
        packDirName: "custom-pack",
        stickerId: "wave",
      }),
    });

    expect(response.status).toBe(200);
    expect(deleteActorStickerService).toHaveBeenCalledWith(
      "1",
      "custom-pack",
      "wave",
    );
  });
});
