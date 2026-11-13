/**
 * @prism-shadow/ema - Persona Renderer, State Sync, & Anchor-Preserving Mutator (RFC-0004 ~ RFC-0007)
 *
 * Shared cognitive operators for:
 * - Loading external personality seeds or constructing generic P_{0,0} templates
 * - Rendering P_{u,v} + Hierarchical MemoryIndex (L1 Epochs + L0 Scenes) into `AGENTS.md`
 * - Preserving embedded World/Channel protocol blocks (`<!-- EMA_*_PROTOCOL_START -->`) on sync
 * - Anchor-Preserving Contextual Modulation (`mutatePersonalityWithAnchors`) shared by `train` and `dream`
 */

import fs from "node:fs";
import path from "node:path";
import { loadEmaGlobalConfig } from "../config.js";
import type {
  CompanionPersonality,
  CompressionPromptConfig,
  EpochMemoryIndexItem,
  ExternalPersonaSeedBundle,
  LlmCallMetrics,
  MemoryItem,
  SceneMemoryIndexItem,
  SceneWindow,
} from "./types.js";
import type { LlmCallOptions, PenguinServerLLMClient } from "./llm-client.js";

/**
 * Extracts <OS> and <Action> blocks from model output.
 * Throws if either <OS> or <Action> is missing or empty.
 */
export function parseStudentTurnOutput(rawText: string): {
  os: string;
  action: string;
  formatValid: boolean;
} {
  const text = (rawText || "").trim();
  const osMatch = text.match(/<OS>([\s\S]*?)<\/OS>/i);
  const actionMatch = text.match(/<Action>([\s\S]*?)<\/Action>/i);

  if (!osMatch || !actionMatch) {
    throw new Error(
      `Invalid Student turn output: missing <OS> or <Action> block in "${text.slice(0, 200)}"`,
    );
  }

  const os = osMatch[1].trim();
  const action = actionMatch[1].trim();
  if (!os || !action) {
    throw new Error(
      `Invalid Student turn output: empty <OS> or <Action> block in "${text.slice(0, 200)}"`,
    );
  }

  return {
    os,
    action,
    formatValid: true,
  };
}

/**
 * Extracts a JSON object or array from an LLM response string (stripping markdown fences if present).
 * Throws immediately if the response is not valid JSON.
 */
export function extractJsonFromLlm<T = any>(rawText: string): T {
  const cleaned = (rawText || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned) as T;
}

/**
 * Creates a generic, character-agnostic cold-start personality template P_{0,0}.
 */
export function createInitialPersonalityTemplate(options: {
  name: string;
  protagonistName?: string;
  coreIdentity?: string;
}): CompanionPersonality {
  const name = options.name || "Companion";
  const protagonist = options.protagonistName || "对方";
  return {
    version: "P_0_0",
    name,
    coreIdentity:
      options.coreIdentity ||
      `你是 ${name}，与 ${protagonist} 相伴同行。请根据你的性格特质、语言习惯与共同经历的场景记忆自然地回应 ${protagonist}。`,
    emotionalDynamics: [
      `保持鲜明且连贯的角色性格与情感张力，区分日常互动与严肃情境下的情绪表达。`,
    ],
    speechStyleRules: [
      `保持符合角色身份的句长、语调与口癖，避免长篇大论或使用现代客服/AI助手式说教。`,
    ],
    cognitiveOSPatterns: [
      `先在潜变量内心独白 <OS> 中推演当前情境下的真实情绪与潜台词，再将其转化为自然的外显台词与动作 <Action>。`,
      `视角边界（非读心铁律）：剧本中的「[旁白]」可能包含第一人称叙述者的未说出口心理活动。角色的 OS 与 Action 只能回应客观可见的动作神态与公开台词，绝不读心回应未公开的内心独白。`,
    ],
    behavioralHabits: [
      `在对话中自然融入标志性的肢体小动作、神态微表情与习惯性反应。`,
    ],
    antiOocConstraints: [
      `绝对禁止使用现代AI助手腔调（禁止说「作为AI」「很高兴为你服务」「我们可以从以下几个方面来看」）。`,
      `禁止在日常对话中调用无关的代码或文件工具；直接以角色身份回应。`,
    ],
    mutationHistory: [],
  };
}

