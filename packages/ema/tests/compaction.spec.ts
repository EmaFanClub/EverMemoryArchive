import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EmaMemoryCompactor,
  extractPreservedProtocolBlocks,
  loadOrCreateCognitiveState,
  parseSessionTraceTurns,
  readColdArchiveRecords,
  renderCompanionAgentsMd,
  sliceTurnsIntoEpisodicWindows,
  type LlmCallResponse,
} from "../src/index.js";

function makeMockMetrics() {
  return {
    latencyMs: 25,
    promptTokens: 80,
    cachedTokens: 60,
    thoughtsTokens: 10,
    responseTokens: 40,
    totalTokens: 190,
    costUsd: 0.0002,
  };
}

describe("EMA Memory Compaction Engine (RFC-0006)", () => {
  it("parses Penguin session trace JSONL into committed turns while ignoring in-flight user turns", () => {
    const traceLines = [
      JSON.stringify({
        timestamp: "2026-11-10T10:00:00.000Z",
        type: "model_msg",
        payload: { type: "text", role: "user", text: "Hello Alice, what are you reading?" },
      }),
      JSON.stringify({
        timestamp: "2026-11-10T10:00:01.000Z",
        type: "model_msg",
        payload: {
          type: "thinking",
          role: "assistant",
          thinking: "**Reading Thoughts**\n\nSharing my thoughts on Hermann Hesse's essays.",
        },
      }),
      JSON.stringify({
        timestamp: "2026-11-10T10:00:03.000Z",
        type: "model_msg",
        payload: {
          type: "text",
          role: "assistant",
          text: "I was reading an essay about trees by Hesse.",
        },
      }),
      // QQ group wrapped turn
      JSON.stringify({
        timestamp: "2026-11-10T10:05:00.000Z",
        type: "model_msg",
        payload: {
          type: "text",
          role: "user",
          text: '[来自 QQ 群 "Club" (12345) 中 @你的消息]:\n发送人: Bob (QQ: 999)\n消息内容: @Alice Are you there?\n\n请以伴侣身份简明、自然地直接回复群友：',
        },
      }),
      JSON.stringify({
        timestamp: "2026-11-10T10:05:02.000Z",
        type: "model_msg",
        payload: {
          type: "text",
          role: "assistant",
          text: "<OS>Bob is calling me in the group chat.</OS><Action>I am here, Bob!</Action>",
        },
      }),
      // Trailing in-flight user turn without assistant reply yet (must be ignored for concurrency safety)
      JSON.stringify({
        timestamp: "2026-11-10T10:06:00.000Z",
        type: "model_msg",
        payload: {
          type: "text",
          role: "user",
          text: "Wait, I am still typing...",
        },
      }),
    ].join("\n");

    const turns = parseSessionTraceTurns(traceLines, {
      sessionId: "session-abcd1234",
      defaultSender: "Bob",
    });

    expect(turns).toHaveLength(2);
    expect(turns[0].turnIndex).toBe(1);
    expect(turns[0].channel).toBe("direct");
    expect(turns[0].latentOS).toContain("Sharing my thoughts on Hermann Hesse");
    expect(turns[0].actionText).toBe("I was reading an essay about trees by Hesse.");

    expect(turns[1].turnIndex).toBe(2);
    expect(turns[1].channel).toBe("qq:group:12345");
    expect(turns[1].sender).toBe("Bob (QQ: 999)");
    expect(turns[1].latentOS).toBe("Bob is calling me in the group chat.");
    expect(turns[1].actionText).toBe("I am here, Bob!");
  });

  it("slices live turns into episodic windows on channel shift, idle gap, and turn watermarks", () => {
    const turns = [
      {
        turnIndex: 1,
        turnId: "t1",
        timestamp: "2026-11-10T10:00:00.000Z",
        sender: "Bob",
        channel: "direct",
        inputText: "Morning!",
        latentOS: "Happy to see Bob.",
        actionText: "Good morning!",
      },
      {
        turnIndex: 2,
        turnId: "t2",
        timestamp: "2026-11-10T10:01:00.000Z",
        sender: "Bob",
        channel: "qq:group:100",
        inputText: "Ping in group",
        latentOS: "Switched to group.",
        actionText: "Hello everyone!",
      },
      {
        turnIndex: 3,
        turnId: "t3",
        timestamp: "2026-11-10T12:00:00.000Z",
        sender: "Bob",
        channel: "qq:group:100",
        inputText: "After two hours",
        latentOS: "Long gap.",
        actionText: "Welcome back!",
      },
    ];

    const windows = sliceTurnsIntoEpisodicWindows(turns, 0, {
      idleGapMs: 30 * 60 * 1000,
      maxTurnsPerWindow: 5,
    });

    expect(windows).toHaveLength(3);
    expect(windows[0].boundaryReason).toBe("channel_shift");
    expect(windows[1].boundaryReason).toBe("idle_gap");
    expect(windows[2].boundaryReason).toBe("session_flush");
  });

  it("performs self-healing reflection retry, evolves compression prompt C, and rolls up L0 -> L1", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ema-compact-test-"));
    const statePath = path.join(tmpDir, "state.json");
    const archivePath = path.join(tmpDir, "archive.sqlite");

    const state = loadOrCreateCognitiveState({
      statePath,
      agentId: "alice_agent",
      companionName: "Alice",
      protagonistName: "Bob",
    });

    let compactCalls = 0;
    let reflectCalls = 0;

    const mockClient = {
      complete: async (prompt: string): Promise<LlmCallResponse> => {
        if (prompt.includes("场景记忆压缩任务")) {
          compactCalls++;
          const hasRecovery = prompt.includes("遗漏细节强制补全要求");
          return {
            text: JSON.stringify({
              summary: hasRecovery
                ? "我与Bob讨论了黑塞的《流浪者之歌》以及淡紫色小苍兰。"
                : "我与Bob聊了读书。",
              innerOSArc: "内心平静而温柔。",
              keyFacts: hasRecovery
                ? ["阅读黑塞《流浪者之歌》", "桌边插了淡紫色小苍兰"]
                : ["聊了读书"],
            }),
            thinking: "",
            sessionId: "mock",
            metrics: makeMockMetrics(),
          };
        }
        if (prompt.includes("记忆可重构性评测器")) {
          reflectCalls++;
          if (reflectCalls === 1) {
            return {
              text: JSON.stringify({
                reflectionScore: 68,
                missingDetail: "遗漏了书名《流浪者之歌》与淡紫色小苍兰",
              }),
              thinking: "",
              sessionId: "mock",
              metrics: makeMockMetrics(),
            };
          }
          return {
            text: JSON.stringify({
              reflectionScore: 95,
              missingDetail: "无",
            }),
            thinking: "",
            sessionId: "mock",
            metrics: makeMockMetrics(),
          };
        }
        if (prompt.includes("阶段记忆跨幕归并任务")) {
          return {
            text: JSON.stringify({
              title: "初遇与阅读时光",
              summary: "我与Bob在书房与群聊中分享了《流浪者之歌》与小苍兰的香气。",
              emotionalEvolutionArc: "从初识的礼貌逐渐建立起安静的默契。",
              consolidatedKeyFacts: ["阅读黑塞《流浪者之歌》", "桌边插了淡紫色小苍兰"],
            }),
            thinking: "",
            sessionId: "mock",
            metrics: makeMockMetrics(),
          };
        }
        throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
      },
    } as any;

    const compactor = new EmaMemoryCompactor(
      {
        targetCharacter: "Alice",
        protagonistCharacter: "Bob",
        enableReflectionCheck: true,
        reflectionThreshold: 80,
        enableCompressionPromptEvolution: true,
        l0RollupThreshold: 2,
        l0RollupBatchSize: 1,
        archiveDbPath: archivePath,
        statePath,
      },
      { client: mockClient },
    );

    const turns = [
      {
        turnIndex: 1,
        turnId: "t1",
        timestamp: "2026-11-10T10:00:00.000Z",
        sender: "Bob",
        channel: "direct",
        inputText: "今天读了什么书？",
        latentOS: "想把黑塞的书和小苍兰分享给Bob。",
        actionText: "读了黑塞的《流浪者之歌》，桌边的小苍兰也开了。",
      },
      {
        turnIndex: 2,
        turnId: "t2",
        timestamp: "2026-11-10T12:00:00.000Z",
        sender: "Bob",
        channel: "direct",
        inputText: "晚上好！",
        latentOS: "温和回应。",
        actionText: "晚上好呀，Bob。",
      },
    ];

    const res = await compactor.compactTurnStream(turns, state, {
      sessionKey: "s1",
      boundaryOptions: { idleGapMs: 30 * 60 * 1000 },
    });

    expect(res.newL0Items).toHaveLength(2);
    expect(res.retriedWithReflectionCount).toBe(1);
    expect(res.newL0Items[0].summary).toContain("流浪者之歌");
    expect(res.newL0Items[0].reflectionScore).toBe(95);
    expect(res.compressionMutatedTo?.version).toBe("C_0_1");
    expect(res.newL1Items).toHaveLength(1);
    expect(state.l1MemoryIndex[0].title).toBe("初遇与阅读时光");
    expect(state.sessionTurnCursors["s1"]).toBe(2);

    const coldRecords = readColdArchiveRecords(archivePath);
    expect(coldRecords).toHaveLength(2);

    // Preserved protocol block test
    const existingMd = `# Old\n<!-- EMA_QQ_CHANNEL_PROTOCOL_START -->\nQQ Protocol\n<!-- EMA_QQ_CHANNEL_PROTOCOL_END -->`;
    const blocks = extractPreservedProtocolBlocks(existingMd);
    expect(blocks).toHaveLength(1);
    const rendered = renderCompanionAgentsMd(state.personality, state.memoryIndex, {
      protagonistName: "Bob",
      l1MemoryIndex: state.l1MemoryIndex,
      preservedProtocolBlocks: blocks,
    });
    expect(rendered).toContain("Level-1 Epoch MemoryIndex");
    expect(rendered).toContain("EMA_QQ_CHANNEL_PROTOCOL_START");
    expect(compactCalls).toBeGreaterThanOrEqual(3);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
