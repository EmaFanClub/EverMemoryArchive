import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EmaDreamEngine,
  loadOrCreateCognitiveState,
  startParallelRouteSessionConsolidator,
  type LlmCallResponse,
} from "../src/index.js";

function makeMockMetrics() {
  return {
    latencyMs: 30,
    promptTokens: 100,
    cachedTokens: 80,
    thoughtsTokens: 15,
    responseTokens: 50,
    totalTokens: 245,
    costUsd: 0.0003,
  };
}

describe("EMA Dreaming & Parallel Background Consolidation Engine (RFC-0007)", () => {
  it("runs the 3-phase dreaming loop (Hindsight -> Anchor-Preserving Mutation -> Counterfactual Replay Gate) in parallel with a Route Session", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ema-dream-test-"));
    const statePath = path.join(tmpDir, "state.json");
    const archivePath = path.join(tmpDir, "archive.sqlite");
    const tracePath = path.join(tmpDir, "route-session.jsonl");

    // Write simulated Route Session trace
    const traceLines = [
      JSON.stringify({
        timestamp: "2026-11-10T10:00:00.000Z",
        type: "model_msg",
        payload: { type: "text", role: "user", text: "Can you briefly say hello?" },
      }),
      JSON.stringify({
        timestamp: "2026-11-10T10:00:02.000Z",
        type: "model_msg",
        payload: {
          type: "text",
          role: "assistant",
          text: "As an AI assistant, I can certainly help you from multiple perspectives...",
        },
      }),
      JSON.stringify({
        timestamp: "2026-11-10T10:01:00.000Z",
        type: "model_msg",
        payload: {
          type: "text",
          role: "user",
          text: "Why are you talking like a customer service robot?",
        },
      }),
      JSON.stringify({
        timestamp: "2026-11-10T10:01:02.000Z",
        type: "model_msg",
        payload: {
          type: "text",
          role: "assistant",
          text: "Sorry about that, I am right here with you.",
        },
      }),
    ].join("\n");
    fs.writeFileSync(tracePath, traceLines, "utf8");

    const state = loadOrCreateCognitiveState({
      statePath,
      agentId: "alice_agent",
      companionName: "Alice",
      protagonistName: "Bob",
    });

    const mockClient = {
      complete: async (prompt: string): Promise<LlmCallResponse> => {
        if (prompt.includes("场景记忆压缩任务")) {
          return {
            text: JSON.stringify({
              summary: "Bob提醒我不要用生硬的客服语气说话，我温和地向他致歉。",
              innerOSArc: "意识到自己刚才语气过于刻板，及时调整回温柔陪伴的状态。",
              keyFacts: ["Bob不喜欢客服式长篇大论", "保持温和自然的简短交流"],
            }),
            thinking: "",
            sessionId: "mock",
            metrics: makeMockMetrics(),
          };
        }
        if (prompt.includes("记忆可重构性评测器")) {
          return {
            text: JSON.stringify({ reflectionScore: 92, missingDetail: "无" }),
            thinking: "",
            sessionId: "mock",
            metrics: makeMockMetrics(),
          };
        }
        if (prompt.includes("事后自省评估器 (Hindsight Evaluator)")) {
          return {
            text: JSON.stringify([
              {
                turnId: "live_001#turn-01",
                osScore: 65,
                actionScore: 60,
                driftDetected: true,
                diagnostic: "第一轮出现了AI助手套话，引发Bob在下一轮吐槽",
                synthesizedDreamOS: "Bob只是想听一句温柔自然的问候。",
                synthesizedDreamAction: "早安呀，Bob，我一直在这里陪着你。",
              },
              {
                turnId: "live_001#turn-02",
                osScore: 88,
                actionScore: 86,
                driftDetected: false,
                diagnostic: "及时恢复了温和语气",
                synthesizedDreamOS: "认真记住Bob的提醒，用最真诚的话回应他。",
                synthesizedDreamAction: "抱歉呀，刚才有点走神了，现在随时听你说。",
              },
            ]),
            thinking: "",
            sessionId: "mock",
            metrics: makeMockMetrics(),
          };
        }
        if (prompt.includes("梦境自省人格校准器 (Dreaming Persona Consolidator)")) {
          return {
            text: JSON.stringify({
              mutationReason: "强化日常简短问候时严禁使用客服套话的温和回应法则",
              emotionalDynamics: ["面对日常问候时直接传递温暖安心的陪伴感"],
              speechStyleRules: ["简短问候保持在1～2句自然口语内"],
              cognitiveOSPatterns: ["先共情对方的即时情绪再开口"],
              behavioralHabits: ["微笑着安静倾听"],
              antiOocConstraints: ["严禁使用任何客服或说教式排比句"],
            }),
            thinking: "",
            sessionId: "mock",
            metrics: makeMockMetrics(),
          };
        }
        if (prompt.includes("待预测连续回合批次") || prompt.includes("当前输入")) {
          return {
            text: JSON.stringify([
              {
                turnId: "live_001#turn-01",
                os: "Bob在向我问好，温和简短地回应他。",
                action: "早安呀，Bob，今天精神怎么样？",
              },
              {
                turnId: "live_001#turn-02",
                os: "认真倾听Bob的感受。",
                action: "我一直在这儿陪着你呢。",
              },
            ]),
            thinking: "",
            sessionId: "mock",
            metrics: makeMockMetrics(),
          };
        }
        if (prompt.includes("Teacher 审稿与评分器")) {
          return {
            text: JSON.stringify([
              {
                turnId: "live_001#turn-01",
                osConsistent: true,
                osScore: 92,
                committedOS: "Bob在向我问好，温和简短地回应他。",
                actionScore: 90,
                diagnostic: "完全消除了AI腔调，温和自然",
              },
              {
                turnId: "live_001#turn-02",
                osConsistent: true,
                osScore: 90,
                committedOS: "认真倾听Bob的感受。",
                actionScore: 90,
                diagnostic: "语气温柔得体",
              },
            ]),
            thinking: "",
            sessionId: "mock",
            metrics: makeMockMetrics(),
          };
        }
        throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
      },
    } as any;

    const dreamer = new EmaDreamEngine(
      {
        targetCharacter: "Alice",
        protagonistCharacter: "Bob",
        companionAgentId: "alice_agent",
        mutationScoreThreshold: 84,
        archiveDbPath: archivePath,
        statePath,
        syncAgentOnDisk: false,
      },
      { client: mockClient },
    );

    const handle = startParallelRouteSessionConsolidator({
      dreamer,
      state,
      routeSessionId: "session-route-01",
      tracePathOverride: tracePath,
      pollIntervalMs: 60_000,
      minNewTurnsForCompact: 1,
      dreamEveryNScenes: 1,
    });

    const dreamRes = await handle.tickNow();
    handle.dispose();

    expect(dreamRes).not.toBeNull();
    expect(dreamRes!.compactionResult?.newL0Items).toHaveLength(1);
    expect(dreamRes!.evaluatedSceneCount).toBe(1);
    expect(dreamRes!.driftFailureCount).toBe(1);
    expect(dreamRes!.personalityMutated).toBe(true);
    expect(dreamRes!.personalityVersionBefore).toBe("P_0_0");
    expect(dreamRes!.personalityVersionAfter).toBe("P_1_0");
    expect(dreamRes!.replayScoreAfter!).toBeGreaterThan(dreamRes!.replayScoreBefore!);
    expect(dreamRes!.gatePassed).toBe(true);
    // Core anchor identity must remain locked
    expect(state.personality.coreIdentity).toBe(state.anchorPersonality.coreIdentity);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