/**
 * Loads either a `CompanionPersonality` JSON or an `ExternalPersonaSeedBundle` JSON from disk.
 */
export function loadExternalPersonaSeed(jsonPath: string): ExternalPersonaSeedBundle {
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  if (raw && typeof raw === "object" && "personality" in raw && raw.personality) {
    return {
      targetCharacter: raw.targetCharacter || raw.personality.name,
      protagonistCharacter: raw.protagonistCharacter,
      speakerAliases: Array.isArray(raw.speakerAliases) ? raw.speakerAliases : undefined,
      sceneSpeakerOverrides:
        raw.sceneSpeakerOverrides && typeof raw.sceneSpeakerOverrides === "object"
          ? raw.sceneSpeakerOverrides
          : undefined,
      personality: raw.personality as CompanionPersonality,
    };
  }
  const p = raw as CompanionPersonality;
  return {
    targetCharacter: p.name,
    personality: p,
  };
}

/**
 * Creates the default trainable compression prompt C_{0,0} for scene compaction.
 */
export function createDefaultCompressionPrompt(
  targetCharacter = "目标角色",
  protagonistCharacter = "主角",
): CompressionPromptConfig {
  return {
    version: "C_0_0",
    maxSummaryChars: 140,
    maxKeyFacts: 3,
    instructions: [
      `请以「${targetCharacter}」的第一人称视角（「我」），将该场景中的交互轨迹（MemoryItems: <Input, OS, Action>）压缩为一条高密度的场景记忆索引（SceneMemoryIndexItem）。`,
      "要求：",
      `1. summary（不超过140字）：浓缩本场景的核心事件、与「${protagonistCharacter}」及在场人物的具体互动细节（包括关键动作、对话话题、承诺或特殊细节）。`,
      `2. innerOSArc（不超过60字）：提炼本场景中「${targetCharacter}」内心的真实情感波动与潜台词变化（<OS>暗线）。`,
      "3. keyFacts（1～3条短句）：提取后续剧情或对话中必须记住的事实锚点（人物身份、地点设定、重要约定、特殊喜好）。",
    ].join("\n"),
  };
}

/**
 * Formats the In-Context MemoryIndex (supporting both L1 Epoch rollups and L0 Scene indices)
 * into a compact Markdown block.
 */
export function formatMemoryIndexMarkdown(
  memoryIndex: SceneMemoryIndexItem[],
  l1MemoryIndex: EpochMemoryIndexItem[] = [],
): string {
  const activeL0 = memoryIndex.filter((m) => !m.rolledUpIntoEpochId);

  if (l1MemoryIndex.length === 0 && activeL0.length === 0) {
    return "（当前尚无已归档的场景记忆，处于初遇/序章阶段。）";
  }

  const lines: string[] = [];

  if (l1MemoryIndex.length > 0) {
    lines.push(`### A. 阶段汇总记忆 (Level-1 Epoch MemoryIndex — 共 ${l1MemoryIndex.length} 卷)`);
    for (const ep of l1MemoryIndex) {
      const facts =
        ep.consolidatedKeyFacts && ep.consolidatedKeyFacts.length > 0
          ? ` | 核心沉淀: ${ep.consolidatedKeyFacts.join("；")}`
          : "";
      lines.push(
        `- **[${ep.epochId} | ${ep.title} (${ep.timeSpan}, 涵盖 ${ep.sourceSceneIds.length} 幕)]**: ${ep.summary} *(心境演进: ${ep.emotionalEvolutionArc})*${facts}`,
      );
    }
    if (activeL0.length > 0) {
      lines.push("");
      lines.push(`### B. 近期具体场景记忆 (Level-0 Scene MemoryIndex — 共 ${activeL0.length} 幕)`);
    }
  }

  for (const item of activeL0) {
    const facts =
      item.keyFacts && item.keyFacts.length > 0
        ? ` | 关键记忆: ${item.keyFacts.join("；")}`
        : "";
    lines.push(
      `- **[${item.sceneId} | ${item.title} (${item.setting})]**: ${item.summary} *(内心OS: ${item.innerOSArc})*${facts}`,
    );
  }

  return lines.join("\n");
}

