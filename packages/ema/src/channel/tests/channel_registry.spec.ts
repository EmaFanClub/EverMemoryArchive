import { afterEach, describe, expect, test, vi } from "vitest";

import { ChannelRegistry } from "../channel_registry";
import { NapCatQQAdapter } from "../napcatqq_adapter";
import { WebsocketChannelClient } from "../channel_client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChannelRegistry", () => {
  test("lists adapters and exposes the shared web channel", () => {
    const registry = new ChannelRegistry({} as never);

    expect(registry.listAdapterNames()).toEqual(["qq"]);
    expect(registry.getAdapterFactory("qq")).toBeTypeOf("function");
    expect(registry.getChannel(1, "web")).toBe(registry.webChannel);
  });

  test("ensureStarted creates and starts actor channels only once", async () => {
    const client = await WebsocketChannelClient.create(
      "qq",
      1,
      "ws://127.0.0.1:3001",
      {} as never,
      (call) => new NapCatQQAdapter(call),
      null,
    );
    let started = false;
    vi.spyOn(client, "start").mockImplementation(() => {
      started = true;
    });
    vi.spyOn(client, "getStatus").mockImplementation(() =>
      started ? "connected" : "exhausted",
    );
    const createSpy = vi
      .spyOn(WebsocketChannelClient, "create")
      .mockResolvedValue(client);

    const registry = new ChannelRegistry({} as never);
    await registry.ensureStarted(1);
    await registry.ensureStarted(1);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(registry.getChannel(1, "qq")).toBe(client);
  });
});
