import { afterEach, describe, expect, test, vi } from "vitest";

import { ChannelRegistry } from "../channel_registry";
import { NapCatQQAdapter } from "../napcatqq_adapter";
import { WebsocketChannelClient } from "../channel_client";

function createServer() {
  const loadedActors = new Set([1]);
  return {
    actorRegistry: {
      get: vi.fn((actorId: number) =>
        loadedActors.has(actorId) ? ({} as never) : null,
      ),
    },
    dbService: {
      getActorChannelConfig: vi.fn().mockResolvedValue({
        qq: {
          enabled: true,
          wsUrl: "ws://127.0.0.1:3001",
          accessToken: "token",
        },
      }),
    },
    controller: {
      channel: {
        publishQqStatus: vi.fn(async () => "failed"),
      },
    },
    logger: {
      warn: vi.fn(),
    },
    loadedActors,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChannelRegistry", () => {
  test("lists adapters and exposes the shared web channel", () => {
    const registry = new ChannelRegistry(createServer() as never);

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
      started ? "connected" : "disconnected",
    );
    const createSpy = vi
      .spyOn(WebsocketChannelClient, "create")
      .mockResolvedValue(client);

    const registry = new ChannelRegistry(createServer() as never);
    await registry.ensureStarted(1);
    await registry.ensureStarted(1);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(registry.getChannel(1, "qq")).toBe(client);
  });

  test("removeActorChannels closes actor-scoped channels and keeps the shared web channel", async () => {
    const client = await WebsocketChannelClient.create(
      "qq",
      1,
      "ws://127.0.0.1:3001",
      {} as never,
      (call) => new NapCatQQAdapter(call),
      null,
    );
    vi.spyOn(client, "close").mockResolvedValue();

    const registry = new ChannelRegistry(createServer() as never);
    registry.registerChannel(1, client);

    await registry.removeActorChannels(1);

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(registry.getChannel(1, "qq")).toBeNull();
    expect(registry.getChannel(1, "web")).toBe(registry.webChannel);
  });

  test("refreshActorChannels recreates channels only when actor runtime exists", async () => {
    const server = createServer();
    const client = await WebsocketChannelClient.create(
      "qq",
      1,
      "ws://127.0.0.1:3001",
      {} as never,
      (call) => new NapCatQQAdapter(call),
      null,
    );
    vi.spyOn(client, "start").mockImplementation(() => {});
    vi.spyOn(client, "getStatus").mockReturnValue("disconnected");
    const createSpy = vi
      .spyOn(WebsocketChannelClient, "create")
      .mockResolvedValue(client);

    const registry = new ChannelRegistry(server as never);
    await registry.refreshActorChannels(1);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(registry.getChannel(1, "qq")).toBe(client);

    server.loadedActors.delete(1);
    await registry.refreshActorChannels(1);

    expect(registry.getChannel(1, "qq")).toBeNull();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});
