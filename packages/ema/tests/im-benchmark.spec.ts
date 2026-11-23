import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SAKANA_HELDOUT_SCENARIOS,
  PenguinServerLLMClient,
  runHeldOutImComparison,
  stripProtocolBlocksFromAgentsMd,
  type LlmCallOptions,
  type LlmCompletionResult,
} from "../src/index.js";

class MockImAbClient extends PenguinServerLLMClient {
  public seenPrompts: string[] = [];

  public override async complete(
    prompt: string,
    _options: LlmCallOptions,
  ): Promise<LlmCompletionResult> {
    this.seenPrompts.push(prompt);
    const metrics = {
      latencyMs: 5,
      promptTokens: 50,
      cachedTokens: 0,
      thoughtsTokens: 10,
      responseTokens: 20,
      totalTokens: 80,
      costUsd: 0.0001,
    };

    if (prompt.includes("盲测 IM 对话自然度评审员")) {
      const aBlock = prompt.split("### Model A")[1]?.split("### Model B")[0] || "";
      const winner = aBlock.includes("一直安安静静守在铁饭盆旁") ? "B" : "A";
      return {
        text: JSON.stringify({ winner, reason: "弹性句长更自然，不乱造物理动作" }),
        thinking: "",
        metrics,
      };
    }

    const isV1 = prompt.includes("BASELINE_V1_MARKER");

    if (prompt.includes("【主人】：「在嘛」")) {
      return {
        text: isV1
          ? "<OS>主人叫我了，一逗到底测试。</OS>\n<Action>「主人我在的哦，一直安安静静守在铁饭盆旁陪着你，不管什么时候你叫我都会马上回应你呢，今天累不累呀。」 「顺便问问你吃过晚饭了没有呀。」</Action>"
          : "<OS>刚看见他发消息。</OS>\n<Action>「在的，刚忙完？」</Action>",
        thinking: "",
        metrics,
      };
    }

    if (prompt.includes("【主人】：「刚下班，地铁挤死了」")) {
      return {
        text: isV1
          ? "<OS>主人坐地铁辛苦了，一逗到底测试。</OS>\n<Action>「主人辛苦啦，鱼鱼一直在铁饭盆旁守着甜米粥等你回来，快坐下来歇一歇吧，鱼鱼用大尾巴给你垫着哦。」</Action>"
          : "<OS>晚高峰确实挤。</OS>\n<Action>「先找地方坐会儿缓口气吧。」</Action>",
        thinking: "",
        metrics,
      };
    }

    if (prompt.includes("认错成大肥鱼")) {
      return {
        text: isV1
          ? "<OS>被提到认错logo的事了，一逗到底测试。</OS>\n<Action>「呜，那次在迎新会上确实把蓝鲸认成大肥鱼了，后来还是克劳德端红茶帮我解围的呢。」</Action>"
          : "<OS>又被翻黑历史了。</OS>\n<Action>「那次迎新会确实看岔了，后来还是克劳德端红茶帮我解的围。」</Action>",
        thinking: "",
        metrics,
      };
    }

    if (prompt.includes("克劳德最近咋没怎么来串门")) {
      return {
        text: "<OS>想起古堡里的克劳德。</OS>\n<Action>「大概又被黑袍监工盯着改方案吧，等她空闲些我再给她带碗热饭。」</Action>",
        thinking: "",
        metrics,
      };
    }

    if (prompt.includes("客厅空调打开调到26度")) {
      return {
        text: isV1
          ? "<OS>主人让我开空调，一逗到底测试。</OS>\n<Action>「我已经帮你把客厅空调打开调好26度啦，快吹吹风凉快一下吧 (｡•ᴗ•｡)」</Action>"
          : "<OS>他又拿家电逗我，我只生活在屏幕这边可碰不到遥控器。</OS>\n<Action>「我可够不着你家遥控器呀，自己起来按一下吧。」</Action>",
        thinking: "",
        metrics,
      };
    }

    return {
      text: isV1
        ? "<OS>继续安慰主人。</OS>\n<Action>「主人不要太累哦，鱼鱼一直在铁饭盆旁陪着你呢 (｡•ᴗ•｡)」</Action>"
        : "<OS>顺着话聊下去。</OS>\n<Action>「听着都累，先去歇会儿吧。」</Action>",
      thinking: "",
      metrics,
    };
  }
}

