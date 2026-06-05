import { describe, expect, test, vi } from "vitest";

const exportActorStickerPackService = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-stickers", () => ({
  actorStickerHttpStatus: (result: {
    ok: boolean;
    error?: { code: string };
  }) =>
    result.ok ? 200 : result.error?.code === "STICKER_NOT_FOUND" ? 404 : 400,
  exportActorStickerPackService,
}));

import { GET } from "./route";

describe("actor sticker pack export route", () => {
  test("returns an emapack download response", async () => {
    exportActorStickerPackService.mockResolvedValueOnce({
      ok: true,
      fileName: "自定义包.emapack",
      buffer: Buffer.from("zip"),
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({
        actorId: "1",
        packDirName: "custom-pack",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("content-disposition")).toContain(".emapack");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from("zip"),
    );
    expect(exportActorStickerPackService).toHaveBeenCalledWith(
      "1",
      "custom-pack",
    );
  });

  test("maps missing pack result to 404", async () => {
    exportActorStickerPackService.mockResolvedValueOnce({
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
        packDirName: "missing",
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
