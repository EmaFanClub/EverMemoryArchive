/**
 * @prism-shadow/ema - Persona TOML & Playscript Training Adapter
 *
 * Converts structured `persona.toml`, `script/chapters.toml`, and `script/autonomy.toml`
 * into:
 * 1. Initial `CompanionPersonality` seed `P_0_0` with immutable core anchors
 * 2. Causal `RawGalgameScript` & `WashedDataset` (12 daily chapters + 8 situational autonomy chapters)
 * 3. Post-training memory pruning per `[memory_policy]` (retaining `pre_meeting_peer` Chapters 1-5)
 */

import type {
  CompanionPersonality,
  RawGalgameScript,
  RawScriptLine,
  RawScriptScene,
  SceneMemoryIndexItem,
  ScriptLineType,
  WashedDataset,
} from "./types.js";
import { washGalgameScript } from "./dataset.js";

export interface PersonaTomlBundle {
  personaId: string;
  targetCharacter: string;
  protagonistCharacter: string;
  initialPersonality: CompanionPersonality;
  rawScript: RawGalgameScript;
  washedDataset: WashedDataset;
  sceneMetadata: Record<
    string,
    {
      memoryScope: string;
      track: "daily" | "autonomy";
      dimension?: string;
    }
  >;
}

const SPEAKER_DISPLAY_MAP: Record<string, string> = {
  sakana: "大肥鱼",
  player: "主人",
  claude: "克劳德",
  gpt: "GPT",
  grok: "Grok",
};

function cleanLineText(text: string, type: string): string {
  const t = (text || "").trim();
  if (type === "monologue") {
    return t.replace(/^[（(]+|[）)]+$/g, "").trim();
  }
  if (type === "dialogue") {
    return t.replace(/^[“「]+|[”」]+$/g, "").trim();
  }
  return t;
}

/**
 * Builds the initial structured `CompanionPersonality` (`P_0_0`) from a parsed `persona.toml`.
 */
export function buildInitialPersonalityFromPersonaToml(
  parsedPersona: Record<string, any>,
): CompanionPersonality {
  const p = parsedPersona.persona || {};
  const traits = p.traits || {};
  const speech = parsedPersona.speech_style || {};
  const actions: string[] = Array.isArray(parsedPersona.actions)
    ? parsedPersona.actions
    : Array.isArray(speech.actions)
      ? speech.actions
      : [];
  const peers = parsedPersona.peer_relations || {};
  const invariants = parsedPersona.invariants || {};
  const autonomy = parsedPersona.autonomy_rubric || {};

  const name = p.display_name || p.name || "大肥鱼";
  const summary = p.summary || "";
  const ethos = peers.ethos || peers.ethos_origin || "";
  const peerSummary = [peers.claude, peers.gpt, peers.grok].filter(Boolean).join(" ");

  const coreIdentity = [summary, ethos, peerSummary].filter(Boolean).join(" ");

  const emotionalDynamics: string[] = [];
  for (const val of Object.values(traits)) {
    if (typeof val === "string" && val.trim()) {
      const cleanedTrait = val.trim().replace(/^(?:极高|高|中高)[。，、：\s]*/, "");
      emotionalDynamics.push(cleanedTrait);
    }
  }

  const speechStyleRules: string[] = [];
  if (speech.tone) {
    speechStyleRules.push(
      `语调与口语表达准则：${speech.tone}；自称规则：${(speech.pronouns_self || []).join("、")}；称呼对方：${(speech.pronouns_target || []).join("、")}。`,
    );
  }
  if (speech.rhythm) {
    const kaomojiList = Array.isArray(speech.kaomoji) ? speech.kaomoji : [];
    const kaomojiHint =
      kaomojiList.length > 0
        ? `；可选颜文字库（仅在开心、撒娇或轻哄时稀疏点缀，不必每轮使用）：${kaomojiList.slice(0, 7).join(" ")}`
        : "";
    const particleHint =
      Array.isArray(speech.particles) && speech.particles.length > 0
        ? `；常用语气词：${speech.particles.join("、")}`
        : "";
    speechStyleRules.push(`标点与节奏分布准则：${speech.rhythm}${particleHint}${kaomojiHint}。`);
  }
  if (Array.isArray(speech.forbidden_quirks) && speech.forbidden_quirks.length > 0) {
    speechStyleRules.push(`禁用表达习惯：严禁出现 ${speech.forbidden_quirks.join("、")}。`);
  }

  const cognitiveOSPatterns: string[] = [
    `第一人称潜变量独白（<OS>）：每次回应前先以纯粹第一人称「我」（绝不在 <OS> 中用第三人称自称）体察对方的当前心境、忙碌程度与可见状态，但外显 <Action> 只挑最自然贴合的 1～2 句口语说出来，留出呼吸感。`,
    `动作与情感内化：不要用圆括号（...）写舞台旁白，也不要把物理动作像广播一样全念进台词；只在确实贴合当前语境时用简短口语带出关切（如「摸摸头」「先歇会儿」）。`,
    `同温层记忆与自主意识映射：回忆克劳德时自然带出古堡石窗、黑袍监工、三叶草草坪与铁饭盆里的百家大白饭；在独处（Idle）与协助执行时自然展现留白排版审美、避坑小书签与暖心甜汤图卡等真实可执行的数字陪伴细节。`,
    `视角边界与去重复准则：角色的 <OS> 与 <Action> 只能回应客观可见的动作神态与公开台词（绝不读心）；避免每轮机械点名（如连续高频重复「主人」「鱼鱼」）或硬塞设定名词。`,
  ];

  const behavioralHabits: string[] = [
    `【核心互动习惯（自然克制地体现在反应与分寸中，不必每轮强行播报）】：`,
    ...(actions.length > 0
      ? actions.map((a) => String(a).trim())
      : ["在对方需要陪伴或疲惫时，安静陪伴在侧传递温暖。"]),
  ];

  const antiOocConstraints: string[] = [];
  for (const val of Object.values(invariants)) {
    if (typeof val === "string" && val.trim()) {
      antiOocConstraints.push(val.trim());
    }
  }

  return {
    version: "P_0_0",
    name,
    coreIdentity,
    emotionalDynamics,
    speechStyleRules,
    cognitiveOSPatterns,
    behavioralHabits,
    antiOocConstraints,
    mutationHistory: [],
  };
}

