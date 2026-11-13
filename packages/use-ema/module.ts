/**
 * @prism-shadow/use-ema - Penguin Workbench Module Implementation
 *
 * Provides backend routing and API handlers for guiding users to create EMA
 * lifelong AI companions or install personality features using @prism-shadow/ema.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import {
  DEFAULT_EMA_CONFIG,
  DEFAULT_PERSONALITY_FEATURE_CONFIG,
  EMA_AGENT_PRESETS,
  PERSONALITY_FEATURE_PRESETS,
  generateEmaAgent,
  buildEmaSystemPrompt,
  buildEmaAgentsMd,
  buildPersonalityFeaturePrompt,
  installPersonalityFeatureToAgentsMd,
  hasPersonalityFeature,
  validateEmaAgentConfig,
  generatePenguinSystemConfigYaml,
  getAgentPreset,
  getPersonalityPreset,
  installWebWorkbench,
   ensureSharedWorldServer,
  loadEmaGlobalConfig,
  PenguinServerLLMClient,
  type EmaAgentConfig,
  type EmaPersonalityFeatureConfig,
  type WebWorkbenchInstallOptions,
} from "@prism-shadow/ema";

export interface WorkbenchHost {
  listAgents?: () => Array<{ agentId: string }>;
  createSession?: (options?: { agentId?: string }) => Promise<{ sessionId: string }>;
  run?: (
    sessionId: string,
    inputs: Array<{ text: string }>,
  ) => Promise<{ sessionId: string; queued: boolean }>;
  sessionStatus?: (sessionId: string) => string;
  sessionTitle?: (sessionId: string) => null | string;
  sessionResult?: (
    sessionId: string,
  ) => Promise<{ status: "running" | "completed" | "failed"; text: string; error: null | string }>;
  subscribe?: (sessionId: string, listener: (record: unknown) => void) => () => void;
  getState?: () => unknown;
  setState?: (state: unknown) => Promise<void>;
  log?: (text: string) => void;
}

export interface WorkbenchRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  bytes?: Uint8Array;
}

export interface WorkbenchResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  bytes?: Uint8Array;
}

export interface WorkbenchModuleCtx<Use = { host: WorkbenchHost }> {
  use: Use;
  effect?: (dispose: () => void) => void;
}

let personasDirOverride: string | null = null;

export function setPersonasDirOverride(dir: string | null): void {
  personasDirOverride = dir ? path.resolve(dir) : null;
}

export function getPersonasDir(): string {
  const dir = personasDirOverride ?? loadEmaGlobalConfig().personasDir;
  if (!fs.existsSync(dir)) {
    throw new Error(`[EMA Personas Panic] Configured personas_dir does not exist: ${dir}`);
  }
  return dir;
}

export function readAvatarDataUrl(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".webp"
      ? "image/webp"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : "image/png";
  const buf = fs.readFileSync(filePath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export function resolvePersonaAvatarDataUrl(personaPath: string, pkg?: any): string | null {
  const candidates = [
    pkg?.avatar ? path.join(personaPath, pkg.avatar) : "",
    path.join(personaPath, "avatar.png"),
    path.join(personaPath, "avatar.webp"),
    path.join(personaPath, "avatar.jpg"),
  ].filter(Boolean);
  for (const c of candidates) {
    const dataUrl = readAvatarDataUrl(c);
    if (dataUrl) return dataUrl;
  }
  return null;
}

export function getSpeakerAvatarsMap(personasDir = getPersonasDir()): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(personasDir)) return result;
  for (const entry of fs.readdirSync(personasDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fromPersona = resolvePersonaAvatarDataUrl(path.join(personasDir, entry.name));
    if (fromPersona) {
      result[entry.name] = fromPersona;
    }
  }
  return result;
}

export function listPersonas(personasDir = getPersonasDir()) {
  if (!fs.existsSync(personasDir)) {
    return [];
  }
  const entries = fs.readdirSync(personasDir, { withFileTypes: true });
  const personas: Array<{
    id: string;
    name: string;
    fullName?: string;
    description?: string;
    archetype?: string;
    avatarDataUrl?: string | null;
    hasScript: boolean;
    hasConstraints: boolean;
    path: string;
  }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const personaPath = path.join(personasDir, entry.name);
    let pkg: any = {};
    const pkgPath = path.join(personaPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    }
    const personaTomlPath = path.join(personaPath, "persona.toml");
    const scriptIndexPath = path.join(personaPath, "script", "index.toml");
    const scriptChaptersPath = path.join(personaPath, "script", "chapters.toml");

    personas.push({
      id: entry.name,
      name: pkg.name || entry.name,
      fullName: pkg.fullName || pkg.name || entry.name,
      description: pkg.description || "",
      archetype: pkg.archetype || "",
      avatarDataUrl: resolvePersonaAvatarDataUrl(personaPath, pkg),
      hasScript: fs.existsSync(scriptIndexPath) && fs.existsSync(scriptChaptersPath),
      hasConstraints: fs.existsSync(personaTomlPath),
      path: personaPath,
    });
  }

  return personas;
}

export function getPersona(id: string, personasDir = getPersonasDir()) {
  const personaPath = path.join(personasDir, id);
  if (!fs.existsSync(personaPath)) {
    return null;
  }

  const pkgPath = path.join(personaPath, "package.json");
  const personaTomlPath = path.join(personaPath, "persona.toml");
  const scriptIndexPath = path.join(personaPath, "script", "index.toml");
  const scriptChaptersPath = path.join(personaPath, "script", "chapters.toml");
  const scriptAutonomyPath = path.join(personaPath, "script", "autonomy.toml");
  const trainedAgentsMdPath = path.join(personaPath, "AGENTS.md");
  const trainedCheckpointPath = path.join(personaPath, "trained-checkpoint.json");

  const rawPackageJson = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, "utf-8") : "";
  const rawPersonaToml = fs.existsSync(personaTomlPath) ? fs.readFileSync(personaTomlPath, "utf-8") : "";
  const rawIndexToml = fs.existsSync(scriptIndexPath) ? fs.readFileSync(scriptIndexPath, "utf-8") : "";
  const rawChaptersToml = fs.existsSync(scriptChaptersPath) ? fs.readFileSync(scriptChaptersPath, "utf-8") : "";
  const rawAutonomyToml = fs.existsSync(scriptAutonomyPath) ? fs.readFileSync(scriptAutonomyPath, "utf-8") : "";
  const trainedAgentsMd = fs.existsSync(trainedAgentsMdPath) ? fs.readFileSync(trainedAgentsMdPath, "utf-8") : "";

  let trainedSummary: any = null;
  if (fs.existsSync(trainedCheckpointPath)) {
    const ckpt = JSON.parse(fs.readFileSync(trainedCheckpointPath, "utf-8"));
    trainedSummary = {
      version: ckpt.trainedPersonality?.version || "P_1_0",
      epochsCompleted: ckpt.epochsCompleted || 1,
      overallSummary: ckpt.overallSummary,
      dailyTrackSummary: ckpt.dailyTrackSummary,
      autonomyTrackSummary: ckpt.autonomyTrackSummary,
      mutationCount: ckpt.trainedPersonality?.mutationHistory?.length || 0,
      mutationHistory: ckpt.trainedPersonality?.mutationHistory || [],
      retainedMemoryCount: ckpt.retainedMemoryIndex?.length || 0,
      totalMemoryCount: ckpt.allSceneMemoryIndex?.length || 0,
    };
  }

  const parsedPackageJson: any = rawPackageJson ? JSON.parse(rawPackageJson) : null;
  const parsedPersona: any = rawPersonaToml ? parseToml(rawPersonaToml) : null;
  const parsedIndex: any = rawIndexToml ? parseToml(rawIndexToml) : null;
  const parsedChapters: any = rawChaptersToml ? parseToml(rawChaptersToml) : null;
  const parsedAutonomy: any = rawAutonomyToml ? parseToml(rawAutonomyToml) : null;

  return {
    id,
    path: personaPath,
    avatarDataUrl: resolvePersonaAvatarDataUrl(personaPath, parsedPackageJson),
    speakerAvatars: getSpeakerAvatarsMap(personasDir),
    packageJson: rawPackageJson,
    personaToml: rawPersonaToml,
    indexToml: rawIndexToml,
    chaptersToml: rawChaptersToml,
    autonomyToml: rawAutonomyToml,
    trainedAgentsMd,
    trainedSummary,
    parsed: {
      packageJson: parsedPackageJson,
      persona: parsedPersona,
      index: parsedIndex,
      chapters: parsedChapters,
      autonomy: parsedAutonomy,
    },
  };
}

export function updatePersonaAvatar(
  id: string,
  dataUrl: string,
  personasDir = getPersonasDir()
) {
  const personaPath = path.join(personasDir, id);
  if (!fs.existsSync(personaPath)) {
    throw new Error(`Persona '${id}' not found at ${personaPath}`);
  }
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) {
    throw new Error("Invalid avatar dataUrl: expected base64-encoded PNG, JPEG, or WebP");
  }
  const buf = Buffer.from(match[2], "base64");
  if (buf.length > 512 * 1024) {
    throw new Error("Avatar file too large (max 512 KiB)");
  }
  const targetAvatarPath = path.join(personaPath, "avatar.png");
  fs.writeFileSync(targetAvatarPath, buf);

  return {
    success: true,
    id,
    avatarDataUrl: readAvatarDataUrl(targetAvatarPath),
    timestamp: new Date().toISOString(),
  };
}

export function updatePersona(
  id: string,
  data: {
    packageJson?: string;
    personaToml?: string;
    indexToml?: string;
    chaptersToml?: string;
  },
  personasDir = getPersonasDir()
) {
  const personaPath = path.join(personasDir, id);
  if (!fs.existsSync(personaPath)) {
    throw new Error(`Persona '${id}' not found at ${personaPath}`);
  }

  // Validate syntax before writing!
  if (data.packageJson !== undefined) {
    try {
      JSON.parse(data.packageJson);
    } catch (err: any) {
      throw new Error(`Invalid package.json: ${err.message}`);
    }
  }

  if (data.personaToml !== undefined) {
    try {
      parseToml(data.personaToml);
    } catch (err: any) {
      throw new Error(`Invalid persona.toml: ${err.message}`);
    }
  }

  if (data.indexToml !== undefined) {
    try {
      parseToml(data.indexToml);
    } catch (err: any) {
      throw new Error(`Invalid script/index.toml: ${err.message}`);
    }
  }

  if (data.chaptersToml !== undefined) {
    try {
      parseToml(data.chaptersToml);
    } catch (err: any) {
      throw new Error(`Invalid script/chapters.toml: ${err.message}`);
    }
  }

  const updatedFiles: string[] = [];
  const scriptDir = path.join(personaPath, "script");
  if (!fs.existsSync(scriptDir)) {
    fs.mkdirSync(scriptDir, { recursive: true });
  }

  if (data.packageJson !== undefined) {
    fs.writeFileSync(path.join(personaPath, "package.json"), data.packageJson, "utf-8");
    updatedFiles.push("package.json");
  }

  if (data.personaToml !== undefined) {
    fs.writeFileSync(path.join(personaPath, "persona.toml"), data.personaToml, "utf-8");
    updatedFiles.push("persona.toml");
  }

  if (data.indexToml !== undefined) {
    fs.writeFileSync(path.join(scriptDir, "index.toml"), data.indexToml, "utf-8");
    updatedFiles.push("script/index.toml");
  }

  if (data.chaptersToml !== undefined) {
    fs.writeFileSync(path.join(scriptDir, "chapters.toml"), data.chaptersToml, "utf-8");
    updatedFiles.push("script/chapters.toml");
  }

  return {
    success: true,
    id,
    updatedFiles,
    timestamp: new Date().toISOString(),
  };
}

export function appendChapterLine(
  id: string,
  chapterId: string,
  line: {
    type: "dialogue" | "monologue" | "narration" | "choice" | "transition";
    speaker?: string;
    text: string;
  },
  personasDir = getPersonasDir()
) {
  const current = getPersona(id, personasDir);
  if (!current || !current.chaptersToml) {
    throw new Error(`Persona or chapters.toml not found for '${id}'`);
  }

  const parsed = parseToml(current.chaptersToml) as any;
  if (!parsed.chapters || !Array.isArray(parsed.chapters)) {
    throw new Error(`No chapters array found in chapters.toml`);
  }

  const chapter = parsed.chapters.find((c: any) => c.id === chapterId) || parsed.chapters[0];
  if (!chapter) {
    throw new Error(`Chapter '${chapterId}' not found`);
  }

  if (!chapter.lines) chapter.lines = [];
  const nextIndex = chapter.lines.length + 1;
  const globalIndex = nextIndex;

  const newLine = {
    index: nextIndex,
    global_index: globalIndex,
    type: line.type,
    speaker: line.speaker || "",
    text: line.text,
  };

  chapter.lines.push(newLine);
  const updatedToml = stringifyToml(parsed);
  updatePersona(id, { chaptersToml: updatedToml }, personasDir);

  return {
    success: true,
    chapterId: chapter.id,
    addedLine: newLine,
    totalLines: chapter.lines.length,
  };
}

export interface PersonaChatMessage {
  id: string;
  role: "user" | "companion";
  speaker: string;
  os?: string;
  action?: string;
  text: string;
  at: string;
}

export interface PersonaChatSession {
  personaId: string;
  agentId: string;
  sessionId?: string;
  hostSessionId?: string;
  title: string;
  updatedAt: string;
  messages: PersonaChatMessage[];
}

function getDefaultChatSeed(
  personaId: string,
  personasDir = getPersonasDir(),
): PersonaChatSession {
  const persona = getPersona(personaId, personasDir);
  const displayName =
    persona?.parsed?.persona?.persona?.display_name ||
    persona?.parsed?.persona?.persona?.name ||
    personaId;
  const firstDialogue = persona?.parsed?.chapters?.chapters?.[0]?.lines?.find(
    (l: any) => l.type === "dialogue" && l.text,
  );
  const greetingText = firstDialogue?.text
    ? String(firstDialogue.text).replace(/^[「“]+|[」”]+$/g, "")
    : `你好，我是${displayName}。`;

  return {
    personaId,
    agentId: personaId.replace(/-/g, "_"),
    title: `与 ${displayName} 对话`,
    updatedAt: new Date().toISOString(),
    messages: [
      {
        id: "msg_greeting_1",
        role: "companion",
        speaker: personaId,
        text: greetingText,
        at: new Date().toISOString(),
      },
    ],
  };
}

export function getPersonaChatState(
  personaId: string,
  personasDir = getPersonasDir(),
): PersonaChatSession {
  const personaPath = path.join(personasDir, personaId);
  const chatPath = path.join(personaPath, "chat-session.json");
  if (fs.existsSync(chatPath)) {
    const parsed = JSON.parse(fs.readFileSync(chatPath, "utf-8")) as PersonaChatSession;
    if (parsed && Array.isArray(parsed.messages)) {
      return parsed;
    }
  }
  const seed = getDefaultChatSeed(personaId, personasDir);
  if (fs.existsSync(personaPath)) {
    fs.writeFileSync(chatPath, JSON.stringify(seed, null, 2), "utf-8");
  }
  return seed;
}

export function resetPersonaChatState(
  personaId: string,
  personasDir = getPersonasDir(),
): PersonaChatSession {
  const personaPath = path.join(personasDir, personaId);
  const chatPath = path.join(personaPath, "chat-session.json");
  const seed = getDefaultChatSeed(personaId, personasDir);
  if (fs.existsSync(personaPath)) {
    fs.writeFileSync(chatPath, JSON.stringify(seed, null, 2), "utf-8");
  }
  return seed;
}

export function parseCompanionChatReply(rawText: string): {
  os: string;
  action: string;
  text: string;
} {
  const raw = (rawText || "").trim();
  if (!raw) {
    throw new Error("Empty companion chat reply");
  }
  const osMatch = raw.match(/<OS>([\s\S]*?)<\/OS>/i);
  const actionMatch = raw.match(/<Action>([\s\S]*?)<\/Action>/i);

  const os = osMatch
    ? osMatch[1].trim().replace(/^[（(]+|[）)]+$/g, "").trim()
    : "";

  let actionBody = actionMatch
    ? actionMatch[1].trim()
    : raw.replace(/<OS>[\s\S]*?<\/OS>/gi, "").trim();

  let action = "";
  const leadingStageMatch = actionBody.match(/^[（(]([^）)]+)[）)]\s*([\s\S]*)$/);
  if (leadingStageMatch && leadingStageMatch[2].trim()) {
    action = leadingStageMatch[1].trim();
    actionBody = leadingStageMatch[2].trim();
  }

  // Strip outer「...」or “...” quotes while keeping natural inner punctuation
  let text = actionBody
    .replace(/^[「“]+|[」”]+$/g, "")
    .replace(/」\s*「/g, " ")
    .trim();

  if (!text && action) {
    text = `（${action}）`;
    action = "";
  }

  if (!text) {
    throw new Error(`Invalid companion chat reply: missing spoken text in ${raw.slice(0, 120)}`);
  }

  return {
    os,
    action,
    text,
  };
}

export async function sendPersonaChatMessage(
  personaId: string,
  userMessage: string,
  host?: WorkbenchHost,
  personasDir = getPersonasDir(),
): Promise<{
  reply: PersonaChatMessage;
  chat: PersonaChatSession;
}> {
  const chat = getPersonaChatState(personaId, personasDir);
  const persona = getPersona(personaId, personasDir);
  const charName =
    persona?.parsed?.persona?.persona?.display_name ||
    persona?.parsed?.persona?.persona?.name ||
    personaId;
  const nowIso = new Date().toISOString();
  const userMsg: PersonaChatMessage = {
    id: `msg_u_${Date.now()}`,
    role: "user",
    speaker: "player",
    text: userMessage.trim(),
    at: nowIso,
  };
  chat.messages.push(userMsg);

  const recentHistory = chat.messages
    .slice(-12, -1)
    .map((m) => {
      if (m.role === "user") {
        return `【用户】: 「${m.text}」`;
      }
      const osPart = m.os ? `\n【${charName}】(内心OS): （${m.os}）` : "";
      const actPart = m.action ? `（${m.action}）` : "";
      return `${osPart}\n【${charName}】: ${actPart}「${m.text}」`.trim();
    })
    .join("\n");

  const prompt = [
    `## 实时陪伴对话`,
    recentHistory ? `### 近期对话上文\n${recentHistory}\n` : "",
    `### 用户刚刚对你说`,
    `【用户】: 「${userMsg.text}」`,
    ``,
    `请直接回应用户（不调用工具），并严格按以下两行格式输出：`,
    `<OS>你此刻的第一人称内心真实想法（1句话，用“我”自称）</OS>`,
    `<Action>（1句简短的神态或动作描写）你的实际回话台词</Action>`,
  ]
    .filter(Boolean)
    .join("\n");

  let rawModelOutput = "";

  if (host?.createSession && host?.run && host?.sessionResult) {
    if (!chat.hostSessionId) {
      const created = await host.createSession({ agentId: chat.agentId });
      chat.hostSessionId = created.sessionId;
    }
    await host.run(chat.hostSessionId, [{ text: prompt }]);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 350));
      const res = await host.sessionResult(chat.hostSessionId);
      if (res.status === "completed") {
        rawModelOutput = res.text || "";
        break;
      }
      if (res.status === "failed") {
        throw new Error(res.error || "Session task failed");
      }
    }
    if (!rawModelOutput) {
      throw new Error("Host session timed out waiting for completion");
    }
  } else {
    const client = new PenguinServerLLMClient();
    const res = await client.complete(prompt, {
      agentId: chat.agentId,
      provider: "penguin-go",
      modelId: "gemini-3.8-flash",
      thinkingLevel: "low",
    });
    rawModelOutput = res.text;
  }

  const parsed = parseCompanionChatReply(rawModelOutput);
  const replyMsg: PersonaChatMessage = {
    id: `msg_c_${Date.now()}`,
    role: "companion",
    speaker: personaId,
    os: parsed.os,
    action: parsed.action,
    text: parsed.text,
    at: new Date().toISOString(),
  };

  chat.messages.push(replyMsg);
  chat.updatedAt = replyMsg.at;

  const personaPath = path.join(personasDir, personaId);
  if (fs.existsSync(personaPath)) {
    fs.writeFileSync(
      path.join(personaPath, "chat-session.json"),
      JSON.stringify(chat, null, 2),
      "utf-8",
    );
  }

  return {
    reply: replyMsg,
    chat,
  };
}

/**
 * Dispatches an incoming workbench API request.
 */