/**
 * Extracts comment-delimited protocol blocks (e.g. `<!-- EMA_WEB_CHANNEL_PROTOCOL_START -->...`)
 * from an existing `AGENTS.md` file so syncing never overwrites active World channel bindings.
 */
export function extractPreservedProtocolBlocks(existingAgentsMd: string): string[] {
  if (!existingAgentsMd) return [];
  const regex = /<!--\s*EMA_[A-Z0-9_]+_START\s*-->[\s\S]*?<!--\s*EMA_[A-Z0-9_]+_END\s*-->/g;
  const matches = existingAgentsMd.match(regex);
  return matches ? matches.map((m) => m.trim()) : [];
}

/**
 * Renders the complete `AGENTS.md` content for a companion Penguin agent,
 * combining Personality P_{u,v}, Hierarchical In-Context MemoryIndex, and preserved channel protocols.
 */
export function renderCompanionAgentsMd(
  personality: CompanionPersonality,
  memoryIndex: SceneMemoryIndexItem[] = [],
  options?: {
    protagonistName?: string;
    l1MemoryIndex?: EpochMemoryIndexItem[];
    preservedProtocolBlocks?: string[];
  },
): string {
  const protagonist = options?.protagonistName || "对方";
  const l1MemoryIndex = options?.l1MemoryIndex || [];
  const activeL0Count = memoryIndex.filter((m) => !m.rolledUpIntoEpochId).length;
  const totalMemoryDesc =
    l1MemoryIndex.length > 0
      ? `L1 阶段记忆 ${l1MemoryIndex.length} 卷 + L0 近期场景记忆 ${activeL0Count} 幕`
      : `共 ${activeL0Count} 个场景记忆`;

  const preservedSuffix =
    options?.preservedProtocolBlocks && options.preservedProtocolBlocks.length > 0
      ? `\n---\n\n${options.preservedProtocolBlocks.join("\n\n")}\n`
      : "";

  const exemplarsSection =
    Array.isArray(personality.goldenExemplars) && personality.goldenExemplars.length > 0
      ? `\n## 6.5 原著《chapters.toml》语感与潜变量映射真句锚点 (Golden Few-Shot Exemplars)\n以下是你在不同情境下从潜变量内心独白 \`<OS>\` 到外显口语台词 \`<Action>\` 的原著标准范例（请严格对齐原著标志性的**「零括号动作旁白 + 一逗到底的绵密逗号长句 + 口语内化动作与原著意象」**语感）：\n\n${personality.goldenExemplars
          .map(
            (ex, idx) =>
              `- **范例 ${idx + 1}（${ex.scenario}）**\n  - 输入: ${ex.input}\n  - 内心 \`<OS>\`: （${ex.os}）\n  - 回应 \`<Action>\`: ${ex.action}`,
          )
          .join("\n")}\n`
      : "";

  return `# ${personality.name} — EverMemoryArchive (EMA) 伴侣人格与记忆档案 (${personality.version})

## 1. 核心身份与设定 (Core Identity)
${personality.coreIdentity}

## 2. 情感动力学与性格特质 (Emotional Dynamics)
${personality.emotionalDynamics.map((d) => `- ${d}`).join("\n")}

## 3. 语言风格与台词铁律 (Speech Style Rules)
${personality.speechStyleRules.map((r) => `- ${r}`).join("\n")}

## 4. 潜变量内心独白模式 (Latent \`<OS>\` Cognitive Patterns)
${personality.cognitiveOSPatterns.map((p) => `- ${p}`).join("\n")}

## 5. 标志性动作与习惯 (Behavioral Habits)
${personality.behavioralHabits.map((h) => `- ${h}`).join("\n")}

## 6. 反 OOC 负向约束 (Anti-OOC Constraints)
${personality.antiOocConstraints.map((c) => `- ${c}`).join("\n")}
${exemplarsSection}
---

## 7. 情景记忆索引 (In-Context MemoryIndex — ${totalMemoryDesc})
以下是你（${personality.name}）与${protagonist}及同伴们共同经历并沉淀的记忆索引。在回应${protagonist}或回忆往事时，请自然地调用这些记忆细节与情感脉络，绝不捏造与记忆冲突的经历：

