import { describe, expect, test } from "vitest";

import { WebsocketChannelClient } from "../channel";

describe("WebsocketChannelClient", () => {
  test("builds authorization header when access token is provided", async () => {
    const client = await WebsocketChannelClient.create(
      "qq",
      1,
      "ws://127.0.0.1:8082",
      {} as never,
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
      null,
    );

    expect((client as any).buildWebSocketInit()).toBeNull();
  });
});
