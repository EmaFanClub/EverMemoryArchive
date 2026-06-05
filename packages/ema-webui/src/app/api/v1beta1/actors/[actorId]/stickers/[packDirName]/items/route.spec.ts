import { beforeEach, describe, expect, test, vi } from "vitest";

const createActorStickerService = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-stickers", () => ({
  actorStickerHttpStatus: (result: { ok: boolean }) => (result.ok ? 200 : 400),
  createActorStickerService,
}));

import { POST } from "./route";

describe("actor sticker item collection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("passes uploaded sticker image and metadata to the service", async () => {
    createActorStickerService.mockResolvedValueOnce({
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
      packDirName: "custom-pack",
    });
    const form = new FormData();
    form.append("id", "wave");
    form.append("name", "挥手");
    form.append("description", "打招呼");
    form.append(
      "file",
      new Blob([Buffer.from("image")], { type: "image/png" }),
      "wave.png",
    );

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: form,
      }),
      {
        params: Promise.resolve({
          actorId: "1",
          packDirName: "custom-pack",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(createActorStickerService).toHaveBeenCalledWith("1", "custom-pack", {
      id: "wave",
      name: "挥手",
      description: "打招呼",
      contentType: "image/png",
      buffer: Buffer.from("image"),
    });
  });

  test("returns a parse error when the upload body cannot be parsed", async () => {
    const response = await POST(
      {
        formData: vi.fn().mockRejectedValue(new Error("too large")),
      } as unknown as Request,
      {
        params: Promise.resolve({
          actorId: "1",
          packDirName: "custom-pack",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: {
        message: "Sticker image is too large or invalid.",
      },
    });
    expect(createActorStickerService).not.toHaveBeenCalled();
  });
});
