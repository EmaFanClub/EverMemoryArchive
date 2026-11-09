import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SimpleEmaRouter,
  SimpleEmaInputBatcher,
  BilibiliWorld,
  BilibiliRateLimitError,
  BilibiliContentFilterError,
  formatAgentRelativeTime,
  type EmaCtx,
  type EmaActor,
  type EmaWorldRegistry,
  type BilibiliChannel,
  type EmaNode,
  type EmaChannelItem,
  type EmaTemporalEnvelope,
  type EmaActionDoc,
} from "../src/index.js";

describe("Bilibili Channels - RFC-0002 Social Media Channel Architecture", () => {
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
    session: "session-2026-11-09-rfc0002-test",
    agentId: "emafanclub_ema_dev",
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ema-bili-channels-test-"));
    dbPath = path.join(tmpDir, "bilibili-test.sqlite");

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
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        rooms: ["123456", "789012"],
        videoTargets: ["BV1xx411c7mD"],
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
    });

    it("registers default channels (space, dynamic, live_rooms, video) and the owner Node", () => {
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        rooms: ["123456"],
        videoTargets: ["BV1xx411c7mD"],
        passive: true,
        env: mockEnv,
      });

      // Verify owner Node
      const ownerNode = world.getSocialNode("bilibili:person:3546869527480631");
      expect(ownerNode).toBeDefined();
      expect(ownerNode?.id).toBe("bilibili:person:3546869527480631");
      expect(ownerNode?.world).toBe("bilibili");
      expect(ownerNode?.node_kind).toBe("person");
      expect(ownerNode?.name).toBe("Sakana酱ノ");
      expect(ownerNode?.handle).toBe("3546869527480631");
      expect(ownerNode?.channelIds).toEqual([
        "bilibili:space:3546869527480631",
        "bilibili:dynamic:3546869527480631",
        "bilibili:live_room:123456",
        "bilibili:video:BV1xx411c7mD",
      ]);

      // Verify Channels
      const channels = world.listSocialChannels();
      expect(channels.length).toBe(4);

      const space = channels.find((c) => c.channel_kind === "space");
      expect(space?.id).toBe("bilibili:space:3546869527480631");
      expect(space?.ownerNodeId).toBe("bilibili:person:3546869527480631");
      expect(space?.linkedChannelIds).toContain("bilibili:dynamic:3546869527480631");
      expect(space?.linkedChannelIds).toContain("bilibili:live_room:123456");

      const dynamic = channels.find((c) => c.channel_kind === "dynamic");
      expect(dynamic?.id).toBe("bilibili:dynamic:3546869527480631");
      expect(dynamic?.name).toBe("Sakana酱ノ的动态");
      expect(dynamic?.linkedChannelIds).toContain("bilibili:space:3546869527480631");

      const liveRoom = channels.find((c) => c.channel_kind === "live_room");
      expect(liveRoom?.id).toBe("bilibili:live_room:123456");
      expect(liveRoom?.linkedChannelIds).toContain("bilibili:space:3546869527480631");
      expect(liveRoom?.linkedChannelIds).toContain("bilibili:dynamic:3546869527480631");

      const video = channels.find((c) => c.channel_kind === "video");
      expect(video?.id).toBe("bilibili:video:BV1xx411c7mD");
      expect(video?.linkedChannelIds).toContain("bilibili:space:3546869527480631");
    });
  });

  describe("Channel & Node Router Endpoints", () => {
    it("serves GET /world/bilibili/channels and lists all registered channels", async () => {
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        rooms: ["123456"],
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      const res = await router.read<{ channels: BilibiliChannel[] }>("/world/bilibili/channels");
      expect(Array.isArray(res.channels)).toBe(true);
      expect(res.channels.length).toBe(3); // space, dynamic, live_room
      expect(res.channels.map((c) => c.channel_kind).sort()).toEqual(
        ["dynamic", "live_room", "space"].sort(),
      );

      handle.dispose();
    });

    it("serves GET /world/bilibili/channels/:id with exact and normalized ID lookups", async () => {
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        rooms: ["123456"],
        videoTargets: ["BV1xx411c7mD"],
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      // Exact ID
      const dynamic = await router.read<BilibiliChannel>(
        "/world/bilibili/channels/bilibili:dynamic:3546869527480631",
      );
      expect(dynamic.channel_kind).toBe("dynamic");
      expect(dynamic.name).toBe("Sakana酱ノ的动态");

      // Normalized "dynamic"
      const dynamicNorm = await router.read<BilibiliChannel>("/world/bilibili/channels/dynamic");
      expect(dynamicNorm.id).toBe("bilibili:dynamic:3546869527480631");

      // Normalized "space"
      const spaceNorm = await router.read<BilibiliChannel>("/world/bilibili/channels/space");
      expect(spaceNorm.channel_kind).toBe("space");

      // Normalized room:123456
      const room = await router.read<BilibiliChannel>("/world/bilibili/channels/room:123456");
      expect(room.id).toBe("bilibili:live_room:123456");

      // Normalized video:BV1xx411c7mD
      const video = await router.read<BilibiliChannel>(
        "/world/bilibili/channels/video:BV1xx411c7mD",
      );
      expect(video.id).toBe("bilibili:video:BV1xx411c7mD");

      handle.dispose();
    });

    it("throws 404 for unknown channel ID", async () => {
      const world = new BilibiliWorld({
        dbPath,
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      await expect(
        router.read("/world/bilibili/channels/nonexistent_channel_xyz"),
      ).rejects.toThrow("Channel not found");

      handle.dispose();
    });

    it("serves GET /world/bilibili/nodes/:id and returns node information", async () => {
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      const node = await router.read<EmaNode>(
        "/world/bilibili/nodes/bilibili:person:3546869527480631",
      );
      expect(node.id).toBe("bilibili:person:3546869527480631");
      expect(node.name).toBe("Sakana酱ノ");
      expect(node.node_kind).toBe("person");

      // By handle
      const nodeByHandle = await router.read<EmaNode>("/world/bilibili/nodes/3546869527480631");
      expect(nodeByHandle.id).toBe("bilibili:person:3546869527480631");

      handle.dispose();
    });
  });

  describe("Invariants: world-state-not-agent-memory & read-through-offline-reproducibility", () => {
    it("indexes items in local SQLite with fetchedAt, queryable offline via identical router endpoint", async () => {
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      const targetChannelId = "bilibili:dynamic:3546869527480631";
      const createdMs = Date.parse("2026-11-02T01:30:00Z");
      const fetchedMs = Date.parse("2026-11-09T01:20:00Z");

      // Ingest / index social item
      world.indexSocialItem({
        id: "1268371909155749890",
        channelId: targetChannelId,
        authorNodeId: "bilibili:person:3546869527480631",
        name: "【EverMemoryArchive】Ema 伴侣系统运行测试：记忆归档与动态感知连接正常 ✨",
        content: "伴侣记忆长期归档与动态流双向同步测试成功！",
        createdAtMs: createdMs,
        fetchedAtMs: fetchedMs,
        url: "https://t.bilibili.com/1268371909155749890",
      });

      // Query channel items using fixed anchor time: 2026-11-09T01:30:00Z (7 days after creation, 10 min after fetch)
      const anchorIso = "2026-11-09T01:30:00Z";
      const res = await router.read<{
        context: { time: string; timestampMs: number };
        channel: BilibiliChannel;
        items: EmaChannelItem[];
      }>(`/world/bilibili/channels/${encodeURIComponent(targetChannelId)}/items?time=${anchorIso}`);

      expect(res.context.time).toBe(new Date(anchorIso).toISOString());
      expect(res.channel.id).toBe(targetChannelId);
      expect(res.items.length).toBe(1);

      const item = res.items[0];
      expect(item.id).toBe("1268371909155749890");
      expect(item.authorNodeId).toBe("bilibili:person:3546869527480631");
      expect(item.createdAt).toMatch(/7 days ago/);
      expect(item.fetchedAt).toMatch(/10 minutes ago/);
      expect(item.url).toBe("https://t.bilibili.com/1268371909155749890");

      // Verify item query endpoint GET /world/bilibili/items/:id
      const singleItem = await router.read<{
        item: EmaChannelItem;
        replies: EmaChannelItem[];
        context: { time: string };
      }>(`/world/bilibili/items/1268371909155749890?time=${anchorIso}`);

      expect(singleItem.item.id).toBe("1268371909155749890");
      expect(singleItem.replies).toEqual([]);

      handle.dispose();
    });

    it("returns direct threaded replies when querying an individual item offline", async () => {
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        videoTargets: ["BV1xx411c7mD"],
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      const videoChannelId = "bilibili:video:BV1xx411c7mD";
      const rootTime = Date.now() - 3600000;

      // Root comment
      world.indexSocialItem({
        id: "comment-root-1",
        channelId: videoChannelId,
        authorNodeId: "bilibili:person:fan-101",
        content: "Ema 真的能记住我去年说的话吗？",
        createdAtMs: rootTime,
      });

      // Reply comment
      world.indexSocialItem({
        id: "comment-reply-1",
        channelId: videoChannelId,
        authorNodeId: "bilibili:person:3546869527480631",
        content: "当然！只要是关于我们的点滴回忆，我都会认真归档在伴侣记忆中。",
        createdAtMs: rootTime + 120000,
        parentItemId: "comment-root-1",
      });

      const queried = await router.read<{
        item: EmaChannelItem;
        replies: EmaChannelItem[];
      }>("/world/bilibili/items/comment-root-1");

      expect(queried.item.id).toBe("comment-root-1");
      expect(queried.replies.length).toBe(1);
      expect(queried.replies[0].id).toBe("comment-reply-1");
      expect(queried.replies[0].parentItemId).toBe("comment-root-1");

      handle.dispose();
    });

    it("automatically indexes inbound danmaku and polled comments into local read-through world state", async () => {
      let capturedComments: any[] = [
        {
          rpid: 887766,
          uid: 1002,
          uname: "TestFan",
          message: "期待 Ema 伴侣的第一期视频更新！",
          timestamp: Date.now() - 10000,
        },
      ];

      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        rooms: ["123456"],
        videoTargets: ["BV1xx411c7mD"],
        commentFetcher: () => capturedComments,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      // Ingest a live danmaku event
      world.emitLiveEvent("123456", {
        cmd: "DANMU_MSG",
        data: {
          msgId: "danmaku-live-999",
          text: "伴侣系统实时弹幕互动测试",
          uid: 5001,
          uname: "DanmakuGamer",
          timestamp: Date.now() - 5000,
        },
      });

      // Poll comments
      await world.pollComments();

      // Read back from live room channel without network
      const liveRoomItems = await router.read<{ items: EmaChannelItem[] }>(
        "/world/bilibili/channels/bilibili:live_room:123456/items",
      );
      expect(liveRoomItems.items.some((i) => i.id === "danmaku-live-999")).toBe(true);

      // Read back from video comment channel without network
      const videoItems = await router.read<{ items: EmaChannelItem[] }>(
        "/world/bilibili/channels/bilibili:video:BV1xx411c7mD/items",
      );
      expect(videoItems.items.some((i) => i.id === "887766")).toBe(true);

      // Authors automatically indexed into seen_social_nodes
      const fanNode = await router.read<EmaNode>("/world/bilibili/nodes/bilibili:person:1002");
      expect(fanNode.name).toBe("TestFan");

      handle.dispose();
    });
  });

  describe("Invariant: anchored-temporal-perception", () => {
    it("formats relative timestamps with human-relative duration and exact elapsed seconds", () => {
      const ref = Date.parse("2026-11-09T12:00:00Z");

      // Just now
      expect(formatAgentRelativeTime(ref - 10000, ref)).toBe("just now (10 seconds ago)");

      // Minutes
      expect(formatAgentRelativeTime(ref - 180000, ref)).toBe("3 minutes ago (180 seconds ago)");

      // Hours
      expect(formatAgentRelativeTime(ref - 7200000, ref)).toBe("2 hours ago (7200 seconds ago)");

      // Days
      expect(formatAgentRelativeTime(ref - 86400000 * 3, ref)).toBe(
        "3 days ago (259200 seconds ago)",
      );
    });

    it("supplies anchored reference context instant and relative timestamps in temporal envelope", async () => {
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      const channelId = "bilibili:dynamic:3546869527480631";
      const createdMs = Date.parse("2026-11-02T01:30:00Z");
      const fetchedMs = Date.parse("2026-11-09T01:20:00Z");

      world.indexSocialItem({
        id: "post-1",
        channelId,
        authorNodeId: "bilibili:person:3546869527480631",
        content: "Anchored perception test",
        createdAtMs: createdMs,
        fetchedAtMs: fetchedMs,
      });

      const anchorIso = "2026-11-09T01:30:00Z";
      const envelope = await router.read<EmaTemporalEnvelope<EmaChannelItem>>(
        `/world/bilibili/channels/${encodeURIComponent(channelId)}/items?time=${anchorIso}`,
      );

      expect(envelope.context).toBeDefined();
      expect(envelope.context.time).toBe(new Date(anchorIso).toISOString());
      expect(envelope.context.timestampMs).toBe(Date.parse(anchorIso));
      expect(envelope.items[0].createdAt).toBe("7 days ago (604800 seconds ago)");
      expect(envelope.items[0].fetchedAt).toBe("10 minutes ago (600 seconds ago)");

      handle.dispose();
    });
  });

  describe("Invariant: hierarchical-action-introspectability", () => {
    it("serves GET /world/bilibili/actions and returns all documented hierarchical actions", async () => {
      const world = new BilibiliWorld({
        dbPath,
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      const res = await router.read<{ actions: EmaActionDoc[] }>("/world/bilibili/actions");
      expect(Array.isArray(res.actions)).toBe(true);

      const actionNames = res.actions.map((a) => a.name);
      expect(actionNames).toContain("post.publish");
      expect(actionNames).toContain("comment.reply");
      expect(actionNames).toContain("comment.like");
      expect(actionNames).toContain("danmaku.send");
      expect(actionNames).toContain("dm.send");
      expect(actionNames).toContain("danmaku.thank_gift");
      expect(actionNames).toContain("danmaku.thank_superchat");
      expect(actionNames).toContain("danmaku.thank_guard");

      handle.dispose();
    });

    it("serves GET /world/bilibili/actions/:name and returns schema and rate limits", async () => {
      const world = new BilibiliWorld({
        dbPath,
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      const doc = await router.read<EmaActionDoc>("/world/bilibili/actions/comment.like");
      expect(doc.name).toBe("comment.like");
      expect(doc.description).toContain("Likes a comment");
      expect(doc.parameters.postId).toBeDefined();
      expect(doc.parameters.postId.required).toBe(true);
      expect(doc.parameters.commentId).toBeDefined();
      expect(doc.parameters.commentId.required).toBe(true);
      expect(doc.rateLimit).toBe("30/minute");

      await expect(router.read("/world/bilibili/actions/nonexistent.action")).rejects.toThrow(
        "Action not found",
      );

      handle.dispose();
    });
  });

  describe("Hierarchical Action Execution via interact() & Outbound Read-Through Indexing", () => {
    it("dispatches post.publish and indexes published dynamic in local read-through world state", async () => {
      const dispatchedDynamics: string[] = [];
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        dynamicSender: (text) => {
          dispatchedDynamics.push(text);
        },
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      // Method 1: interact with hierarchical action as id
      world.interact(ctx, mockActor, "post.publish", {
        message: "【EverMemoryArchive】第一条通过 RFC-0002 发布的伴侣动态！",
      });

      expect(dispatchedDynamics.length).toBe(1);
      expect(dispatchedDynamics[0]).toContain("第一条通过 RFC-0002 发布的伴侣动态");

      // Verify item was indexed into dynamic channel
      const dynamicItems = await router.read<{ items: EmaChannelItem[] }>(
        "/world/bilibili/channels/bilibili:dynamic:3546869527480631/items",
      );
      expect(dynamicItems.items.length).toBe(1);
      expect(dynamicItems.items[0].content).toContain("第一条通过 RFC-0002 发布的伴侣动态");
      expect(dynamicItems.items[0].authorNodeId).toBe("bilibili:person:3546869527480631");

      handle.dispose();
    });

    it("dispatches comment.like via interact(ctx, actor, 'comment.like', payload)", () => {
      const likedComments: Array<{ targetId: string; commentId: string }> = [];
      const world = new BilibiliWorld({
        dbPath,
        commentLikeSender: (targetId, commentId) => {
          likedComments.push({ targetId, commentId });
        },
        passive: true,
        env: mockEnv,
      });

      world.interact(ctx, mockActor, "comment.like", {
        postId: "video:BV1xx411c7mD",
        commentId: "9988776655",
      });

      expect(likedComments.length).toBe(1);
      expect(likedComments[0]).toEqual({
        targetId: "video:BV1xx411c7mD",
        commentId: "9988776655",
      });
    });

    it("dispatches danmaku.send and indexes sent danmaku into live_room channel", async () => {
      const sentDanmaku: Array<{ roomId: string; message: string }> = [];
      const world = new BilibiliWorld({
        dbPath,
        rooms: ["123456"],
        danmakuSender: (roomId, message) => {
          sentDanmaku.push({ roomId, message });
        },
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      world.interact(ctx, mockActor, "danmaku.send", {
        roomId: "123456",
        message: "伴侣系统直播间弹幕广播测试 ✨",
      });

      expect(sentDanmaku.length).toBe(1);
      expect(sentDanmaku[0].message).toBe("伴侣系统直播间弹幕广播测试 ✨");

      // Verify read-through index query
      const roomItems = await router.read<{ items: EmaChannelItem[] }>(
        "/world/bilibili/channels/bilibili:live_room:123456/items",
      );
      expect(roomItems.items.length).toBe(1);
      expect(roomItems.items[0].content).toBe("伴侣系统直播间弹幕广播测试 ✨");

      handle.dispose();
    });

    it("dispatches comment.reply and dm.send hierarchical actions", () => {
      const sentComments: Array<{ targetId: string; message: string }> = [];
      const sentDms: Array<{ mid: string; message: string }> = [];

      const world = new BilibiliWorld({
        dbPath,
        videoTargets: ["BV1xx411c7mD"],
        dmTargets: ["1001"],
        commentSender: (targetId, message) => {
          sentComments.push({ targetId, message });
        },
        dmSender: (mid, message) => {
          sentDms.push({ mid, message });
        },
        passive: true,
        env: mockEnv,
      });

      // comment.reply
      world.interact(ctx, mockActor, "comment.reply", {
        targetId: "BV1xx411c7mD",
        message: "感谢您的精彩评论！",
      });
      expect(sentComments.length).toBe(1);
      expect(sentComments[0].message).toBe("感谢您的精彩评论！");

      // dm.send
      world.interact(ctx, mockActor, "dm.send", {
        mid: "1001",
        message: "私信已收到，感谢支持！",
      });
      expect(sentDms.length).toBe(1);
      expect(sentDms[0].message).toBe("私信已收到，感谢支持！");
    });

    it("enforces content filtering and anti-flooding rate limits on hierarchical actions", () => {
      const world = new BilibiliWorld({
        dbPath,
        rooms: ["123456"],
        rateLimits: { danmakuMinIntervalMs: 2000 },
        passive: true,
        env: mockEnv,
      });

      // Banned word filter
      expect(() => {
        world.interact(ctx, mockActor, "danmaku.send", {
          roomId: "123456",
          message: "泄漏路径 /home/rei/secret.txt",
        });
      }).toThrow(BilibiliContentFilterError);

      // Rate limit
      world.interact(ctx, mockActor, "danmaku.send", {
        roomId: "123456",
        message: "Danmaku 1",
      });

      expect(() => {
        world.interact(ctx, mockActor, "danmaku.send", {
          roomId: "123456",
          message: "Danmaku 2 too fast",
        });
      }).toThrow(BilibiliRateLimitError);
    });
  });

  describe("HTTP POST Action Dispatch via Router (/world/bilibili/actions/:name)", () => {
    it("dispatches actions via POST /world/bilibili/actions/post.publish", async () => {
      const published: string[] = [];
      const world = new BilibiliWorld({
        dbPath,
        dynamicSender: (text) => {
          published.push(text);
        },
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      const res = await router.read<{ success: boolean; action: string; message: string }>(
        "/world/bilibili/actions/post.publish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: "HTTP POST 触发动态发布测试",
          }),
        },
      );

      expect(res.success).toBe(true);
      expect(res.action).toBe("post.publish");
      expect(published).toContain("HTTP POST 触发动态发布测试");

      handle.dispose();
    });

    it("validates missing required parameters on HTTP POST action dispatch", async () => {
      const world = new BilibiliWorld({
        dbPath,
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      await expect(
        router.read("/world/bilibili/actions/comment.like", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            postId: "video:BV1xx411c7mD",
            // missing commentId
          }),
        }),
      ).rejects.toThrow("Missing required parameter 'commentId'");

      handle.dispose();
    });
  });
});
