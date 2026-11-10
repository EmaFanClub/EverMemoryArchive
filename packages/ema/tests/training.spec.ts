import { describe, expect, it } from "vitest";
import {
  createInitialPersonalityTemplate,
  EmaPersonaTrainer,
  extractJsonFromLlm,
  formatMemoryIndexMarkdown,
  parseStudentTurnOutput,
  renderCompanionAgentsMd,
  washGalgameScript,
  type LlmCallResponse,
  type RawGalgameScript,
} from "../src/index.js";

const SYNTHETIC_SCRIPT: RawGalgameScript = {
  schema_version: "1.0.0",
  scenes: [
    {
      scene_id: "001_ch01_01",
      title: "Rooftop Encounter",
      setting_time: "Afternoon",
      setting: "School Rooftop",
      order: 1,
      line_count: 6,
      characters: ["Bob", "Alice", "Mystery"],
      lines: [
        {
          index: 1,
          global_index: 1,
          type: "narration",
          speaker: null,
          text: "I walked onto the windy rooftop.",
          raw: "I walked onto the windy rooftop.",
        },
        {
          index: 2,
          global_index: 2,
          type: "dialogue",
          speaker: "Mystery",
          text: "You are late.",
          raw: "Mystery「You are late.」",
        },
        {
          index: 3,
          global_index: 3,
          type: "dialogue",
          speaker: "Bob",
          text: "Sorry, the stairs were crowded.",
          raw: "Bob「Sorry, the stairs were crowded.」",
        },
        {
          index: 4,
          global_index: 4,
          type: "monologue",
          speaker: "Alice",
          text: "I was actually waiting for him the whole time.",
          raw: "Alice（I was actually waiting for him the whole time.）",
        },
        {
          index: 5,
          global_index: 5,
          type: "dialogue",
          speaker: "Alice",
          text: "Hmph. Next time bring snacks.",
          raw: "Alice「Hmph. Next time bring snacks.」",
        },
        {
          index: 6,
          global_index: 6,
          type: "narration",
          speaker: null,
          text: "The bell rang in the distance.",
          raw: "The bell rang in the distance.",
        },
      ],
    },
    {
      scene_id: "002_Hシーン_01",
      title: "Bonus Scene",
      setting_time: "Night",
      setting: "Room",
      order: 2,
      line_count: 1,
      characters: ["Alice"],
      lines: [
        {
          index: 1,
          global_index: 7,
          type: "dialogue",
          speaker: "Alice",
          text: "Goodnight.",
          raw: "Alice「Goodnight.」",
        },
      ],
    },
  ],
};

