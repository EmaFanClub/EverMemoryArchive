import { describe, it, expect, vi } from "vitest";
import {
  SimpleEmaRouter,
  SimpleEmaInputBatcher,
  formatBatchToXml,
  escapeXml,
  PenguinChannelWorld,
  createMinimalPrototype,
  assertAgentIdentity,
  DEFAULT_MINIMAL_SYSTEM_PROMPT,
} from "../src/index.js";

describe("Minimal Prototype - World & Router Architecture", () => {
  describe("SimpleEmaRouter", () => {
    it("mounts routes and handles parameter extraction", async () => {
      const router = new SimpleEmaRouter();

      const handle = router.serve(
        "/world/channel/messages/:id",
        (ctx) => ({
          foundId: ctx.params.id,
          format: ctx.query.get("format") || "raw",
        }),
        "Message lookup"
      );

      const result = await router.read<{ foundId: string; format: string }>(
        "/world/channel/messages/msg-12345?format=json"
      );

      expect(result.foundId).toBe("msg-12345");
      expect(result.format).toBe("json");

      handle.dispose();
      await expect(
        router.read("/world/channel/messages/msg-12345")
      ).rejects.toThrow("Route not found");
    });

    it("lists mounted routes", () => {
      const router = new SimpleEmaRouter();
      router.serve("/world/channel", () => ({}), "Channel world root");
      router.serve("/world/telegram", () => ({}), "Telegram world root");

      const routes = router.listRoutes();
      expect(routes.length).toBe(2);
      expect(routes.map((r) => r.prefix)).toContain("/world/channel");
      expect(routes.map((r) => r.prefix)).toContain("/world/telegram");
    });
  });

  describe("SimpleEmaInputBatcher & XML Protocol", () => {
    it("escapes special characters safely in XML", () => {
      expect(escapeXml("爱<你 & <world> \"quoted\" 'single'")).toBe(
        "爱&lt;你 &amp; &lt;world&gt; &quot;quoted&quot; &apos;single&apos;"
      );
    });

    it("formats batch into structured XML payload", () => {
      const xml = formatBatchToXml([
        {
          id: "msg-1",
          world: "channel",
          partId: "telegram-channel:1234",
          sender: { id: "user:admin", name: "爱<你" },
          content: "Hello <World>",
          timestamp: 123456789,
        },
        {
          id: "msg-2",
          world: "channel",
          partId: "telegram-channel:1234",
          sender: { id: "user:admin", name: "爱<你" },
          content: "Next message",
          timestamp: 123456790,
        },
      ]);

      expect(xml).toContain("<Input>");
      expect(xml).toContain("<World>channel</World>");
      expect(xml).toContain("<Channel>telegram-channel:1234</Channel>");
      expect(xml).toContain("<Name>爱&lt;你</Name>");
      expect(xml).toContain('<Message id="msg-1">Hello &lt;World&gt;</Message>');
      expect(xml).toContain('<Message id="msg-2">Next message</Message>');
      expect(xml).toContain("</Input>");
    });

    it("coalesces burst inputs within debounce window", async () => {
      const batcher = new SimpleEmaInputBatcher({ debounceMs: 50, maxWaitMs: 200 });
      const batches: unknown[][] = [];

      batcher.onBatch((batch) => {
        batches.push([...batch]);
      });

      batcher.push({
        id: "msg-1",
        world: "channel",
        partId: "ch_test",
        sender: { id: "user:1", name: "User1" },
        content: "burst 1",
        timestamp: Date.now(),
      });

      batcher.push({
        id: "msg-2",
        world: "channel",
        partId: "ch_test",
        sender: { id: "user:1", name: "User1" },
        content: "burst 2",
        timestamp: Date.now(),
      });

      expect(batches.length).toBe(0);

      // Wait for debounce to settle
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(batches.length).toBe(1);
      expect(batches[0].length).toBe(2);

      batcher.dispose();
    });
  });

  describe("PenguinChannelWorld", () => {
    it("mounts routes, lists parts, and serves message lookups", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher();
      const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };

      const mockFetcher = vi.fn().mockReturnValue([
        {
          id: "msg-101",
          sender: "user:alice",
          text: "Status check",
          timestamp: new Date().toISOString(),
        },
        {
          id: "msg-102",
          sender: "agent:bot", // should be rejected
          text: "Bot reply",
        },
      ]);

      const sentMessages: Array<{ channel: string; text: string }> = [];
      const mockSender = (channel: string, text: string) => {
        sentMessages.push({ channel, text });
      };

      const channelWorld = new PenguinChannelWorld({
        channels: ["ch_ema_minimal_test", "default_channel"],
        pollInterval: 10000,
        channelFetcher: mockFetcher,
        channelSender: mockSender,
        env: mockEnv,
      });

      const handle = channelWorld.start({
        router,
        inputBatcher: batcher,
        registry: {
          register: () => ({ dispose: () => {} }),
          get: () => undefined,
          list: () => [],
        },
      });

      // Check router serving parts
      const partsResult = await router.read<{ world: string; parts: Array<{ id: string }> }>(
        "/world/channel/parts"
      );
      expect(partsResult.world).toBe("channel");
      expect(partsResult.parts.map((p) => p.id)).toEqual([
        "ch_ema_minimal_test",
        "default_channel",
      ]);

      // Check router serving message lookup
      const msgResult = await router.read<{ id: string; content: string }>(
        "/world/channel/messages/msg-101"
      );
      expect(msgResult.id).toBe("msg-101");
      expect(msgResult.content).toBe("Status check");

      // Test interact
      channelWorld.interact(
        { router, inputBatcher: batcher, registry: { register: () => ({ dispose: () => {} }), get: () => undefined, list: () => [] } },
        { id: "actor-1", name: "Ema", session: "sess-1", agentId: "emafanclub_ema_dev" },
        "ch_ema_minimal_test",
        "reply",
        "System operational."
      );

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].channel).toBe("ch_ema_minimal_test");
      expect(sentMessages[0].text).toBe("System operational.");

      handle.dispose();
    });

    it("refuses interact dispatch without PENGUIN_AGENT_ID", () => {
      const channelWorld = new PenguinChannelWorld({
        channels: ["ch_test"],
        env: { PENGUIN_AGENT_ID: "" },
      });

      expect(() => {
        channelWorld.interact(
          {} as never,
          { id: "a", name: "b", session: "c", agentId: "" },
          "ch_test",
          "reply",
          "hello"
        );
      }).toThrow("refusing to dispatch without an agent identity");
    });
  });

  describe("createMinimalPrototype (End-to-End)", () => {
    it("assembles world, router, batcher, and completes turn through XML payload", async () => {
      const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };
      const receivedPrompts: string[] = [];
      const dispatchedOutputs: Array<{ channel: string; text: string }> = [];

      const proto = createMinimalPrototype({
        channels: ["ch_ema_minimal_test"],
        pollInterval: 10000,
        batcherOptions: { debounceMs: 20, maxWaitMs: 100 },
        env: mockEnv,
        channelFetcher: () => [
          {
            id: "msg-proto-1",
            sender: "user:admin",
            text: "Hello from board",
            timestamp: new Date().toISOString(),
          },
        ],
        channelSender: (channel, text) => {
          dispatchedOutputs.push({ channel, text });
        },
        llmInvoker: async (xmlPayload, sysPrompt) => {
          receivedPrompts.push(xmlPayload);
          expect(sysPrompt).toBe(DEFAULT_MINIMAL_SYSTEM_PROMPT);
          return "Factual response to board query.";
        },
      });

      // Query router to verify world routes mounted
      const routes = proto.router.listRoutes();
      expect(routes.some((r) => r.prefix === "/world/channel")).toBe(true);

      // Wait for debounce batch flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedPrompts.length).toBe(1);
      expect(receivedPrompts[0]).toContain("<Input>");
      expect(receivedPrompts[0]).toContain("<World>channel</World>");
      expect(receivedPrompts[0]).toContain("<Channel>ch_ema_minimal_test</Channel>");
      expect(receivedPrompts[0]).toContain("<Message id=\"msg-proto-1\">Hello from board</Message>");

      expect(dispatchedOutputs.length).toBe(1);
      expect(dispatchedOutputs[0].channel).toBe("ch_ema_minimal_test");
      expect(dispatchedOutputs[0].text).toContain("Factual response to board query.");

      proto.dispose();
    });
  });
});
