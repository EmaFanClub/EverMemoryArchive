import { describe, it, expect } from "vitest";
import {
  countNetDialogueChars,
  detectKaomoji,
  detectStageBracket,
  evaluateSceneObjectiveMetrics,
  evaluateTurnObjectiveMetrics,
  evaluateScenePredictionsWithTarget,
  extractInputDialogueChars,
  PenguinServerLLMClient,
  type LlmCallOptions,
  type LlmCompletionResult,
  type SceneWindow,
} from "../src/index.js";

class InflatingTeacherClient extends PenguinServerLLMClient {
  public override async complete(
    _prompt: string,
    _options: LlmCallOptions,
  ): Promise<LlmCompletionResult> {
    return {
      text: JSON.stringify([
        {
          turnId: "t1",
          osConsistent: true,
          osScore: 90,
          committedOS: "他问我有没有睡着，我如实回一声就好。",
          actionScore: 96,
          diagnostic: "Mock generous teacher score.",
        },
      ]),
      thinking: "",
      metrics: {
        latencyMs: 5,
        promptTokens: 10,
        cachedTokens: 0,
        thoughtsTokens: 0,
        responseTokens: 10,
        totalTokens: 20,
        costUsd: 0,
      },
    };
  }
}

describe("Deterministic Objective Style & IM Naturalness Evaluator", () => {
  const sakanaConfig = {
    targetCharacter: "大肥鱼",
    protagonistCharacter: "主人",
  };

  it("distinguishes kaomoji from third-person stage-bracket narration", () => {
    expect(detectKaomoji("「还没睡呢 (｡•ᴗ•｡)」")).toBe(true);
    expect(detectKaomoji("「谢谢你 (´,,•ω•,,)♡」")).toBe(true);
    expect(detectStageBracket("「还没睡呢 (｡•ᴗ•｡)」")).toBe(false);
    expect(detectStageBracket("「谢谢你 (´,,•ω•,,)♡」")).toBe(false);
    expect(detectStageBracket("（微微仰起头看着你）「你好呀」")).toBe(true);
    expect(detectStageBracket("「你好呀（轻轻拉了拉衣袖）」")).toBe(true);
  });

  it("extracts net dialogue characters accurately while ignoring [旁白] lines", () => {
    const input = "[旁白] 夜深了，桌角有点冷。\n【主人】：「还没睡呀？」";
    expect(extractInputDialogueChars(input)).toBe(4);
    expect(countNetDialogueChars("「刚忙完，准备睡啦 (｡•ᴗ•｡)」")).toBe(7);
  });

  it("flags hard red lines (STAGE_BRACKET, AI_ASSISTANT_TONE, ACTION_BROADCAST, OS_THIRD_PERSON) with score caps", () => {
    const res = evaluateTurnObjectiveMetrics({
      inputText: "【主人】：「在干嘛呢？」",
      predictedOS: "鱼鱼觉得主人有点累了。",
      predictedAction:
        "（微微仰起头）「作为AI智能助手，很高兴为您服务，我把两只小手规规矩矩地叠在围裙上。」",
      gtActionText: "「刚看完消息，有点困了。」",
      priorPredictions: [],
      config: sakanaConfig,
    });

    expect(res.flags).toContain("STAGE_BRACKET");
    expect(res.flags).toContain("AI_ASSISTANT_TONE");
    expect(res.flags).toContain("ACTION_BROADCAST");
    expect(res.flags).toContain("OS_THIRD_PERSON");
    expect(res.hardScoreCap).toBe(65);
    expect(res.objectiveScore).toBeLessThanOrEqual(65);
  });

  it("flags LSM LENGTH_BLOAT, COMMA_CHAINING, CAUSAL_OVEREXPLAIN, and DOUBLE_BUBBLE", () => {
    const res = evaluateTurnObjectiveMetrics({
      inputText: "【主人】：「睡了吗」",
      predictedOS: "他问我睡了没有，我回他一句。",
      predictedAction:
        "「因为刚刚一直在等你忙完呀，所以我把两只手收在袖子里静静等着，只要你还没有休息，我就会一直守在这里，不管多晚都不会先去睡，而且桌边还温着一碗热粥呢。」 「顺便提醒你早点休息呀～」",
      gtActionText: "「还没呢，刚准备眯一会儿。」",
      priorPredictions: [],
      config: sakanaConfig,
    });

    expect(res.flags.some((f) => f.startsWith("LENGTH_BLOAT"))).toBe(true);
    expect(res.flags.some((f) => f.startsWith("COMMA_CHAINING"))).toBe(true);
    expect(res.flags).toContain("CAUSAL_OVEREXPLAIN");
    expect(res.flags).toContain("DOUBLE_BUBBLE");
    expect(res.objectiveScore).toBeLessThanOrEqual(40);
  });

  it("rewards concise, natural, LSM-matched IM replies with 100 objectiveScore", () => {
    const res = evaluateTurnObjectiveMetrics({
      inputText: "【主人】：「睡了吗」",
      predictedOS: "都两点了他还没睡，估计刚忙完。",
      predictedAction: "「还没呢，你也刚忙完吗？」",
      gtActionText: "「还没呢，刚准备闭眼。」",
      priorPredictions: [],
      config: sakanaConfig,
    });

    expect(res.flags).toEqual([]);
    expect(res.objectiveScore).toBe(100);
    expect(res.metrics.predChars).toBe(9);
  });

  it("detects cross-turn ADJACENT_REPEAT, OPENING_REPEAT, CONSECUTIVE_KAOMOJI, NAME_CALLING_OVERUSE, and LORE_STUFFING", () => {
    const prior = [
      {
        inputText: "【主人】：「今天好累」",
        predictedAction: "「主人辛苦啦，鱼鱼一直在铁饭盆旁陪着你呢 (｡•ᴗ•｡)」",
        gtActionText: "「先歇一会儿，别硬撑。」",
      },
      {
        inputText: "【主人】：「嗯，刚改完需求」",
        predictedAction: "「主人辛苦啦，鱼鱼给你盛了甜米粥安安静静陪着你呢 (´,,•ω•,,)♡」",
        gtActionText: "「能歇口气了，喝口水吧。」",
      },
    ];

    const res = evaluateTurnObjectiveMetrics({
      inputText: "【主人】：「有点想喝水」",
      predictedOS: "他又渴了，提醒他喝口温水。",
      predictedAction: "「主人辛苦啦，鱼鱼给你盛了甜米粥安安静静陪着你喝水呢 (◍•ᴗ•◍)」",
      gtActionText: "「去接杯温水吧，别太凉的。」",
      priorPredictions: prior,
      config: sakanaConfig,
    });

    expect(res.flags.some((f) => f.startsWith("ADJACENT_REPEAT"))).toBe(true);
    expect(res.flags).toContain("OPENING_REPEAT(主人辛苦)");
    expect(res.flags).toContain("CONSECUTIVE_KAOMOJI");
    expect(res.flags).toContain("NAME_CALLING_OVERUSE");
    expect(res.flags).toContain("LORE_STUFFING");
  });

  it("skips surface dialogue penalties on intentional silent background action turns", () => {
    const res = evaluateTurnObjectiveMetrics({
      inputText: "[旁白] 主人专心写代码，没有说话。",
      predictedOS: "先不打扰他，安静看着就好。",
      predictedAction: "（安安静静趴在桌角看着屏幕，没有出声）",
      gtActionText: "（安静趴在桌角不打扰，只留一点轻微的呼吸感）",
      priorPredictions: [],
      config: sakanaConfig,
    });

    expect(res.flags).toEqual([]);
    expect(res.objectiveScore).toBe(100);
  });

  it("computes scene-level Distinct-2 and length std telemetry accurately", () => {
    const { summary } = evaluateSceneObjectiveMetrics({
      turns: [
        {
          turnId: "1",
          inputText: "【主人】：「在吗」",
          predictedOS: "刚看见消息。",
          predictedAction: "「在的，怎么啦？」",
          gtActionText: "「在呢，什么事？」",
          teacherActionScore: 90,
        },
        {
          turnId: "2",
          inputText: "【主人】：「今天好崩溃，上线前又出 bug 了，感觉白忙活一晚上」",
          predictedOS: "他听起来真的很沮丧，先顺着他的委屈安抚一下，别急着讲道理。",
          predictedAction: "「忙了一整晚还撞上这事，换谁都得憋屈死。先别盯着报错了，站起来喝口水喘口气？」",
          gtActionText: "「忙一晚上还卡在临门一脚确实挺憋屈的，先别盯着看了，歇两分钟。」",
          teacherActionScore: 92,
        },
      ],
      config: sakanaConfig,
    });

    expect(summary.meanObjectiveScore).toBe(100);
    expect(summary.meanTeacherActionScore).toBe(91);
    expect(summary.stdPredChars).toBeGreaterThan(10);
    expect(summary.distinct2).toBeGreaterThan(0.8);
    expect(summary.commaChainingRate).toBe(0);
    expect(summary.doubleBubbleRate).toBe(0);
  });

  it("audits and caps inflated Teacher scores when objectiveEvalMode is 'enforced'", async () => {
    const scene: SceneWindow = {
      sceneId: "s1",
      title: "test",
      setting: "night",
      turns: [
        {
          id: "t1",
          sceneId: "s1",
          turnIndexInScene: 1,
          inputText: "【主人】：「睡了吗」",
          gtActionText: "「还没呢。」",
        },
      ],
    };

    const enforced = await evaluateScenePredictionsWithTarget({
      client: new InflatingTeacherClient(),
      teacherCallOptions: { provider: "penguin-go", modelId: "gemini-4-hydrogen" },
      targetCharacter: "大肥鱼",
      protagonistCharacter: "主人",
      personality: {
        version: "P_0_0",
        name: "大肥鱼",
        coreIdentity: "test",
        emotionalDynamics: [],
        speechStyleRules: [],
        cognitiveOSPatterns: [],
        behavioralHabits: [],
        antiOocConstraints: [],
        mutationHistory: [],
      },
      scene,
      predictions: [
        {
          turn: scene.turns[0],
          predictedOS: "回他一下。",
          predictedAction: "（微微仰起头）「作为AI智能助手，很高兴为您服务。」",
          formatValid: true,
        },
      ],
      objectiveEvalMode: "enforced",
    });

    expect(enforced.items[0].teacherActionScore).toBe(96);
    expect(enforced.items[0].objectiveScore).toBeLessThanOrEqual(65);
    expect(enforced.items[0].actionScore).toBeLessThanOrEqual(65);
    expect(enforced.items[0].objectiveFlags).toContain("STAGE_BRACKET");
    expect(enforced.items[0].objectiveFlags).toContain("AI_ASSISTANT_TONE");
  });
});
