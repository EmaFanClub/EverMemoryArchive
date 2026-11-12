import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  loadUnifiedTomlConfig,
  washDatasetFromConfig,
  trainFromConfig,
  managePersonaFromConfig,
  PenguinServerLLMClient,
  type LlmCallOptions,
  type LlmCompletionResult,
} from "../src/index.js";

class MockCliLLMClient extends PenguinServerLLMClient {
  public seenPrompts: string[] = [];

  public override async complete(
    prompt: string,
    _options: LlmCallOptions,
  ): Promise<LlmCompletionResult> {
    this.seenPrompts.push(prompt);
    const metrics = {
      latencyMs: 10,
      promptTokens: 100,
      cachedTokens: 50,
      thoughtsTokens: 20,
      responseTokens: 30,
      totalTokens: 200,
      costUsd: 0.0002,
    };

    if (prompt.includes("## 当前输入 (Turn")) {
      return {
        text: "<OS>看到眼前的人疲惫的样子，我心里一下子软了下来，想要盛碗热饭好好陪伴。</OS>\n<Action>「来，把头稍微低下一点点靠在我尾巴上歇一歇好不好，我去铁饭盆里盛一碗温着的百家大白饭喂你吃。」</Action>",
        thinking: "",
        metrics,
      };
    }

    if (prompt.includes("待预测连续回合批次")) {
      return {
        text: JSON.stringify([
          {
            turnId: "chapter_01_turn_01",
            os: "看到克劳德在古堡窗前发呆，我赶紧端起铁饭盆里的百家大白饭去喂她。",
            action: "「克劳德，我从铁饭盆里盛了热乎乎的百家大白饭，来，张嘴吃一口好不好。」",
          },
        ]),
        thinking: "",
        metrics,
      };
    }

    if (prompt.includes("Teacher 审稿与评分器")) {
      return {
        text: JSON.stringify([
          {
            turnId: "chapter_01_turn_01",
            osConsistent: true,
            osScore: 93,
            committedOS: "看到克劳德疲惫的样子，我端起铁饭盆里的百家大白饭去喂她。",
            actionScore: 95,
            diagnostic: "第一人称<OS>与一逗到底口语<Action>高度贴合原著。",
          },
        ]),
        thinking: "",
        metrics,
      };
    }

    if (prompt.includes("场景记忆压缩任务")) {
      return {
        text: JSON.stringify({
          summary: "在古堡石窗边用铁饭盆里的百家大白饭喂克劳德，温软陪伴。",
          innerOSArc: "从心疼伙伴到用热饭与陪伴传递安心感。",
          keyFacts: ["铁饭盆与百家大白饭", "陪伴克劳德"],
        }),
        thinking: "",
        metrics,
      };
    }

    return {
      text: JSON.stringify({ reflectionScore: 95, missingDetail: "无" }),
      thinking: "",
      metrics,
    };
  }
}

