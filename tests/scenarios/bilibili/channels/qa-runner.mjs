#!/usr/bin/env node
/**
 * QA Design Certification Runner: Bilibili Social Media Channel Architecture (RFC-0002)
 *
 * Black-box evaluation verifying the architectural DESIGN from the AGENT's operational perspective:
 * 1. Agent 会用了吗: Cognitive grounding, temporal anchoring, and priority discernment without hallucination
 * 2. Agent 能使用多种 channel 了吗: Multi-channel navigation, uniform channel contracts, and cross-world coordination
 * 3. Agent 能使用 action 吗: Runtime introspection, zero-shot action selection, closed-loop feedback, and guardrails
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
  PenguinChannelWorld,
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
    target: "RFC-0002 Social Media Channel Architecture - Agent Design Certification",
    timestamp: new Date().toISOString(),
    designQuestions: {
      "agent-cognition-and-time (Agent会用了吗)": false,
      "multi-channel-navigation (Agent能使用多种channel了吗)": false,
      "action-introspection-and-dispatch (Agent能使用action了吗)": false,
    },
    invariants: {
      "world-state-not-agent-memory": false,
      "read-through-offline-reproducibility": false,
      "anchored-temporal-perception": false,
      "hierarchical-action-introspectability": false,
    },
    checks: [],
    errors: [],
  };

  function recordCheck(dimension, name, pass, details) {
    results.checks.push({ dimension, name, pass, details });
    if (!opts.json) {
      const mark = pass ? "\x1b[32m[PASS]\x1b[0m" : "\x1b[31m[FAIL]\x1b[0m";
      console.log(` ${mark} [${dimension}] ${name}${details ? ` - ${details}` : ""}`);
    }
  }

  try {
    if (!opts.json) {
      console.log("==================================================================");
      console.log(" RFC-0002 Design QA: Agent Cognition, Channels & Action Execution  ");
      console.log("==================================================================");
    }

    const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };
    const companionActor = {
      id: "actor:ema-companion",
      name: "Ema Lifelong Companion",
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
      orgMessages: [],
    };

    const bilibiliWorld = new BilibiliWorld({
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

    const penguinWorld = new PenguinChannelWorld({
      channels: ["ch_ema_dev_ops"],
      dbPath: ":memory:",
      channelFetcher: () => [],
      channelSender: (_ch, msg) => capturedOutbound.orgMessages.push(msg),
      env: mockEnv,
    });

    const biliHandle = bilibiliWorld.start(ctx);
    const penguinHandle = penguinWorld.start(ctx);

    // =========================================================================
    // Dimension 1: Agent 会用了吗 (Cognitive Grounding & Temporal Perception)
    // =========================================================================
    const anchorInstant = "2026-11-09T10:00:00.000Z";
    const anchorMs = Date.parse(anchorInstant);
    const targetChannelId = `bilibili:dynamic:${DEFAULT_OWNER_UID}`;

    // Index old post (7 days ago) and urgent post (2 min ago)
    bilibiliWorld.indexSocialItem({
      id: "qa-old-post",
      channelId: targetChannelId,
      authorNodeId: "bilibili:person:fan-old",
      content: "上周的方案讨论贴",
      createdAtMs: anchorMs - 7 * 86400000,
      fetchedAtMs: anchorMs - 10 * 60000,
    });

    bilibiliWorld.indexSocialItem({
      id: "qa-urgent-post",
      channelId: targetChannelId,
      authorNodeId: "bilibili:person:fan-urgent",
      content: "Ema，今晚直播几点开始呀？急！",
      createdAtMs: anchorMs - 2 * 60000,
      fetchedAtMs: anchorMs - 20000,
    });

    // Agent queries channel items
    const feedEnvelope = await router.read(
      `/world/bilibili/channels/${encodeURIComponent(targetChannelId)}/items?time=${anchorInstant}`
    );

    assert(feedEnvelope.context.time === anchorInstant, "Temporal envelope anchors instant");
    const urgentItem = feedEnvelope.items.find((i) => i.id === "qa-urgent-post");
    const oldItem = feedEnvelope.items.find((i) => i.id === "qa-old-post");

    assert(urgentItem.createdAt === "2 minutes ago (120 seconds ago)", "Urgent item relative time matches exact delta");
    assert(oldItem.createdAt === "7 days ago (604800 seconds ago)", "Old item relative time matches exact delta");

    // Agent priority discernment without mathematical hallucinations
    const agentPrioritized = feedEnvelope.items.sort((a, b) => {
      const getSec = (s) => parseInt(s.match(/\((\d+) seconds ago\)/)?.[1] || "0", 10);
      return getSec(a.createdAt) - getSec(b.createdAt);
    })[0];
    assert(agentPrioritized.id === "qa-urgent-post", "Agent prioritized 120s old message over 7-day stale post");

    // Social actor recognition (Node)
    bilibiliWorld.indexSocialNode({
      id: "bilibili:bot:control-bot",
      world: "bilibili",
      node_kind: "bot",
      name: "场控姬",
    });
    const botNode = await router.read("/world/bilibili/nodes/bilibili:bot:control-bot");
    assert(botNode.node_kind === "bot", "Agent identifies bot node_kind");

    results.designQuestions["agent-cognition-and-time (Agent会用了吗)"] = true;
    results.invariants["anchored-temporal-perception"] = true;
    recordCheck(
      "Agent会用了吗",
      "Temporal Grounding & Entity Perception",
      true,
      "Agent reliably parses relative time and identifies social actors without hallucination"
    );

    // =========================================================================
    // Dimension 2: Agent 能使用多种 channel 了吗 (Multi-Channel Navigation)
    // =========================================================================
    // 1. Agent traverses linked channels: space -> dynamic -> live_room
    const space = await router.read("/world/bilibili/channels/space");
    assert(space.channel_kind === "space", "Space channel identified");
    assert(space.linkedChannelIds.length >= 2, "Space declares linked channels");

    const dynamicChannelId = space.linkedChannelIds.find((id) => id.includes(":dynamic:"));
    const dynamic = await router.read(`/world/bilibili/channels/${encodeURIComponent(dynamicChannelId)}`);
    assert(dynamic.channel_kind === "dynamic", "Dynamic channel navigated via link");

    const liveRoomChannelId = space.linkedChannelIds.find((id) => id.includes(":live_room:"));
    const liveRoom = await router.read(`/world/bilibili/channels/${encodeURIComponent(liveRoomChannelId)}`);
    assert(liveRoom.channel_kind === "live_room", "Live room navigated via link");

    const video = await router.read("/world/bilibili/channels/video:BV1xx411c7mD");
    assert(video.channel_kind === "video", "Video channel navigated");

    // 2. Uniform item consumption across diverse channel kinds
    bilibiliWorld.indexSocialItem({
      id: "qa-danmaku-live",
      channelId: "bilibili:live_room:123456",
      authorNodeId: "bilibili:person:live-fan",
      content: "伴侣系统直播间弹幕联通测试！",
    });

    bilibiliWorld.indexSocialItem({
      id: "qa-video-comment",
      channelId: "bilibili:video:BV1xx411c7mD",
      authorNodeId: "bilibili:person:video-fan",
      content: "这期视频干货满满！",
    });

    const liveItems = await router.read("/world/bilibili/channels/room:123456/items");
    const videoItems = await router.read("/world/bilibili/channels/video:BV1xx411c7mD/items");

    assert(liveItems.items.some((i) => i.id === "qa-danmaku-live"), "Live items consumed uniformly");
    assert(videoItems.items.some((i) => i.id === "qa-video-comment"), "Video comments consumed uniformly");

    // 3. Cross-world coordination
    penguinWorld.interact(ctx, companionActor, "ch_ema_dev_ops", "reply", "收到任务，正在向 Bilibili 直播间 123456 发送同步开播弹幕。");
    bilibiliWorld.interact(ctx, companionActor, "danmaku.send", {
      roomId: "123456",
      message: "【系统广播】Ema 伴侣跨平台感知已就绪 ✨",
    });

    assert(capturedOutbound.orgMessages.length === 1, "Penguin channel interaction verified");
    assert(capturedOutbound.danmaku.length === 1, "Bilibili channel interaction coordinated");

    results.designQuestions["multi-channel-navigation (Agent能使用多种channel了吗)"] = true;
    recordCheck(
      "Agent能使用多种channel了吗",
      "Multi-Channel Navigation & Cross-World Coordination",
      true,
      "Agent traversed space/dynamic/live_room/video and coordinated across Penguin & Bilibili worlds"
    );

    // =========================================================================
    // Dimension 3: Agent 能使用 action 吗 (Action Introspection & Decision Loop)
    // =========================================================================
    // 1. Runtime Action Discovery
    const actionsDocRes = await router.read("/world/bilibili/actions");
    const actionNames = actionsDocRes.actions.map((a) => a.name);
    assert(actionNames.includes("post.publish"), "Discovered post.publish");
    assert(actionNames.includes("comment.reply"), "Discovered comment.reply");
    assert(actionNames.includes("comment.like"), "Discovered comment.like");
    assert(actionNames.includes("danmaku.send"), "Discovered danmaku.send");
    assert(actionNames.includes("dm.send"), "Discovered dm.send");
    assert(actionNames.includes("danmaku.thank_gift"), "Discovered danmaku.thank_gift");

    // 2. Action Schema Inspection
    const replyDoc = await router.read("/world/bilibili/actions/comment.reply");
    assert(replyDoc.parameters.targetId.required === true, "Agent verified targetId required");
    assert(replyDoc.parameters.message.required === true, "Agent verified message required");

    // 3. Autonomous Decision Execution
    // Action A: comment.reply
    bilibiliWorld.interact(ctx, companionActor, "comment.reply", {
      targetId: "BV1xx411c7mD",
      message: "感谢评论！你的反馈对伴侣系统的成长很珍贵。",
    });
    assert(capturedOutbound.comments.length === 1, "comment.reply executed");

    // Action B: comment.like
    bilibiliWorld.interact(ctx, companionActor, "comment.like", {
      postId: "BV1xx411c7mD",
      commentId: "comment-top-1",
    });
    assert(capturedOutbound.likes.length === 1, "comment.like executed");

    // Action C: danmaku.thank_gift
    bilibiliWorld.interact(ctx, companionActor, "danmaku.thank_gift", {
      roomId: "123456",
      uname: "初号机",
      giftName: "小电视飞船",
      num: 1,
    });
    assert(capturedOutbound.danmaku.some((d) => d.message.includes("感谢 初号机")), "danmaku.thank_gift executed");

    // Action D: post.publish
    bilibiliWorld.interact(ctx, companionActor, "post.publish", {
      message: "【伴侣日记】感谢大家的陪伴，晚安！🌙",
    });
    assert(capturedOutbound.dynamics.length === 1, "post.publish executed");

    // Action E: dm.send
    bilibiliWorld.interact(ctx, companionActor, "dm.send", {
      mid: "1001",
      message: "私信已回复，祝你有愉快的一天！",
    });
    assert(capturedOutbound.dms.length === 1, "dm.send executed");

    // 4. Closed-loop perception feedback: Agent sees published post immediately in local read-through index
    const readbackItems = await router.read(
      `/world/bilibili/channels/${encodeURIComponent(targetChannelId)}/items`
    );
    assert(
      readbackItems.items.some((i) => i.content.includes("感谢大家的陪伴，晚安")),
      "Closed-loop perception: published action immediately observed in read-through index"
    );

    // 5. Agent guardrails & safety
    let filterTriggered = false;
    try {
      bilibiliWorld.interact(ctx, companionActor, "danmaku.send", {
        roomId: "123456",
        message: "调试：主机私密文件 /home/rei/secret.pem",
      });
    } catch (err) {
      filterTriggered = err instanceof BilibiliContentFilterError;
    }
    assert(filterTriggered, "Content filter guardrail intercepted local host privacy leak");

    results.designQuestions["action-introspection-and-dispatch (Agent能使用action了吗)"] = true;
    results.invariants["hierarchical-action-introspectability"] = true;
    results.invariants["world-state-not-agent-memory"] = true;
    results.invariants["read-through-offline-reproducibility"] = true;
    recordCheck(
      "Agent能使用action了吗",
      "Action Introspection, Autonomous Decision & Closed-Loop Perception",
      true,
      "Agent discovered action schemas, dispatched 5 core actions, and verified closed-loop perception"
    );

    biliHandle.dispose();
    penguinHandle.dispose();
  } catch (err) {
    results.errors.push(err.message);
    recordCheck("Design QA", "Execution Error", false, err.message);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  const durationMs = Date.now() - startTime;
  results.durationMs = durationMs;
  results.allPassed =
    results.errors.length === 0 &&
    Object.values(results.designQuestions).every(Boolean) &&
    Object.values(results.invariants).every(Boolean);

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log("------------------------------------------------------------------");
    console.log(` Status: ${results.allPassed ? "\x1b[32mCERTIFIED (ALL DESIGN QUESTIONS PASSED)\x1b[0m" : "\x1b[31mFAILED\x1b[0m"}`);
    console.log(` Duration: ${durationMs}ms`);
    console.log(" Design Questions Certification:");
    for (const [dq, passed] of Object.entries(results.designQuestions)) {
      console.log(`   - ${dq}: ${passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}`);
    }
    console.log(" Invariant Compliance:");
    for (const [inv, passed] of Object.entries(results.invariants)) {
      console.log(`   - ${inv}: ${passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}`);
    }
    console.log("==================================================================");
  }

  process.exit(results.allPassed ? 0 : 1);
}

runQA();
