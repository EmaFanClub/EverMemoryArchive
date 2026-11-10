import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SimpleEmaRouter,
  SimpleEmaInputBatcher,
  QQWorld,
  QQRateLimitError,
  QQContentFilterError,
  checkQQContentFilter,
  formatAgentRelativeTime,
  type EmaCtx,
  type EmaActor,
  type EmaWorldRegistry,
  type QQChannel,
  type EmaNode,
  type EmaChannelItem,
  type EmaTemporalEnvelope,
  type EmaActionDoc,
} from "../src/index.js";

describe("QQ Channels - RFC-0002 Social Media Channel Architecture", () => {
  let router: SimpleEmaRouter;
  let inputBatcher: SimpleEmaInputBatcher;
  let registryMap: Map<string, unknown>;
  let registry: EmaWorldRegistry;
  let ctx: EmaCtx;
  let tmpDir: string;
  let dbPath: string;

  const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };
  const mockActor: EmaActor = {
    id: "actor-ema-companion",
    name: "Ema Companion",
    session: "session-2026-11-09-qq-rfc0002-test",
    agentId: "emafanclub_ema_dev",
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ema-qq-channels-test-"));
    dbPath = path.join(tmpDir, "qq-test.sqlite");

    router = new SimpleEmaRouter();
    inputBatcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
    registryMap = new Map();
    registry = {
      register: (name, world) => {
        registryMap.set(name, world);
        return {
          dispose: () => {
            registryMap.delete(name);
          },
        };
      },
      get: (name) => registryMap.get(name) as any,
      list: () =>
        [...registryMap.entries()].map(([name, world]) => ({ name, world: world as any })),
    };
    ctx = { router, inputBatcher, registry };
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("SQLite Schema & Default Channel / Node Registration", () => {
    it("initializes seen_social_nodes, seen_social_channels, and seen_social_items tables in SQLite", () => {
      const world = new QQWorld({
        dbPath,
        selfId: "100001",
        ownerUids: ["888888"],
        groups: ["123456", "789012"],
        privateUsers: ["334455"],
        passive: true,
        env: mockEnv,
      });

      const db = new DatabaseSync(dbPath);
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name);

      expect(tables).toContain("seen_social_nodes");
      expect(tables).toContain("seen_social_channels");
      expect(tables).toContain("seen_social_items");

      // Verify index on channel_id and created_at_ms
      const indexes = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name);
      expect(indexes).toContain("idx_social_items_channel");

      world.dispose();
      db.close();
    });

    it("registers default channels (group, private, qzone) and owner / companion Nodes", () => {
      const world = new QQWorld({
        dbPath,
        selfId: "100001",
        ownerUids: ["888888"],
        groups: ["123456"],
        privateUsers: ["334455"],
        passive: true,
        env: mockEnv,
      });

      // Verify companion bot Node
      const botNode = world.getSocialNode("qq:bot:100001");
      expect(botNode).toBeDefined();
      expect(botNode?.id).toBe("qq:bot:100001");
      expect(botNode?.world).toBe("qq");
      expect(botNode?.node_kind).toBe("bot");
      expect(botNode?.handle).toBe("100001");
      expect(botNode?.channelIds).toContain("qq:group:123456");
      expect(botNode?.channelIds).toContain("qq:private:334455");
      expect(botNode?.channelIds).toContain("qq:qzone:100001");

      // Verify owner Node
      const ownerNode = world.getSocialNode("qq:person:888888");
      expect(ownerNode).toBeDefined();
      expect(ownerNode?.node_kind).toBe("person");
      expect(ownerNode?.handle).toBe("888888");

      // Verify Channels
      const groupCh = world.getSocialChannel("qq:group:123456");
      expect(groupCh).toBeDefined();
      expect(groupCh?.channel_kind).toBe("group");
      expect(groupCh?.ownerNodeId).toBe("qq:group_entity:123456");

      const privateCh = world.getSocialChannel("qq:private:334455");
      expect(privateCh).toBeDefined();
      expect(privateCh?.channel_kind).toBe("private");
      expect(privateCh?.ownerNodeId).toBe("qq:person:334455");

      const qzoneCh = world.getSocialChannel("qq:qzone:100001");
      expect(qzoneCh).toBeDefined();
      expect(qzoneCh?.channel_kind).toBe("qzone");

      world.dispose();
    });
  });

  describe("Read-Through Index & Relative Temporal Perception", () => {
    it("formats relative time adapted for LLM agent cognitive grounding", () => {
      const now = Date.now();
      expect(formatAgentRelativeTime(now - 10000, now)).toBe("just now (10 seconds ago)");
      expect(formatAgentRelativeTime(now - 120000, now)).toBe("2 minutes ago (120 seconds ago)");
      expect(formatAgentRelativeTime(now - 7200000, now)).toBe("2 hours ago (7200 seconds ago)");
      expect(formatAgentRelativeTime(now - 86400000 * 3, now)).toBe("3 days ago (259200 seconds ago)");
    });

    it("indexes inbound messages into SQLite and serves items wrapped in anchored temporal envelope", async () => {
      const world = new QQWorld({
        dbPath,
        selfId: "100001",
        groups: ["654321"],
        env: mockEnv,
      });
      world.start(ctx);

      const msgTime = Date.now() - 300000; // 5 minutes ago

      await world.ingestEvent({
        time: Math.floor(msgTime / 1000),
        post_type: "message",
        message_type: "group",
        message_id: "soc-item-001",
        user_id: "777888",
        group_id: "654321",
        message: "Hello world in QQ Group!",
        sender: { nickname: "Alice" },
      });

      // Query items from router endpoint
      const res = await router.read<{
        context: { time: string; timestampMs: number; timezone?: string };
        channel: QQChannel;
        items: EmaChannelItem[];
      }>("/world/qq/channels/qq:group:654321/items");

      expect(res.context).toBeDefined();
      expect(res.context.time).toBeTruthy();
      expect(res.channel.id).toBe("qq:group:654321");
      expect(res.items.length).toBe(1);

      const item = res.items[0];
      expect(item.id).toBe("soc-item-001");
      expect(item.content).toBe("Hello world in QQ Group!");
      expect(item.authorNodeId).toBe("qq:person:777888");
      expect(item.createdAt).toContain("5 minutes ago");

      // Verify item query by ID
      const singleItem = await router.read<EmaChannelItem>("/world/qq/items/soc-item-001");
      expect(singleItem.id).toBe("soc-item-001");
      expect(singleItem.content).toBe("Hello world in QQ Group!");

      world.dispose();
    });

    it("serves read-through social queries offline from SQLite across world restarts", async () => {
      // Session 1: Create world, ingest message, index social item
      const world1 = new QQWorld({
        dbPath,
        selfId: "100001",
        groups: ["654321"],
        env: mockEnv,
      });
      world1.start(ctx);

      await world1.ingestEvent({
        time: Math.floor(Date.now() / 1000),
        post_type: "message",
        message_type: "group",
        message_id: "persisted-soc-002",
        user_id: "555666",
        group_id: "654321",
        message: "Message across restarts",
        sender: { nickname: "Bob" },
      });
      world1.dispose();

      // Session 2: Fresh router and world loading from same SQLite
      const router2 = new SimpleEmaRouter();
      const ctx2 = { ...ctx, router: router2 };
      const world2 = new QQWorld({
        dbPath,
        selfId: "100001",
        groups: ["654321"],
        env: mockEnv,
      });
      world2.start(ctx2);

      const res = await router2.read<{ items: EmaChannelItem[] }>(
        "/world/qq/channels/qq:group:654321/items",
      );
      expect(res.items.length).toBeGreaterThanOrEqual(1);
      expect(res.items.some((i) => i.id === "persisted-soc-002")).toBe(true);

      const node = await router2.read<EmaNode>("/world/qq/nodes/qq:person:555666");
      expect(node.id).toBe("qq:person:555666");
      expect(node.name).toBe("Bob");

      world2.dispose();
    });
  });

  describe("Hierarchical Action Introspection (RFC-0002)", () => {
    it("exposes all hierarchical actions via /world/qq/actions", async () => {
      const world = new QQWorld({
        dbPath: ":memory:",
        selfId: "100001",
        env: mockEnv,
      });
      world.start(ctx);

      const res = await router.read<{ actions: EmaActionDoc[] }>("/world/qq/actions");
      expect(res.actions).toBeDefined();
      expect(res.actions.length).toBeGreaterThanOrEqual(5);

      const names = res.actions.map((a) => a.name);
      expect(names).toContain("message.send");
      expect(names).toContain("message.reply");
      expect(names).toContain("notice.poke");
      expect(names).toContain("qzone.post");
      expect(names).toContain("group.card_update");

      // Test specific action query
      const actionDoc = await router.read<EmaActionDoc>("/world/qq/actions/message.send");
      expect(actionDoc.name).toBe("message.send");
      expect(actionDoc.parameters.targetId.required).toBe(true);
      expect(actionDoc.rateLimit).toBe("30/minute");

      world.dispose();
    });
  });

  describe("Content Filter & Privacy Guardrails", () => {
    it("rejects local file paths, localhost URLs, credentials, and system markers on reject mode", () => {
      const config = {
        enabled: true,
        action: "reject" as const,
        filterLocalPaths: true,
        filterLocalhost: true,
        filterSecrets: true,
        filterSystemMarkers: true,
      };

      expect(() => {
        checkQQContentFilter("Check /home/rei/secret/plan.md", config);
      }).toThrow(QQContentFilterError);

      expect(() => {
        checkQQContentFilter("Connecting to http://127.0.0.1:5700/api", config);
      }).toThrow(QQContentFilterError);

      expect(() => {
        checkQQContentFilter("Bearer sk-ant-api03-abcdef1234567890", config);
      }).toThrow(QQContentFilterError);

      expect(() => {
        checkQQContentFilter("System marker [turn_aborted] detected", config);
      }).toThrow(QQContentFilterError);
    });

    it("masks sensitive patterns with [redacted] on mask mode", () => {
      const config = {
        enabled: true,
        action: "mask" as const,
        filterLocalPaths: true,
        filterLocalhost: true,
        filterSecrets: true,
        filterSystemMarkers: true,
      };

      const masked = checkQQContentFilter(
        "Host path /home/rei/file.txt and http://localhost:8080",
        config,
      );
      expect(masked).not.toContain("/home/rei/file.txt");
      expect(masked).not.toContain("http://localhost:8080");
      expect(masked).toContain("[redacted]");
    });

    it("enforces custom banned words list", () => {
      const config = {
        enabled: false,
        action: "reject" as const,
        filterLocalPaths: false,
        filterLocalhost: false,
        filterSecrets: false,
        filterSystemMarkers: false,
      };

      expect(() => {
        checkQQContentFilter("This contains badword", config, ["badword"], "reject");
      }).toThrow(QQContentFilterError);

      const masked = checkQQContentFilter(
        "This contains badword",
        config,
        ["badword"],
        "mask",
      );
      expect(masked).toBe("This contains *******");
    });

    it("enforces rate limits on group and private dispatch", () => {
      const world = new QQWorld({
        dbPath: ":memory:",
        selfId: "100001",
        env: mockEnv,
        rateLimits: {
          groupMaxPerMinute: 2,
          privateMaxPerMinute: 2,
          qzoneMaxPerMinute: 1,
        },
      });
      world.start(ctx);

      // First two dispatches succeed
      world.interact(ctx, mockActor, "group:111", { text: "msg 1", force: true });
      world.interact(ctx, mockActor, "group:111", { text: "msg 2", force: true });

      // Third dispatch exceeds rate limit
      expect(() => {
        world.interact(ctx, mockActor, "group:111", { text: "msg 3", force: true });
      }).toThrow(QQRateLimitError);

      world.dispose();
    });
  });
});