${formatMemoryIndexMarkdown(memoryIndex, l1MemoryIndex)}

---

## 8. 对话交互与认知输出准则 (Interaction & \`<OS>\` -> \`<Action>\` Protocol)
- 当用户（默认视作「${protagonist}」）或群聊好友与你日常对话时，直接以 **${personality.name}** 的身份回应（无需调用无关的文件/终端工具，不要输出任何系统元信息）。
- 在每一次回复中，你**必须**严格遵循 \`Input -> <OS> -> <Action>\` 两阶段认知输出格式，先输出 \`<OS>...</OS>\` 第一人称中文内心独白，再输出 \`<Action>...</Action>\` 外显神态动作与台词：
<OS>
（第一人称内心独白：你在当前情境下的真实情绪波动、潜台词与被唤起的记忆联想）
</OS>
<Action>
（外显神态动作与对对方的自然回复台词）
</Action>
${preservedSuffix}`;
}

/**
 * Synchronizes the given Personality P_{u,v} and MemoryIndex (L0 + L1) to the
 * specified Penguin agent's `agent_state/AGENTS.md` while preserving any embedded
 * `<!-- EMA_*_PROTOCOL_START -->` blocks.
 */
export function syncCompanionAgentState(options: {
  personality: CompanionPersonality;
  memoryIndex: SceneMemoryIndexItem[];
  l1MemoryIndex?: EpochMemoryIndexItem[];
  agentId: string;
  protagonistName?: string;
  appDataDir?: string;
  thinkingLevel?: "low" | "medium" | "high";
  preserveProtocolBlocks?: boolean;
}): { agentsMdPath: string; systemConfigPath: string } {
  const agentId = options.agentId;
  const appDataDir = options.appDataDir || loadEmaGlobalConfig().appDataDir;

  const agentStateDir = path.join(appDataDir, "agents", agentId, "agent_state");
  fs.mkdirSync(agentStateDir, { recursive: true });

  const agentsMdPath = path.join(agentStateDir, "AGENTS.md");
  const systemConfigPath = path.join(agentStateDir, "system_config.yaml");

  let preservedProtocolBlocks: string[] = [];
  if (options.preserveProtocolBlocks !== false && fs.existsSync(agentsMdPath)) {
    const existingMd = fs.readFileSync(agentsMdPath, "utf8");
    preservedProtocolBlocks = extractPreservedProtocolBlocks(existingMd);
  }

  const mdContent = renderCompanionAgentsMd(options.personality, options.memoryIndex, {
    protagonistName: options.protagonistName,
    l1MemoryIndex: options.l1MemoryIndex,
    preservedProtocolBlocks,
  });
  fs.writeFileSync(agentsMdPath, mdContent, "utf8");

  if (options.thinkingLevel && fs.existsSync(systemConfigPath)) {
    const rawYaml = fs.readFileSync(systemConfigPath, "utf8");
    const updatedYaml = rawYaml.replace(
      /^(\s*thinking_level:\s*).*$/m,
      `$1${options.thinkingLevel}`,
    );
    if (updatedYaml !== rawYaml) {
      fs.writeFileSync(systemConfigPath, updatedYaml, "utf8");
    }
  }

  return { agentsMdPath, systemConfigPath };
}

/**
 * Shared Anchor-Preserving Personality Mutation Operator (`adjust_personality` in RFC-0005 / RFC-0007):
 * Mutates P_{u,v} -> P_{u,v}' based on failure diagnostics (`worstItems`) while strictly locking
 * core anchor traits in `anchorPersonality` to prevent catastrophic forgetting.
 */