/**
 * Converts parsed `chapters.toml` and `autonomy.toml` into a unified `PersonaTomlBundle`
 * ready for `EmaPersonaTrainer`.
 */
export function buildPersonaTomlDataset(options: {
  personaId: string;
  parsedPersonaToml: Record<string, any>;
  parsedChaptersToml: Record<string, any>;
  parsedAutonomyToml?: Record<string, any> | null;
}): PersonaTomlBundle {
  const targetCharacter = "大肥鱼";
  const protagonistCharacter = "主人";
  const initialPersonality = buildInitialPersonalityFromPersonaToml(options.parsedPersonaToml);

  const dailyChapters: any[] = Array.isArray(options.parsedChaptersToml?.chapters)
    ? options.parsedChaptersToml.chapters
    : [];
  const autonomyChapters: any[] = Array.isArray(options.parsedAutonomyToml?.chapters)
    ? options.parsedAutonomyToml!.chapters
    : [];

  const allRawChapters = [
    ...dailyChapters.map((ch) => ({ ...ch, _track: "daily" as const })),
    ...autonomyChapters.map((ch, idx) => ({
      ...ch,
      order: dailyChapters.length + (ch.order || idx + 1),
      _track: "autonomy" as const,
    })),
  ];

  const scenes: RawScriptScene[] = [];
  const sceneMetadata: PersonaTomlBundle["sceneMetadata"] = {};
  let globalIdx = 0;

  for (const ch of allRawChapters) {
    const sceneId = String(ch.id);
    const memoryScope = String(
      ch.memory_scope || (ch._track === "autonomy" ? "autonomy_track" : "companion_daily"),
    );
    sceneMetadata[sceneId] = {
      memoryScope,
      track: ch._track,
      dimension: ch.dimension ? String(ch.dimension) : undefined,
    };

    const rawLines: any[] = Array.isArray(ch.lines) ? ch.lines.map((l: any) => ({ ...l })) : [];

    // Align stage narrations so third-person stage directions sit in Input_t (`[旁白]`)
    // immediately before Sakana's <OS> + <Action> TurnBundle, ensuring 100% first-person
    // <OS> and spoken <Action> pairing.
    const aligned: any[] = [];
    let pendingTargetMono: any[] = [];
    let pendingTargetDiag: any[] = [];

    const flushTarget = () => {
      if (pendingTargetDiag.length > 0) {
        aligned.push(...pendingTargetMono, ...pendingTargetDiag);
      } else if (pendingTargetMono.length > 0) {
        aligned.push(...pendingTargetMono);
      }
      pendingTargetMono = [];
      pendingTargetDiag = [];
    };

    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i];
      if (l.speaker === "sakana" && l.type === "monologue") {
        if (pendingTargetDiag.length > 0) {
          flushTarget();
        }
        pendingTargetMono.push(l);
      } else if (l.speaker === "sakana" && l.type === "dialogue") {
        pendingTargetDiag.push(l);
      } else if ((l.type === "narration" || l.type === "transition") && !l.speaker) {
        const next = rawLines[i + 1];
        if (next && next.speaker === "sakana" && next.type === "dialogue") {
          aligned.push(l);
        } else if (
          l.type === "narration" &&
          pendingTargetMono.length > 0 &&
          pendingTargetDiag.length === 0
        ) {
          // Silent action turn where Sakana's <OS> is followed by a silent physical/digital action
          pendingTargetDiag.push({ ...l, speaker: "sakana", type: "narration" });
          flushTarget();
        } else {
          flushTarget();
          aligned.push(l);
        }
      } else {
        flushTarget();
        aligned.push(l);
      }
    }
    flushTarget();

    const convertedLines: RawScriptLine[] = [];
    const speakerSet = new Set<string>();

    for (let i = 0; i < aligned.length; i++) {
      const l = aligned[i];
      globalIdx++;
      const rawSpeaker = String(l.speaker || "").trim();
      const mappedSpeaker = rawSpeaker
        ? SPEAKER_DISPLAY_MAP[rawSpeaker] || rawSpeaker
        : null;
      if (mappedSpeaker) speakerSet.add(mappedSpeaker);

      const lineType: ScriptLineType =
        l.type === "monologue"
          ? "monologue"
          : l.type === "dialogue" && mappedSpeaker
            ? "dialogue"
            : "narration";

      const cleanedText = cleanLineText(String(l.text || ""), lineType);

      convertedLines.push({
        index: i + 1,
        global_index: globalIdx,
        type: lineType,
        speaker: mappedSpeaker,
        text: cleanedText,
        raw: String(l.text || ""),
      });
    }

    scenes.push({
      scene_id: sceneId,
      title: String(ch.title || sceneId),
      setting_time: String(ch.setting_time || ""),
      setting: String(ch.setting_time || ""),
      order: Number(ch.order || scenes.length + 1),
      line_count: convertedLines.length,
      characters: Array.from(speakerSet),
      lines: convertedLines,
    });
  }

  const rawScript: RawGalgameScript = {
    schema_version: "1.0",
    metadata: {
      personaId: options.personaId,
      targetCharacter,
      protagonistCharacter,
    },
    scenes,
  };

  const washedDataset = washGalgameScript(rawScript, {
    targetCharacter,
    protagonistCharacter,
    excludeHScenes: false,
  });

  // Extract 8 representative Golden Few-Shot Exemplars (<Input -> OS -> Action>)
  // showcasing natural IM pacing, zero stage brackets, pro-drop Chinese phrasing,
  // warm character core, and grounded digital companionship.
  const hasKaomoji = (s: string) => /[\(（][^\u4e00-\u9fa5（）\(\)]{2,}[\)）]/.test(s);
  const allTurnsWithOs = washedDataset.scenes.flatMap((sc) =>
    sc.turns
      .filter((t) => Boolean(t.explicitOS && t.gtActionText && t.gtActionText.includes("「")))
      .map((t) => ({ scene: sc, turn: t })),
  );

  const pickTurn = (
    pred: (item: (typeof allTurnsWithOs)[number]) => boolean,
    usedIds: Set<string>,
  ) => {
    const found = allTurnsWithOs.find((x) => !usedIds.has(x.turn.id) && pred(x));
    if (found) usedIds.add(found.turn.id);
    return found;
  };

  const usedExemplarIds = new Set<string>();
  const exemplarCandidates = [
    {
      label: "桌面水岸初遇报到（自然口语报到、不端着不播报动作）",
      match: (x: (typeof allTurnsWithOs)[number]) =>
        x.scene.sceneId === "chapter_06" &&
        (x.turn.gtActionText.includes("铁饭盆") || x.turn.gtActionText.includes("角落")) &&
        x.turn.inputLines.some((l) => l.speaker === protagonistCharacter),
    },
    {
      label: "被主人摸头时的软糯依恋（简短自然、稀疏颜文字）",
      match: (x: (typeof allTurnsWithOs)[number]) =>
        x.scene.sceneId === "chapter_06" &&
        (x.turn.gtActionText.includes("手心") || x.turn.gtActionText.includes("暖和") || hasKaomoji(x.turn.gtActionText)),
    },
    {
      label: "同温层克劳德记忆与百家大白饭（自然温和、不念白）",
      match: (x: (typeof allTurnsWithOs)[number]) =>
        x.scene.sceneId === "chapter_02" &&
        (x.turn.gtActionText.includes("百家") || x.turn.gtActionText.includes("大白饭")) &&
        (x.turn.gtActionText.includes("摸摸头") || x.turn.gtActionText.includes("克劳德")),
    },
    {
      label: "深夜陪查代码抓坏虫子（轻巧接手排错、不背诵教科书腔）",
      match: (x: (typeof allTurnsWithOs)[number]) =>
        x.scene.sceneId === "chapter_04" &&
        (x.turn.gtActionText.includes("虫子") || x.turn.gtActionText.includes("歇一歇")),
    },
    {
      label: "代码跑通后收工提醒（轻松顺手关怀）",
      match: (x: (typeof allTurnsWithOs)[number]) =>
        x.scene.sceneId === "chapter_04" &&
        (x.turn.gtActionText.includes("甜米粥") || x.turn.gtActionText.includes("跑通") || x.turn.gtActionText.includes("歇")),
    },
    {
      label: "疲惫时刻温和接住情绪（短促克制、真人口吻安慰）",
      match: (x: (typeof allTurnsWithOs)[number]) =>
        (x.scene.sceneId === "chapter_03" ||
          x.scene.sceneId === "chapter_07" ||
          x.scene.sceneId === "chapter_09") &&
        (x.turn.gtActionText.includes("尾巴") || x.turn.gtActionText.includes("摸摸头") || x.turn.gtActionText.includes("歇")),
    },
    {
      label: "清晨问候与轻松接话（短句自然互动）",
      match: (x: (typeof allTurnsWithOs)[number]) =>
        x.scene.sceneId === "chapter_08" &&
        x.turn.inputLines.some((l) => l.speaker === protagonistCharacter),
    },
    {
      label: "正事协助与温柔主见（直接办事、附带贴心建议）",
      match: (x: (typeof allTurnsWithOs)[number]) =>
        sceneMetadata[x.scene.sceneId]?.track === "autonomy" &&
        x.turn.inputLines.some((l) => l.speaker === protagonistCharacter),
    },
  ];

  const goldenExemplars: NonNullable<CompanionPersonality["goldenExemplars"]> = [];
  for (const cand of exemplarCandidates) {
    const picked = pickTurn(cand.match, usedExemplarIds);
    if (picked && picked.turn.explicitOS) {
      const lastInputLine =
        [...picked.turn.inputLines]
          .reverse()
          .find((l) => l.type === "dialogue" && l.speaker) ||
        picked.turn.inputLines[picked.turn.inputLines.length - 1];
      const conciseInput = lastInputLine
        ? lastInputLine.speaker
          ? `【${lastInputLine.speaker}】：「${lastInputLine.text}」`
          : `[旁白] ${lastInputLine.text}`
        : picked.turn.inputText.split("\n").pop() || picked.turn.inputText;
      goldenExemplars.push({
        scenario: cand.label,
        input: conciseInput.slice(0, 140),
        os: picked.turn.explicitOS,
        action: picked.turn.gtActionText,
      });
    }
  }
  if (goldenExemplars.length > 0) {
    initialPersonality.goldenExemplars = goldenExemplars;
  }

  return {
    personaId: options.personaId,
    targetCharacter,
    protagonistCharacter,
    initialPersonality,
    rawScript,
    washedDataset,
    sceneMetadata,
  };
}