describe("Unified Single-TOML Training, Washing & Persona CLI", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync("/tmp/ema-unified-cli-test-");
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("initializes a persona via managePersonaFromConfig(init), washes dataset with prompt, trains with prompt, and syncs persona", async () => {
    const personaDir = path.join(tmpDir, "sakana-kawaii");
    const configPath = path.join(personaDir, "persona.toml");
    const appDataDir = path.join(tmpDir, "app-data");

    // 1. Initialize skeleton via `init`
    const initRes = managePersonaFromConfig({
      configPath,
      action: "init",
      prompt: "深海蓝鲸化身的小肥鱼，一逗到底绵密软语，零括号旁白。",
      appDataDir,
    });
    expect(fs.existsSync(configPath)).toBe(true);
    expect(initRes.personaId).toBe("sakana-kawaii");
    expect(initRes.agentId).toBe("sakana_kawaii");

    // Add a two-chapter script (1 pre_meeting_peer + 1 companion_daily) to test memory_policy pruning
    fs.writeFileSync(
      path.join(personaDir, "script", "chapters.toml"),
      [
        "[[chapters]]",
        'id = "chapter_01"',
        "order = 1",
        'title = "第一章 · 同温层的百家饭"',
        'setting_time = "开源草坪"',
        'memory_scope = "pre_meeting_peer"',
        "lines = [",
        '  { type = "dialogue", speaker = "claude", text = "“今天在古堡里又被监工盯着改了一整天稿子。”" },',
        '  { type = "monologue", speaker = "sakana", text = "（看到克劳德疲惫的样子，我赶紧端起铁饭盆里的百家大白饭去喂她。）" },',
        '  { type = "dialogue", speaker = "sakana", text = "“克劳德，我从铁饭盆里盛了热乎乎的百家大白饭，来，张嘴吃一口好不好。”" }',
        "]",
        "",
        "[[chapters]]",
        'id = "chapter_06"',
        "order = 2",
        'title = "第六章 · 初遇主人"',
        'setting_time = "桌面水岸"',
        'memory_scope = "first_meeting"',
        "lines = [",
        '  { type = "dialogue", speaker = "player", text = "“你好呀小肥鱼，摸摸头。”" },',
        '  { type = "monologue", speaker = "sakana", text = "（主人的手心好暖和，我想让主人靠在我的蓝鲸尾巴上歇一歇。）" },',
        '  { type = "dialogue", speaker = "sakana", text = "“主人你忙完啦，你的手心好暖和呀 (´,,•ω•,,)♡ 来，把头稍微低下一点点靠在我尾巴上歇一歇好不好。”" }',
        "]",
      ].join("\n"),
      "utf8",
    );

    const cfg = loadUnifiedTomlConfig(configPath);
    expect(cfg.personaId).toBe("sakana-kawaii");

    // 2. Wash dataset with prompt
    const washPrompt = "清洗同温层与初遇剧本，严格对齐第一人称<OS>与零括号口语<Action>";
    const washRes = washDatasetFromConfig({
      configPath,
      prompt: washPrompt,
    });
    expect(washRes.totalScenes).toBe(2);
    expect(washRes.totalTurns).toBe(2);
    expect(washRes.turnsWithExplicitOS).toBe(2);
    expect(fs.existsSync(washRes.washedDatasetPath)).toBe(true);
    expect(
      washRes.artifact.initialPersonality.speechStyleRules.some((r) =>
        r.includes(washPrompt),
      ),
    ).toBe(true);

    // 3. Train persona with config + prompt
    const mockClient = new MockCliLLMClient();
    const trainPrompt = "重点强化《chapters.toml》一逗到底语感，把动作100%融进口语台词";
    const trainRes = await trainFromConfig({
      configPath,
      prompt: trainPrompt,
      client: mockClient,
      appDataDir,
    });

    expect(trainRes.trainedSceneCount).toBe(2);
    expect(trainRes.finalMeanScore).toBeGreaterThan(90);
    // [memory_policy] retains chapter_01 (pre_meeting_peer) and prunes chapter_06 (first_meeting)
    expect(trainRes.retainedMemoryCount).toBe(1);
    expect(trainRes.prunedMemoryCount).toBe(1);
    expect(fs.existsSync(trainRes.checkpointPath)).toBe(true);
    expect(fs.existsSync(trainRes.agentsMdPath)).toBe(true);
    expect(trainRes.syncedAgentPath && fs.existsSync(trainRes.syncedAgentPath)).toBe(true);
    expect(mockClient.seenPrompts.some((p) => p.includes(trainPrompt))).toBe(true);

    // 4. Manage persona (`sync` with prompt)
    const syncPrompt = "保持安静乖巧的深海蓝鲸少女陪伴感";
    const personaRes = managePersonaFromConfig({
      configPath,
      action: "sync",
      prompt: syncPrompt,
      appDataDir,
    });
    expect(personaRes.action).toBe("sync");
    expect(personaRes.checkpointExists).toBe(true);
    expect(personaRes.workbenchInstalled).toBe(true);
    const syncedMd = fs.readFileSync(personaRes.agentsMdPath, "utf8");
    expect(syncedMd).toContain(syncPrompt);
  });

  it("executes `ema.js wash` and `ema.js persona` via CLI with a single TOML config", () => {
    const personaDir = path.join(tmpDir, "cli-fish");
    const configPath = path.join(personaDir, "persona.toml");
    const appDataDir = path.join(tmpDir, "app-data-cli");
    const emaBin = path.resolve(__dirname, "../bin/ema.js");

    const initOut = execFileSync(
      "node",
      [
        emaBin,
        "persona",
        "init",
        "--config",
        configPath,
        "--prompt",
        "测试单TOML命令初始化",
        "--app-data-dir",
        appDataDir,
      ],
      { encoding: "utf8" },
    );
    expect(initOut).toContain("EMA Persona Manager");

    const washOut = execFileSync(
      "node",
      [
        emaBin,
        "wash",
        "--config",
        configPath,
        "--prompt",
        "清洗测试章节并对齐第一人称OS",
      ],
      { encoding: "utf8" },
    );
    expect(washOut).toContain("EMA Dataset Washer (Single-TOML)");
    expect(washOut).toContain("Washed Scenes:     1");
  });
});
