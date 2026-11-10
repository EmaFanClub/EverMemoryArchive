/**
 * @prism-shadow/ema - Generic Companion Personality & MemoryIndex Renderer (RFC-0004 / RFC-0005)
 *
 * Manages:
 * - Loading external personality seed bundles or constructing generic cold-start P_{0,0} templates
 * - Rendering of P_{u,v} + single-level MemoryIndex_{0,x} into `AGENTS.md`
 * - Synchronization with a target Penguin agent (`agent_state/AGENTS.md`)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CompanionPersonality,
  CompressionPromptConfig,
  ExternalPersonaSeedBundle,
  SceneMemoryIndexItem,
} from "./types.js";

/**
 * Creates a generic, character-agnostic cold-start personality template P_{0,0}
 * when no external personality JSON is provided prior to warmup distillation.
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
      `请以「${targetCharacter}」的第一人称视角（「我」），将该场景中的交互轨迹（MemoryItems: <Input, OS, GT_Action>）压缩为一条高密度的单层场景记忆索引（SceneMemoryIndexItem）。`,
      "要求：",
      `1. summary（不超过140字）：浓缩本场景的核心事件、与「${protagonistCharacter}」及在场人物的具体互动细节（包括关键动作、对话冲突、承诺或特殊物品）。`,
      `2. innerOSArc（不超过60字）：提炼本场景中「${targetCharacter}」内心的真实情感波动与潜台词变化（<OS>暗线）。`,
      "3. keyFacts（1～3条短句）：提取后续剧情或对话中必须记住的事实锚点（人物身份、地点设定、重要约定、特殊喜好）。",
    ].join("\n"),
  };
}

/**
 * Formats the single-level In-Context MemoryIndex into a compact Markdown block.
 */
export function formatMemoryIndexMarkdown(memoryIndex: SceneMemoryIndexItem[]): string {
  if (memoryIndex.length === 0) {
    return "（当前尚无已归档的场景记忆，处于初遇/序章阶段。）";
  }

  const lines: string[] = [];
  for (const item of memoryIndex) {
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
 * Renders the complete `AGENTS.md` content for a companion Penguin agent,
 * combining Personality P_{u,v} and single-level In-Context MemoryIndex_{0,x}.
 */
export function renderCompanionAgentsMd(
  personality: CompanionPersonality,
  memoryIndex: SceneMemoryIndexItem[] = [],
  options?: { protagonistName?: string },
): string {
  const protagonist = options?.protagonistName || "对方";
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

---

## 7. 单层情景记忆索引 (In-Context MemoryIndex — 共 ${memoryIndex.length} 个场景记忆)
以下是你（${personality.name}）与${protagonist}共同经历并沉淀的场景记忆索引。在回应${protagonist}或回忆往事时，请自然地调用这些记忆细节与情感脉络，绝不捏造与记忆冲突的经历：

${formatMemoryIndexMarkdown(memoryIndex)}

---

## 8. 对话交互准则 (Interaction Protocol)
- 当用户（默认视作「${protagonist}」）与你日常对话时，直接以 **${personality.name}** 的语气和动作自然回应（无需调用任何文件/终端工具，不要输出任何系统元信息）。
- 除非提示词明确要求你输出训练格式的 \`<OS>...</OS><Action>...</Action>\`（用于训练/评测回合），否则在日常对话中直接输出角色的台词与简短神态动作。
`;
}

/**
 * Synchronizes the given Personality P_{u,v} and MemoryIndex M_{u,v} to the
 * specified Penguin agent's `agent_state/AGENTS.md` (and optionally updates `thinking_level`).
 */
export function syncCompanionAgentState(options: {
  personality: CompanionPersonality;
  memoryIndex: SceneMemoryIndexItem[];
  agentId: string;
  protagonistName?: string;
  appDataDir?: string;
  thinkingLevel?: "low" | "medium" | "high";
}): { agentsMdPath: string; systemConfigPath: string } {
  const agentId = options.agentId;
  const appDataDir =
    options.appDataDir ||
    process.env.PENGUIN_APP_DATA_DIR ||
    path.join(os.homedir(), ".penguin", "data", "default_project");

  const agentStateDir = path.join(appDataDir, "agents", agentId, "agent_state");
  fs.mkdirSync(agentStateDir, { recursive: true });

  const agentsMdPath = path.join(agentStateDir, "AGENTS.md");
  const systemConfigPath = path.join(agentStateDir, "system_config.yaml");

  const mdContent = renderCompanionAgentsMd(options.personality, options.memoryIndex, {
    protagonistName: options.protagonistName,
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
