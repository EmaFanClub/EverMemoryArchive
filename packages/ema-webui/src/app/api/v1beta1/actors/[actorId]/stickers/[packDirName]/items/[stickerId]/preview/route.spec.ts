import { describe, expect, test, vi } from "vitest";

const getActorStickerPreviewService = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-stickers", () => ({
  actorStickerHttpStatus: (result: {
    ok: boolean;
    error?: { code: string };
  }) =>
    result.ok
      ? 200
      : result.error?.code === "STICKER_NOT_FOUND" ||
          result.error?.code === "ACTOR_NOT_FOUND"
        ? 404
        : 400,
  getActorStickerPreviewService,
}));

import { GET } from "./route";

describe("actor sticker preview route", () => {
  test("returns sticker image bytes and content type", async () => {
    getActorStickerPreviewService.mockResolvedValueOnce({
      ok: true,
      contentType: "image/png",
      buffer: Buffer.from("image"),
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({
        actorId: "1",
        packDirName: "custom-pack",
        stickerId: "wave",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from("image"),
    );
    expect(getActorStickerPreviewService).toHaveBeenCalledWith(
      "1",
      "custom-pack",
      "wave",
    );
  });

  test("maps missing sticker preview to 404", async () => {
    getActorStickerPreviewService.mockResolvedValueOnce({
      apiVersion: "v1beta1",
      ok: false,
      actorId: "1",
      error: {
        code: "STICKER_NOT_FOUND",
        retryable: false,
        message: "missing",
      },
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({
        actorId: "1",
        packDirName: "custom-pack",
        stickerId: "missing",
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "STICKER_NOT_FOUND",
      },
    });
  });
});