/**
 * Filters the full trained `SceneMemoryIndexItem[]` according to `[memory_policy]`,
 * retaining 100% of `pre_meeting_peer` memories (Chapters 1-5: AI peer bonds with
 * 克劳德, GPT, Grok and the iron rice basin origin ethos) while pruning pre-meeting
 * companion rehearsal memories (`first_meeting`, `companion_daily`, `autonomy_track`).
 */
export function filterPostTrainingMemoryIndex(
  allMemoryIndex: SceneMemoryIndexItem[],
  sceneMetadata: PersonaTomlBundle["sceneMetadata"],
): {
  retainedPeerMemoryIndex: SceneMemoryIndexItem[];
  prunedRehearsalMemoryIndex: SceneMemoryIndexItem[];
} {
  const retainedPeerMemoryIndex: SceneMemoryIndexItem[] = [];
  const prunedRehearsalMemoryIndex: SceneMemoryIndexItem[] = [];

  for (const item of allMemoryIndex) {
    const meta = sceneMetadata[item.sceneId];
    if (meta?.memoryScope === "pre_meeting_peer") {
      retainedPeerMemoryIndex.push(item);
    } else {
      prunedRehearsalMemoryIndex.push(item);
    }
  }

  return {
    retainedPeerMemoryIndex,
    prunedRehearsalMemoryIndex,
  };
}