export async function handleWorkbenchRequest(
  req: WorkbenchRequest,
  host?: WorkbenchHost,
): Promise<WorkbenchResponse> {
  const rawPath = (req.path || "").replace(/\/$/, "");
  const path = rawPath.startsWith("/api") ? rawPath.slice(4) || "/" : rawPath;
  const globalCfg = loadEmaGlobalConfig();

  // Shared EMA World HTTP Router endpoints (/world/*)
  if (path === "/world" || path.startsWith("/world/")) {
    const worldHub = await ensureSharedWorldServer();
    try {
      const qs =
        req.query && Object.keys(req.query).length > 0
          ? `?${new URLSearchParams(req.query).toString()}`
          : "";
      const targetUri = `${path}${qs}`;
      const result = await worldHub.router.read(
        targetUri,
        req.method === "POST" || req.method === "PUT" || req.method === "PATCH"
          ? {
              method: req.method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(req.body ?? {}),
            }
          : { method: req.method || "GET" },
      );
      return {
        status: 200,
        body: result,
      };
    } catch (err: any) {
      const msg = err?.message || String(err);
      const status = msg.startsWith("Route not found:") ? 404 : 500;
      return {
        status,
        body: { error: msg },
      };
    }
  }

  // Health check
  if (req.method === "GET" && (path === "" || path === "/" || path === "/health")) {
    return {
      status: 200,
      body: {
        status: "ok",
        service: "@prism-shadow/use-ema",
        version: "0.1.0",
        mission: "We build lifelong AI companions that grow, remember, and evolve with you.",
        worldServerUrl: globalCfg.world.url,
        worldDataDir: globalCfg.world.dataDir,
      },
    };
  }

  // Retrieve presets
  if (req.method === "GET" && path === "/presets") {
    return {
      status: 200,
      body: {
        agentPresets: EMA_AGENT_PRESETS,
        personalityPresets: PERSONALITY_FEATURE_PRESETS,
        defaultAgentConfig: DEFAULT_EMA_CONFIG,
        defaultPersonalityConfig: DEFAULT_PERSONALITY_FEATURE_CONFIG,
      },
    };
  }

  // List existing agents in Penguin project (if host provides listAgents)
  if (req.method === "GET" && path === "/agents") {
    const agents = host?.listAgents ? host.listAgents() : [];
    return {
      status: 200,
      body: { agents },
    };
  }

  // Generate EMA Companion Agent Prompt & Config
  if (req.method === "POST" && path === "/generate-agent") {
    const body = (req.body || {}) as Partial<EmaAgentConfig>;
    const validation = validateEmaAgentConfig(body);
    if (!validation.valid) {
      return {
        status: 400,
        body: { error: validation.errors.join("; "), errors: validation.errors },
      };
    }

    const generated = generateEmaAgent(body);
    const systemConfigYaml = generatePenguinSystemConfigYaml(body);

    return {
      status: 200,
      body: {
        success: true,
        agent: generated,
        systemConfigYaml,
      },
    };
  }

  // Install EMA Personality Feature into existing AGENTS.md
  if (req.method === "POST" && path === "/install-personality") {
    const body = (req.body || {}) as {
      existingAgentsMd?: string;
      config?: Partial<EmaPersonalityFeatureConfig>;
    };

    const existing = body.existingAgentsMd || "";
    const featureConfig = body.config || {};
    const updatedAgentsMd = installPersonalityFeatureToAgentsMd(existing, featureConfig);
    const featurePrompt = buildPersonalityFeaturePrompt(featureConfig);
    const alreadyHad = hasPersonalityFeature(existing);

    return {
      status: 200,
      body: {
        success: true,
        updatedAgentsMd,
        featurePrompt,
        wasUpdated: alreadyHad,
      },
    };
  }

  // Install Web Companion Portal Workbench into a Penguin Agent
  if (req.method === "POST" && path === "/install-workbench") {
    const body = (req.body || {}) as Partial<WebWorkbenchInstallOptions>;
    if (!body.agentId || typeof body.agentId !== "string") {
      return {
        status: 400,
        body: { error: "Missing required 'agentId' parameter." },
      };
    }
    try {
      const result = installWebWorkbench(body as WebWorkbenchInstallOptions);
      return {
        status: 200,
        body: {
          success: true,
          workbench: result,
        },
      };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  // Quick Preset Generator
  if (req.method === "POST" && path === "/quick-setup") {
    const body = (req.body || {}) as { presetId: string; type: "agent" | "personality" };
    if (body.type === "agent") {
      const preset = getAgentPreset(body.presetId);
      if (!preset) {
        return { status: 404, body: { error: `Preset '${body.presetId}' not found.` } };
      }
      const generated = generateEmaAgent(preset.config);
      const systemConfigYaml = generatePenguinSystemConfigYaml(preset.config);
      return {
        status: 200,
        body: { success: true, preset, agent: generated, systemConfigYaml },
      };
    } else {
      const preset = getPersonalityPreset(body.presetId);
      if (!preset) {
        return { status: 404, body: { error: `Preset '${body.presetId}' not found.` } };
      }
      const featurePrompt = buildPersonalityFeaturePrompt(preset.config);
      return {
        status: 200,
        body: { success: true, preset, featurePrompt },
      };
    }
  }

  // List all personas
  if (req.method === "GET" && path === "/personas") {
    const personas = listPersonas();
    return {
      status: 200,
      body: { personas },
    };
  }

  // Get specific persona details (files + parsed contents)
  if (req.method === "GET" && path === "/persona") {
    const personaId = (req.query?.id || "sakana-chan").trim();
    const persona = getPersona(personaId);
    if (!persona) {
      return {
        status: 404,
        body: { error: `Persona '${personaId}' not found.` },
      };
    }
    return {
      status: 200,
      body: { success: true, persona },
    };
  }

  // Hot update persona files
  if (req.method === "POST" && path === "/persona/update") {
    const body = (req.body || {}) as {
      id?: string;
      packageJson?: string;
      personaToml?: string;
      indexToml?: string;
      chaptersToml?: string;
    };
    if (!body.id) {
      return {
        status: 400,
        body: { error: "Missing required 'id' parameter." },
      };
    }
    try {
      const res = updatePersona(body.id, body);
      return {
        status: 200,
        body: res,
      };
    } catch (err: any) {
      return {
        status: 400,
        body: { error: err.message },
      };
    }
  }

  // Upload / update persona avatar
  if (req.method === "POST" && path === "/persona/avatar") {
    const body = (req.body || {}) as {
      id?: string;
      dataUrl?: string;
    };
    if (!body.id || !body.dataUrl) {
      return {
        status: 400,
        body: { error: "Missing required 'id' or 'dataUrl' parameter." },
      };
    }
    try {
      const res = updatePersonaAvatar(body.id, body.dataUrl);
      return {
        status: 200,
        body: res,
      };
    } catch (err: any) {
      return {
        status: 400,
        body: { error: err.message },
      };
    }
  }

  // Append a dialogue/monologue line to a chapter
  if (req.method === "POST" && path === "/persona/append-line") {
    const body = (req.body || {}) as {
      id?: string;
      chapterId?: string;
      line?: {
        type: "dialogue" | "monologue" | "narration" | "choice" | "transition";
        speaker?: string;
        text: string;
      };
    };
    if (!body.id || !body.line || !body.line.text) {
      return {
        status: 400,
        body: { error: "Missing required 'id' or 'line' parameters." },
      };
    }
    try {
      const res = appendChapterLine(body.id, body.chapterId || "", body.line);
      return {
        status: 200,
        body: res,
      };
    } catch (err: any) {
      return {
        status: 400,
        body: { error: err.message },
      };
    }
  }

  // Get live companion chat state for a persona
  if (req.method === "GET" && path === "/persona/chat") {
    const personaId = (req.query?.id || "sakana-kawaii").trim();
    const chat = getPersonaChatState(personaId);
    return {
      status: 200,
      body: {
        success: true,
        chat,
      },
    };
  }

  // Send message or reset live companion chat for a persona
  if (req.method === "POST" && path === "/persona/chat") {
    const body = (req.body || {}) as {
      id?: string;
      message?: string;
      text?: string;
      reset?: boolean;
      action?: string;
    };
    const personaId = (body.id || "sakana-kawaii").trim();
    if (body.reset || body.action === "reset") {
      const chat = resetPersonaChatState(personaId);
      return {
        status: 200,
        body: {
          success: true,
          chat,
        },
      };
    }
    const msgText = (body.message || body.text || "").trim();
    if (!msgText) {
      return {
        status: 400,
        body: { error: "Missing required 'message' parameter." },
      };
    }
    try {
      const res = await sendPersonaChatMessage(personaId, msgText, host);
      return {
        status: 200,
        body: {
          success: true,
          ...res,
        },
      };
    } catch (err: any) {
      return {
        status: 500,
        body: { error: err.message || String(err) },
      };
    }
  }

  // Default: Route not found
  return {
    status: 404,
    body: {
      error: `Route not found: ${req.method} ${req.path}`,
    },
  };
}

/**
 * Standard Penguin Workbench Module Factory.
 */
export function createWorkbenchModule(ctx: WorkbenchModuleCtx<{ host: WorkbenchHost }>) {
  const host = ctx.use.host;
  void ensureSharedWorldServer();
  return {
    api: {
      main: {
        async handle(req: WorkbenchRequest): Promise<WorkbenchResponse> {
          return handleWorkbenchRequest(req, host);
        },
      },
    },
  };
}

/**
 * Penguin Workbench Package default export.
 */
export default {
  modules: {
    Workbench: {
      create: createWorkbenchModule,
    },
  },
};
