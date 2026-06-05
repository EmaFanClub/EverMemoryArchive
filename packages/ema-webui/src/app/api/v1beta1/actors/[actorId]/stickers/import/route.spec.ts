import { beforeEach, describe, expect, test, vi } from "vitest";

const importActorStickerPackService = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-stickers", () => ({
  actorStickerHttpStatus: (result: {
    ok: boolean;
    error?: { code: string };
  }) =>
    result.ok ? 200 : result.error?.code === "STICKER_ID_CONFLICT" ? 409 : 400,
  importActorStickerPackService,
}));

import { POST } from "./route";

describe("actor sticker pack import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("passes uploaded emapack file to the service", async () => {
    importActorStickerPackService.mockResolvedValueOnce({
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
      packDirName: "custom-pack",
    });
    const form = new FormData();
    form.append(
      "file",
      new Blob([Buffer.from("zip")], {
        type: "application/octet-stream",
      }),
      "pack.emapack",
    );

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: form,
      }),
      {
        params: Promise.resolve({ actorId: "1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(importActorStickerPackService).toHaveBeenCalledWith("1", {
      fileName: "pack.emapack",
      buffer: Buffer.from("zip"),
    });
  });

  test("returns 400 when the upload does not contain a file", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: new FormData(),
      }),
      {
        params: Promise.resolve({ actorId: "1" }),
      },
    );

    expect(response.status).toBe(400);
    expect(importActorStickerPackService).not.toHaveBeenCalled();
  });

  test("returns a parse error when the upload body cannot be parsed", async () => {
    const response = await POST(
      {
        formData: vi.fn().mockRejectedValue(new Error("too large")),
      } as unknown as Request,
      {
        params: Promise.resolve({ actorId: "1" }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        message: "Sticker pack archive is too large or invalid.",
      },
    });
    expect(importActorStickerPackService).not.toHaveBeenCalled();
  });
});