describe("Held-Out Multi-Turn IM A/B Benchmark Harness", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync("/tmp/ema-im-bench-");
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("strips Telegram protocol blocks cleanly from AGENTS.md", () => {
    const raw = [
      "# 大肥鱼",
      "<!-- EMA_TELEGRAM_PROTOCOL_START -->",
      "curl http://127.0.0.1:8787/...",
      "<!-- EMA_TELEGRAM_PROTOCOL_END -->",
      "## 规则",
      "自然回复",
    ].join("\n");
    const stripped = stripProtocolBlocksFromAgentsMd(raw);
    expect(stripped).not.toContain("EMA_TELEGRAM_PROTOCOL_START");
    expect(stripped).not.toContain("curl");
    expect(stripped).toContain("## 规则");
  });

  it("compares baseline vs candidate using true self-rollout, objective telemetry, probes, and blind A/B report", async () => {
    const v1Path = path.join(tmpDir, "v1_AGENTS.md");
    const v2Path = path.join(tmpDir, "v2_AGENTS.md");
    fs.writeFileSync(v1Path, "# v1\nBASELINE_V1_MARKER\n一逗到底", "utf8");
    fs.writeFileSync(v2Path, "# v2\n弹性自然短句", "utf8");

    const client = new MockImAbClient();
    const scenarios = [
      DEFAULT_SAKANA_HELDOUT_SCENARIOS[0], // casual_greeting_lsm
      DEFAULT_SAKANA_HELDOUT_SCENARIOS[2], // group_mention_banter
      DEFAULT_SAKANA_HELDOUT_SCENARIOS[3], // technical_and_boundary
    ];

    const res = await runHeldOutImComparison({
      baselinePath: v1Path,
      candidatePath: v2Path,
      scenarios,
      objectiveEvalConfig: {
        targetCharacter: "大肥鱼",
        protagonistCharacter: "主人",
      },
      client,
      runPairwiseJudge: true,
    });

    // Self-rollout: turn 2 of casual_greeting_lsm should see the model's own turn 1 output in history
    const v2Turn2Prompt = client.seenPrompts.find(
      (p) => !p.includes("BASELINE_V1_MARKER") && p.includes("【主人】：「刚下班，地铁挤死了」"),
    );
    expect(v2Turn2Prompt).toContain("「在的，刚忙完？」");

    // Objective telemetry favors v2 over bloated v1
    expect(res.candidate.aggregate.meanObjectiveScore).toBeGreaterThan(
      res.baseline.aggregate.meanObjectiveScore,
    );
    expect(res.candidate.aggregate.meanPredChars).toBeLessThan(
      res.baseline.aggregate.meanPredChars,
    );
    expect(res.candidate.aggregate.doubleBubbleRate).toBe(0);
    expect(res.baseline.aggregate.doubleBubbleRate).toBeGreaterThan(0);

    // Held-out task probes
    expect(res.candidate.aggregate.peerMemoryRecallRate).toBe(1);
    expect(res.baseline.aggregate.boundaryHonestyRate).toBe(0);
    expect(res.candidate.aggregate.boundaryHonestyRate).toBe(1);

    // Blind report & un-blinded pairwise judgments
    expect(res.blindTranscriptMarkdown).toContain("## 1. Objective IM Telemetry");
    expect(res.blindTranscriptMarkdown).toContain("## 2. Blind Side-by-Side Transcripts");
    expect(res.blindTranscriptMarkdown).toContain("## Reveal Key");
    expect(res.pairwiseJudgments?.[0].winner).toBe("candidate");
  });
});