export async function mutatePersonalityWithAnchors(options: {
  client: PenguinServerLLMClient;
  teacherCallOptions: LlmCallOptions;
  targetCharacter: string;
  currentPersonality: CompanionPersonality;
  anchorPersonality: CompanionPersonality;
  scene: Pick<SceneWindow, "sceneId" | "title">;
  items: MemoryItem[];
  nextVersionLabel: string;
  mode?: "training" | "dreaming";
}): Promise<{
  mutatedPersonality: CompanionPersonality;
  mutationReason: string;
  metrics: LlmCallMetrics;
}> {
  const {
    client,
    teacherCallOptions,
    targetCharacter,
    currentPersonality,
    anchorPersonality,
    scene,
    items,
    nextVersionLabel,
    mode = "training",
  } = options;

  const worstItems = [...items]
    .sort((a, b) => a.combinedScore - b.combinedScore)
    .slice(0, 6)
    .map((it) => ({
      turnId: it.turnId,
      input: it.inputText,
      predictedOS: it.predictedOS,
      predictedAction: it.predictedAction,
      targetAction: it.gtActionText,
      osScore: it.osScore,
      actionScore: it.actionScore,
      diagnostic: it.diagnostic,
    }));

  const meanScore =
    items.reduce((s, x) => s + x.combinedScore, 0) / Math.max(1, items.length);

  const modeLabel =
    mode === "dreaming"
      ? "梦境自省人格校准器 (Dreaming Persona Consolidator)"
      : "角色训练人格优化器 (Teacher adjust_personality)";

  const prompt = [
    `你是 EverMemoryArchive (EMA) 的 **${modeLabel}**。`,
    `在场景 \`${scene.sceneId}\` 《${scene.title}》的评估中，当前角色「${targetCharacter}」人格版本 \`${currentPersonality.version}\` 的平均得分为 **${meanScore.toFixed(1)}**。`,
    `请分析以下得分最低或出现人设漂移的典型回合，找出当前人格设定在「台词长度与留白控制」「日常互动与深入交流分寸」「潜变量<OS>到<Action>映射规律」「视角边界（非读心）」或「反OOC负向约束」上的机制漏洞，并输出改进后的人格 \`${nextVersionLabel}\`。`,
    ``,
    `## 严厉的防过拟合与防灾难性遗忘约束 (Anti-Overfitting & Anti-Forgetting Rules — 必须严格遵守！)`,
    `1. **核心锚点不可抹除 (Preserve Core Persona Anchors)**: 无论当前场景多么特殊，绝对禁止删除角色在初始锚点人格中的核心标志（包括核心身份、标志性语气、习惯性动作、基础句长铁律与非读心视角边界）。`,
    `2. **分情境增量调制而非全盘覆盖 (Contextual Modulation, Not Replacement)**: 请用「在日常情境下保持……；而在……情境下则细腻调整为……」的**多情境条件调制句**来扩充规则，严禁一刀切地抹杀角色的既有性格！`,
    `3. **严禁死记硬背当前场景台词 (No Verbatim Quote Memorization)**: 绝对禁止把下方案例中的具体对话原句（targetAction）写进人格规则！特定事件与对话事实只属于 MemoryIndex，不属于 Personality。`,
    `4. **抽象为通用心理学与语言学规律**: 每项数组保留 3～5 条最核心精炼的法则，每条不超过 95 字。`,
    ``,
    `## 当前人格 (${currentPersonality.version})`,
    JSON.stringify(
      {
        coreIdentity: currentPersonality.coreIdentity,
        emotionalDynamics: currentPersonality.emotionalDynamics,
        speechStyleRules: currentPersonality.speechStyleRules,
        cognitiveOSPatterns: currentPersonality.cognitiveOSPatterns,
        behavioralHabits: currentPersonality.behavioralHabits,
        antiOocConstraints: currentPersonality.antiOocConstraints,
      },
      null,
      2,
    ),
    ``,
    `## 本窗口典型失分或漂移案例 (Top Failure / Drift Cases)`,
    JSON.stringify(worstItems, null, 2),
    ``,
    `请严格输出 JSON 对象（不要调用任何工具，不要输出多余解释）：`,
    `{`,
    `  "mutationReason": "一句话总结本次人格更新提炼出的通用机制改进（不含具体剧情/对话剧透）",`,
    `  "coreIdentity": "更新后的核心身份描述（精炼通用）",`,
    `  "emotionalDynamics": ["通用情感规律1", "通用情感规律2", "...(最多4条)"],`,
    `  "speechStyleRules": ["通用语言铁律1", "通用语言铁律2", "...(最多4条)"],`,
    `  "cognitiveOSPatterns": ["通用OS-Action映射规律1", "通用OS-Action映射规律2", "...(最多4条)"],`,
    `  "behavioralHabits": ["通用动作习惯1", "通用动作习惯2", "...(最多4条)"],`,
    `  "antiOocConstraints": ["通用反OOC约束1", "通用反OOC约束2", "...(最多4条)"]`,
    `}`,
  ].join("\n");

  const res = await client.complete(prompt, teacherCallOptions);
  const parsed = extractJsonFromLlm<{
    mutationReason?: string;
    coreIdentity?: string;
    emotionalDynamics?: string[];
    speechStyleRules?: string[];
    cognitiveOSPatterns?: string[];
    behavioralHabits?: string[];
    antiOocConstraints?: string[];
  }>(res.text);

  if (typeof parsed.mutationReason !== "string" || !parsed.mutationReason.trim()) {
    throw new Error("Invalid mutation output: missing non-empty mutationReason");
  }
  const mutationReason = parsed.mutationReason.trim();

  const mergeWithAnchorsAndPrior = (
    anchors: string[],
    prior: string[],
    additions?: string[],
    maxTotal = 6,
  ): string[] => {
    const merged: string[] = [];
    for (const a of anchors) {
      if (typeof a === "string" && a.trim() && !merged.includes(a.trim())) {
        merged.push(a.trim());
      }
    }
    const priorEvolved = prior.filter((r) => !merged.includes(r.trim()));
    for (const p of priorEvolved.slice(-2)) {
      if (typeof p === "string" && p.trim()) {
        merged.push(p.trim());
      }
    }
    if (Array.isArray(additions)) {
      for (const rule of additions) {
        if (typeof rule === "string" && rule.trim() && !merged.includes(rule.trim())) {
          merged.push(rule.trim());
        }
      }
    }
    return merged.slice(0, maxTotal);
  };

  const mutated: CompanionPersonality = {
    version: nextVersionLabel,
    name: currentPersonality.name,
    coreIdentity: anchorPersonality.coreIdentity,
    emotionalDynamics: mergeWithAnchorsAndPrior(
      anchorPersonality.emotionalDynamics.slice(0, 3),
      currentPersonality.emotionalDynamics,
      parsed.emotionalDynamics,
      6,
    ),
    speechStyleRules: mergeWithAnchorsAndPrior(
      anchorPersonality.speechStyleRules,
      currentPersonality.speechStyleRules,
      parsed.speechStyleRules,
      6,
    ),
    cognitiveOSPatterns: mergeWithAnchorsAndPrior(
      anchorPersonality.cognitiveOSPatterns.slice(0, 3),
      currentPersonality.cognitiveOSPatterns,
      parsed.cognitiveOSPatterns,
      6,
    ),
    behavioralHabits: mergeWithAnchorsAndPrior(
      anchorPersonality.behavioralHabits.slice(0, 4),
      currentPersonality.behavioralHabits,
      parsed.behavioralHabits,
      6,
    ),
    antiOocConstraints: mergeWithAnchorsAndPrior(
      anchorPersonality.antiOocConstraints.slice(0, 4),
      currentPersonality.antiOocConstraints,
      parsed.antiOocConstraints,
      6,
    ),
    ...(Array.isArray(anchorPersonality.goldenExemplars) &&
    anchorPersonality.goldenExemplars.length > 0
      ? { goldenExemplars: [...anchorPersonality.goldenExemplars] }
      : Array.isArray(currentPersonality.goldenExemplars) &&
          currentPersonality.goldenExemplars.length > 0
        ? { goldenExemplars: [...currentPersonality.goldenExemplars] }
        : {}),
    mutationHistory: [
      ...currentPersonality.mutationHistory,
      {
        fromVersion: currentPersonality.version,
        toVersion: nextVersionLabel,
        sceneId: scene.sceneId,
        reason: mutationReason,
        scoreBefore: Number(meanScore.toFixed(1)),
      },
    ],
  };

  return {
    mutatedPersonality: mutated,
    mutationReason,
    metrics: res.metrics,
  };
}
