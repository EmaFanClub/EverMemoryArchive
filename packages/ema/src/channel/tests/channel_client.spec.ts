import { describe, expect, test } from "vitest";

import { NapCatQQAdapter, WebsocketChannelClient } from "../index";

describe("WebsocketChannelClient", () => {
  test("builds authorization header when access token is provided", async () => {
    const client = await WebsocketChannelClient.create(
      "qq",
      1,
      "ws://127.0.0.1:8082",
      {} as never,
      (call) => new NapCatQQAdapter(call),
      "token-123",
    );

    expect((client as any).buildWebSocketInit()).toEqual({
      headers: {
        Authorization: "Bearer token-123",
      },
    });
  });

  test("does not build authorization header when access token is absent", async () => {
    const client = await WebsocketChannelClient.create(
      "qq",
      1,
      "ws://127.0.0.1:8082",
      {} as never,
      (call) => new NapCatQQAdapter(call),
      null,
    );

    expect((client as any).buildWebSocketInit()).toBeNull();
  });
});
