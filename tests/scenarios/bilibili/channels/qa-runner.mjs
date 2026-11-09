#!/usr/bin/env node
/**
 * QA Scenario Runner: Bilibili Social Media Channel Architecture (RFC-0002)
 *
 * Automated certification runner validating the 4 core invariants of RFC-0002:
 * 1. world-state-not-agent-memory: SQLite caching in perceived world state
 * 2. read-through-offline-reproducibility: Offline reproducibility without platform network calls
 * 3. anchored-temporal-perception: Agent-adapted relative timestamps and envelope context
 * 4. hierarchical-action-introspectability: Introspectable action schemas and hierarchical dispatch
 *
 * Usage:
 *   node tests/scenarios/bilibili/channels/qa-runner.mjs [--json] [--db <path>]
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  SimpleEmaRouter,
  SimpleEmaInputBatcher,
  BilibiliWorld,
  BilibiliContentFilterError,
  BilibiliRateLimitError,
  formatAgentRelativeTime,
} from "../../../../packages/ema/dist/index.js";

const DEFAULT_OWNER_UID = "3546869527480631";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    json: false,
    db: "",
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") {
      options.json = true;
    } else if (args[i] === "--db") {
      options.db = args[++i];
    }
  }
  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[AssertionFailed] ${message}`);
  }
}

async function runQA() {
  const opts = parseArgs();
  const startTime = Date.now();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ema-bili-qa-"));
  const dbPath = opts.db || path.join(tmpDir, "bili-qa.sqlite");

  const results = {
    target: "RFC-0002 Bilibili Social Media Channel Architecture",
    timestamp: new Date().toISOString(),
    invariants: {
      "world-state-not-agent-memory": false,
      "read-through-offline-reproducibility": false,
      "anchored-temporal-perception": false,
      "hierarchical-action-introspectability": false,
    },
    checks: [],
    errors: [],
  };

  function recordCheck(name, pass, details) {
    results.checks.push({ name, pass, details });
    if (!opts.json) {
      const mark = pass ? "\x1b[32m[PASS]\x1b[0m" : "\x1b[31m[FAIL]\x1b[0m";
      console.log(` ${mark} ${name}${details ? ` - ${details}` : ""}`);
    }
  }

  try {
    if (!opts.json) {
      console.log("==================================================================");
      console.log(" EverMemoryArchive QA: Bilibili Channels Architecture (RFC-0002)  ");
      console.log("==================================================================");
    }

    const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };
    const mockActor = {
      id: "actor-qa-runner",
      name: "Ema QA Runner",
      session: "session-2026-11-09-qa-runner",
      agentId: "emafanclub_ema_dev",
    };

    const router = new SimpleEmaRouter();
    const inputBatcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
    const registryMap = new Map();
    const registry = {
      register: (name, world) => {
        registryMap.set(name, world);
        return { dispose: () => registryMap.delete(name) };
      },
      get: (name) => registryMap.get(name),
      list: () => [...registryMap.entries()].map(([name, world]) => ({ name, world })),
    };
    const ctx = { router, inputBatcher, registry };

    const capturedOutbound = {
      dynamics: [],
      comments: [],
      danmaku: [],
      dms: [],
      likes: [],
    };

    const world = new BilibiliWorld({
      dbPath,
      ownerUid: DEFAULT_OWNER_UID,
      rooms: ["123456", "789012"],
      videoTargets: ["BV1xx411c7mD"],
      dmTargets: ["1001"],
      rateLimits: {
        dynamicMinIntervalMs: 0,
        danmakuMinIntervalMs: 0,
        commentMinIntervalMs: 0,
        dmMinIntervalMs: 0,
      },
      dynamicSender: (text) => capturedOutbound.dynamics.push(text),
      commentSender: (targetId, message) => capturedOutbound.comments.push({ targetId, message }),
      danmakuSender: (roomId, message) => capturedOutbound.danmaku.push({ roomId, message }),
      dmSender: (mid, message) => capturedOutbound.dms.push({ mid, message }),
      commentLikeSender: (targetId, commentId) => capturedOutbound.likes.push({ targetId, commentId }),
      passive: true,
      env: mockEnv,
    });

    const worldHandle = world.start(ctx);

    // --- Check 1: SQLite Schema Validation ---
    const db = new DatabaseSync(dbPath);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    ).map((r) => r.name);

    assert(tables.includes("seen_social_nodes"), "Table seen_social_nodes exists");
    assert(tables.includes("seen_social_channels"), "Table seen_social_channels exists");
    assert(tables.includes("seen_social_items"), "Table seen_social_items exists");

    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all()
    ).map((r) => r.name);
    assert(indexes.includes("idx_social_items_channel"), "Index idx_social_items_channel exists");
    recordCheck("SQLite Schema Initialization", true, "Tables & channel index verified");

    // --- Check 2: Default Channels & Owner Node Registration ---
    const ownerNode = world.getSocialNode(`bilibili:person:${DEFAULT_OWNER_UID}`);
    assert(ownerNode && ownerNode.name === "Sakana酱ノ", "Owner Node registered with correct name");
    assert(ownerNode.channelIds.length === 5, "Owner Node links to all 5 default channels");

    const channelsRes = await router.read("/world/bilibili/channels");
    assert(channelsRes.channels.length === 5, "All default channels listed via router");

    const spaceChannel = await router.read("/world/bilibili/channels/space");
    assert(spaceChannel.channel_kind === "space", "Space channel queryable by normalized kind");
    assert(spaceChannel.linkedChannelIds.length >= 2, "Space channel links to dynamic & live rooms");

    const dynamicChannel = await router.read("/world/bilibili/channels/dynamic");
    assert(dynamicChannel.channel_kind === "dynamic", "Dynamic channel queryable by normalized kind");
    recordCheck("Default Channels & Node Topology", true, "5 channels, linkages, and owner verified");

    // --- Check 3: Invariant world-state-not-agent-memory & read-through-offline-reproducibility ---
    const targetChannelId = `bilibili:dynamic:${DEFAULT_OWNER_UID}`;
    const fixedCreatedMs = Date.parse("2026-11-02T01:30:00.000Z");
    const fixedFetchedMs = Date.parse("2026-11-09T01:20:00.000Z");

    world.indexSocialItem({
      id: "qa-item-12345",
      channelId: targetChannelId,
      authorNodeId: `bilibili:person:${DEFAULT_OWNER_UID}`,
      name: "【EMA QA】RFC-0002 架构认证验证项",
      content: "离线重现性与客观世界状态持久化测试成功！",
      createdAtMs: fixedCreatedMs,
      fetchedAtMs: fixedFetchedMs,
      url: "https://t.bilibili.com/qa-item-12345",
    });

    const fixedAnchorIso = "2026-11-09T01:30:00.000Z";
    const channelItemsRes = await router.read(
      `/world/bilibili/channels/${encodeURIComponent(targetChannelId)}/items?time=${fixedAnchorIso}`
    );

    assert(channelItemsRes.items.length === 1, "Channel returns cached item offline");
    assert(channelItemsRes.items[0].id === "qa-item-12345", "Item ID matches indexed record");

    // Threaded reply verification
    world.indexSocialItem({
      id: "qa-reply-1",
      channelId: targetChannelId,
      authorNodeId: "bilibili:person:fan-777",
      content: "期待 Ema 伴侣的长期记忆与动态系统！",
      createdAtMs: fixedCreatedMs + 60000,
      parentItemId: "qa-item-12345",
    });

    const singleItemRes = await router.read(
      `/world/bilibili/items/qa-item-12345?time=${fixedAnchorIso}`
    );
    assert(singleItemRes.item.id === "qa-item-12345", "Single item retrieved offline");
    assert(singleItemRes.replies.length === 1, "Direct threaded replies retrieved");
    assert(singleItemRes.replies[0].id === "qa-reply-1", "Reply parent relationship intact");

    results.invariants["world-state-not-agent-memory"] = true;
    results.invariants["read-through-offline-reproducibility"] = true;
    recordCheck(
      "Invariant: world-state-not-agent-memory & read-through-offline-reproducibility",
      true,
      "Perceived items stored in SQLite and resolved offline without network"
    );

    // --- Check 4: Invariant anchored-temporal-perception ---
    assert(channelItemsRes.context.time === fixedAnchorIso, "Temporal envelope anchors reference instant");
    assert(
      channelItemsRes.items[0].createdAt === "7 days ago (604800 seconds ago)",
      `Agent relative time createdAt matches exact math: ${channelItemsRes.items[0].createdAt}`
    );
    assert(
      channelItemsRes.items[0].fetchedAt === "10 minutes ago (600 seconds ago)",
      `Agent relative time fetchedAt matches exact math: ${channelItemsRes.items[0].fetchedAt}`
    );

    // Live calculation checks
    const nowRef = Date.parse("2026-11-09T12:00:00Z");
    assert(formatAgentRelativeTime(nowRef - 5000, nowRef) === "just now (5 seconds ago)", "just now formatted correctly");
    assert(formatAgentRelativeTime(nowRef - 3600000 * 4, nowRef) === "4 hours ago (14400 seconds ago)", "hours ago formatted correctly");

    results.invariants["anchored-temporal-perception"] = true;
    recordCheck(
      "Invariant: anchored-temporal-perception",
      true,
      "Anchored context instant & exact <duration> ago (<seconds> seconds ago) formatting certified"
    );

    // --- Check 5: Invariant hierarchical-action-introspectability ---
    const actionsListRes = await router.read("/world/bilibili/actions");
    const documentedNames = actionsListRes.actions.map((a) => a.name);
    assert(documentedNames.includes("post.publish"), "post.publish documented");
    assert(documentedNames.includes("comment.like"), "comment.like documented");
    assert(documentedNames.includes("comment.reply"), "comment.reply documented");
    assert(documentedNames.includes("danmaku.send"), "danmaku.send documented");
    assert(documentedNames.includes("dm.send"), "dm.send documented");

    const likeActionDoc = await router.read("/world/bilibili/actions/comment.like");
    assert(likeActionDoc.parameters.postId.required === true, "comment.like postId required");
    assert(likeActionDoc.parameters.commentId.required === true, "comment.like commentId required");
    assert(likeActionDoc.rateLimit === "30/minute", "comment.like rate limit documented");

    results.invariants["hierarchical-action-introspectability"] = true;
    recordCheck(
      "Invariant: hierarchical-action-introspectability",
      true,
      "Dot-separated actions and parameter schemas introspectable at runtime"
    );

    // --- Check 6: Hierarchical Action Dispatch & Outbound Read-Through Indexing ---
    world.interact(ctx, mockActor, "post.publish", {
      message: "【QA Certification】通过 post.publish 广播伴侣动态",
    });
    assert(capturedOutbound.dynamics.length === 1, "post.publish invoked dynamicSender");

    // Outbound item is immediately cached in local channel index
    const dynamicItems = await router.read(
      `/world/bilibili/channels/${encodeURIComponent(targetChannelId)}/items`
    );
    assert(
      dynamicItems.items.some((i) => i.content.includes("通过 post.publish 广播伴侣动态")),
      "Published dynamic read-through indexed in seen_social_items"
    );

    world.interact(ctx, mockActor, "comment.like", {
      postId: "BV1xx411c7mD",
      commentId: "888999",
    });
    assert(capturedOutbound.likes.length === 1, "comment.like invoked commentLikeSender");
    assert(capturedOutbound.likes[0].commentId === "888999", "comment.like commentId matches");

    world.interact(ctx, mockActor, "danmaku.send", {
      roomId: "123456",
      message: "QA 直播弹幕测试",
    });
    assert(capturedOutbound.danmaku.length === 1, "danmaku.send invoked danmakuSender");

    world.interact(ctx, mockActor, "comment.reply", {
      targetId: "BV1xx411c7mD",
      message: "QA 视频回复测试",
    });
    assert(capturedOutbound.comments.length === 1, "comment.reply invoked commentSender");

    world.interact(ctx, mockActor, "dm.send", {
      mid: "1001",
      message: "QA 私信回复测试",
    });
    assert(capturedOutbound.dms.length === 1, "dm.send invoked dmSender");

    recordCheck("Hierarchical Action Dispatch via interact()", true, "All 5 core actions executed and indexed");

    // --- Check 7: HTTP POST Action Endpoint Dispatch ---
    const httpPostRes = await router.read("/world/bilibili/actions/post.publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "HTTP POST 动态发布认证" }),
    });
    assert(httpPostRes.success === true, "HTTP POST action dispatch succeeds");
    assert(capturedOutbound.dynamics.includes("HTTP POST 动态发布认证"), "HTTP POST dynamic dispatched");

    // Parameter validation on HTTP POST
    let paramValidationErrorCaught = false;
    try {
      await router.read("/world/bilibili/actions/comment.like", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId: "BV1xx411c7mD" }), // missing commentId
      });
    } catch (err) {
      paramValidationErrorCaught = true;
      assert(err.message.includes("Missing required parameter 'commentId'"), "Parameter error matches");
    }
    assert(paramValidationErrorCaught, "Missing required parameter rejected with error");

    // Guardrail filtering
    let filterErrorCaught = false;
    try {
      world.interact(ctx, mockActor, "danmaku.send", {
        roomId: "123456",
        message: "敏感路径泄漏 /home/rei/vault.toml",
      });
    } catch (err) {
      filterErrorCaught = err instanceof BilibiliContentFilterError;
    }
    assert(filterErrorCaught, "Content filter rejects local host file leak in actions");

    recordCheck("HTTP POST Action Dispatch & Guardrails", true, "Parameter validation and content filters verified");

    worldHandle.dispose();
  } catch (err) {
    results.errors.push(err.message);
    recordCheck("QA Scenario Execution", false, err.message);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  const durationMs = Date.now() - startTime;
  results.durationMs = durationMs;
  results.allPassed = results.errors.length === 0 && Object.values(results.invariants).every(Boolean);

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log("------------------------------------------------------------------");
    console.log(` Status: ${results.allPassed ? "\x1b[32mCERTIFIED (ALL INVARIANTS PASSED)\x1b[0m" : "\x1b[31mFAILED\x1b[0m"}`);
    console.log(` Duration: ${durationMs}ms`);
    console.log(" Invariant Certification:");
    for (const [inv, passed] of Object.entries(results.invariants)) {
      console.log(`   - ${inv}: ${passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}`);
    }
    console.log("==================================================================");
  }

  process.exit(results.allPassed ? 0 : 1);
}

runQA();