describe("EMA Training Prototype (RFC-0003 / RFC-0004 / RFC-0005)", () => {
  it("washes narrative scripts into TurnBundles with aliases, scene overrides, and H-scene filtering", () => {
    const washed = washGalgameScript(SYNTHETIC_SCRIPT, {
      targetCharacter: "Alice",
      protagonistCharacter: "Bob",
      speakerAliases: ["A-chan"],
      sceneSpeakerOverrides: {
        "001_ch01_01": ["Mystery"],
      },
      excludeHScenes: true,
    });

    expect(washed.targetCharacter).toBe("Alice");
    expect(washed.protagonistCharacter).toBe("Bob");
    expect(washed.stats.storyScenesWithTarget).toBe(2);
    expect(washed.stats.nonHScenesWithTarget).toBe(1);
    expect(washed.stats.hScenesWithTarget).toBe(1);
    expect(washed.scenes).toHaveLength(1);

    const scene = washed.scenes[0];
    expect(scene.turns).toHaveLength(2);
    expect(scene.turns[0].gtActionText).toBe("「You are late.」");
    expect(scene.turns[1].explicitOS).toBe("I was actually waiting for him the whole time.");
    expect(scene.turns[1].gtActionText).toBe("「Hmph. Next time bring snacks.」");
    expect(scene.trailingText).toContain("The bell rang in the distance.");
  });

  it("parses <OS> and <Action> blocks and JSON from LLM outputs", () => {
    const parsed = parseStudentTurnOutput(
      "<OS>Glad he finally arrived, but hiding it behind a complaint.</OS>\n<Action>「You are late.」</Action>",
    );
    expect(parsed.formatValid).toBe(true);
    expect(parsed.os).toContain("Glad he finally arrived");
    expect(parsed.action).toBe("「You are late.」");

    const jsonObj = extractJsonFromLlm<{ a: number }>("```json\n{\"a\": 42}\n```");
    expect(jsonObj.a).toBe(42);
  });

  it("enforces zero target leakage in micro-batch Student prompts and omits duplicate inline persona when synced", () => {
    const washed = washGalgameScript(SYNTHETIC_SCRIPT, {
      targetCharacter: "Alice",
      protagonistCharacter: "Bob",
      sceneSpeakerOverrides: { "001_ch01_01": ["Mystery"] },
    });
    const scene = washed.scenes[0];
    const p0 = createInitialPersonalityTemplate({ name: "Alice", protagonistName: "Bob" });

    const trainerSynced = new EmaPersonaTrainer(
      {
        targetCharacter: "Alice",
        protagonistCharacter: "Bob",
        studentModel: { provider: "penguin-go", modelId: "gemini-3.8-flash", thinkingLevel: "medium" },
        teacherModel: { provider: "penguin-go", modelId: "gemini-3.8-flash", thinkingLevel: "medium" },
        syncAgentOnDisk: true,
      },
      { initialPersonality: p0 },
    );

    const batchPrompt = trainerSynced.buildStudentReactPrompt(scene, [], scene.turns);
    // Must NOT leak ground truth actions of the active batch turns
    expect(batchPrompt).not.toContain("You are late.");
    expect(batchPrompt).not.toContain("Next time bring snacks.");
    // Must reference AGENTS.md instead of duplicating full inline persona
    expect(batchPrompt).toContain("AGENTS.md");
  });

  it("executes forward-backward local RSI window training with anchor-preserving mutation and scene compaction", async () => {
    const washed = washGalgameScript(SYNTHETIC_SCRIPT, {
      targetCharacter: "Alice",
      protagonistCharacter: "Bob",
      sceneSpeakerOverrides: { "001_ch01_01": ["Mystery"] },
    });
    const scene = washed.scenes[0];
    const p0 = createInitialPersonalityTemplate({
      name: "Alice",
      protagonistName: "Bob",
      coreIdentity: "Alice is a sharp-tongued rooftop astronomer.",
    });

    let studentCalls = 0;
    let evalCalls = 0;
    const fakeClient = {
      complete: async (prompt: string): Promise<LlmCallResponse> => {
        const metrics = {
          latencyMs: 10,
          promptTokens: 100,
          cachedTokens: 50,
          thoughtsTokens: 20,
          responseTokens: 30,
          totalTokens: 200,
          costUsd: 0.001,
        };

        if (prompt.includes("待预测连续回合批次")) {
          studentCalls++;
          return {
            text: JSON.stringify(
              scene.turns.map((t) => ({
                turnId: t.id,
                os: "Waiting impatiently for Bob.",
                action: studentCalls === 1 ? "「Hello there, how may I assist you today?」" : t.gtActionText,
              })),
            ),
            thinking: "",
            metrics,
          };
        }

        if (prompt.includes("Teacher 审稿与评分器")) {
          evalCalls++;
          const score = evalCalls === 1 ? 65 : 92;
          return {
            text: JSON.stringify(
              scene.turns.map((t) => ({
                turnId: t.id,
                osConsistent: true,
                osScore: score,
                committedOS: "Waiting impatiently for Bob while pretending to be aloof.",
                actionScore: score,
                diagnostic: evalCalls === 1 ? "Too polite on attempt 1" : "Matches crisp tone",
              })),
            ),
            thinking: "",
            metrics,
          };
        }

        if (prompt.includes("adjust_personality")) {
          return {
            text: JSON.stringify({
              mutationReason: "Enforce crisp rooftop banter when greeting Bob",
              emotionalDynamics: ["Uses dry complaints to mask affection when Bob arrives late."],
              speechStyleRules: ["Keep remarks under two short sentences."],
              cognitiveOSPatterns: ["When relieved to see Bob, respond with a terse complaint."],
              behavioralHabits: ["Leans against the rooftop railing."],
              antiOocConstraints: ["Never use formal customer-service greetings."],
            }),
            thinking: "",
            metrics,
          };
        }

        if (prompt.includes("场景记忆压缩任务")) {
          return {
            text: JSON.stringify({
              summary: "I waited for Bob on the rooftop and teased him for being late.",
              innerOSArc: "Relieved he came despite acting impatient.",
              keyFacts: ["Met Bob on the rooftop in the afternoon"],
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
      },
    } as any;

    const trainer = new EmaPersonaTrainer(
      {
        targetCharacter: "Alice",
        protagonistCharacter: "Bob",
        studentModel: { provider: "penguin-go", modelId: "gemini-3.8-flash", thinkingLevel: "medium" },
        teacherModel: { provider: "penguin-go", modelId: "gemini-3.8-flash", thinkingLevel: "medium" },
        rsiScoreThreshold: 80,
        maxWindowAttempts: 2,
        studentBatchSize: 4,
        enableReflectionCheck: true,
        syncAgentOnDisk: false,
      },
      {
        client: fakeClient,
        initialPersonality: p0,
      },
    );

    const counter = { count: 0 };
    const result = await trainer.trainSceneWindow(scene, counter);

    expect(result.attempts).toBe(2);
    expect(result.initialMeanScore).toBe(65);
    expect(result.finalMeanScore).toBe(92);
    expect(result.personalityMutatedTo).toBe("P_0_1");
    expect(trainer.personality.version).toBe("P_0_1");
    // Core anchor from P_0_0 is preserved while new modulation rule is appended
    expect(trainer.personality.coreIdentity).toBe("Alice is a sharp-tongued rooftop astronomer.");
    expect(trainer.personality.emotionalDynamics).toHaveLength(2);
    expect(trainer.memoryIndex).toHaveLength(1);
    expect(result.reflectionScore).toBe(95);

    const md = renderCompanionAgentsMd(trainer.personality, trainer.memoryIndex, {
      protagonistName: "Bob",
    });
    expect(md).toContain("Alice");
    expect(formatMemoryIndexMarkdown(trainer.memoryIndex)).toContain("Rooftop Encounter");
  });
});
