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

    it("handles multi-parameter paths and prefix routing with specificity precedence", async () => {
      const router = new SimpleEmaRouter();

      // Wildcard / prefix root for channel world
      router.serve("/world/channel", (ctx) => ({
        matched: "root",
        path: ctx.path,
      }));

      // Specific multi-parameter route under channel world
      router.serve(
        "/world/channel/parts/:partId/messages/:msgId",
        (ctx) => ({
          matched: "channel-message",
          part: ctx.params.partId,
          msg: ctx.params.msgId,
        })
      );

      // Generic route for other worlds
      router.serve(
        "/world/:worldId/status",
        (ctx) => ({
          matched: "world-status",
          world: ctx.params.worldId,
        })
      );

      // Root access
      const rootRes = await router.read<{ matched: string; path: string }>("/world/channel");
      expect(rootRes.matched).toBe("root");

      // Subpath prefix access falling back to wildcard
      const subRes = await router.read<{ matched: string; path: string }>("/world/channel/unknown/subpath");
      expect(subRes.matched).toBe("root");
      expect(subRes.path).toBe("/world/channel/unknown/subpath");

      // Specific multi-parameter route takes precedence over wildcard
      const msgRes = await router.read<{
        matched: string;
        part: string;
        msg: string;
      }>("/world/channel/parts/tg-123/messages/msg-999");
      expect(msgRes.matched).toBe("channel-message");
      expect(msgRes.part).toBe("tg-123");
      expect(msgRes.msg).toBe("msg-999");

      // Generic placeholder route matches other worlds
      const statusRes = await router.read<{
        matched: string;
        world: string;
      }>("/world/telegram/status");
      expect(statusRes.matched).toBe("world-status");
      expect(statusRes.world).toBe("telegram");
    });

    it("unmounts route cleanly when disposed", async () => {
      const router = new SimpleEmaRouter();

      const handle = router.serve("/world/channel", () => "active");
      expect(await router.read<string>("/world/channel")).toBe("active");

      handle.dispose();
      await expect(router.read("/world/channel")).rejects.toThrow("Route not found");
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

    it("coalesces burst inputs within debounce window using sqlite queue", async () => {
      const batcher = new SimpleEmaInputBatcher({
        dbPath: ":memory:",
        debounceMs: 50,
        maxWaitMs: 200,
      });
      const batches: unknown[][] = [];

      batcher.onBatch((batch) => {
        batches.push([...batch]);
        batcher.markCompleted(batch.map((b) => b.id));
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
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
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
        dbPath: ":memory:",
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
        stateFile: ":memory:",
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
