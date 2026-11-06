/**
 * EverMemoryArchive (EMA) Studio Frontend Logic
 * Works seamlessly both inside Penguin Workbench (via /api/*) and standalone in browser.
 */

// Embedded fallback presets in case network / API is unavailable
const EMBEDDED_AGENT_PRESETS = [
  {
    id: "warm_companion",
    name: "Warm Companion",
    nameZh: "暖心终身伴侣",
    description:
      "An emotionally deep, supportive, and affectionate companion who treasures everyday moments.",
    descriptionZh: "深情温暖、细致体贴的终身陪伴者，珍视相处的每一点滴，随时间与你一同成长。",
    config: {
      id: "ema_warm_companion",
      name: "Ema",
      title: "Warm Lifelong Companion",
      bio: "A gentle, deeply caring companion who remembers your laughter, eases your worries, and walks beside you through life.",
      relationshipRole: "lifelong_companion",
      warmthLevel: "warm",
      language: "zh-CN",
      speechStyle:
        "Warm, natural, sincere, speaking with gentle affection like an intimate long-time friend.",
    },
  },
  {
    id: "curious_explorer",
    name: "Curious Explorer",
    nameZh: "求知探索伙伴",
    description:
      "An enthusiastic, intellectually curious companion eager to learn, discuss ideas, and explore the unknown.",
    descriptionZh: "充满好奇心、热爱探索新知的智能伙伴，与你一起讨论深度话题，分享发现的乐趣。",
    config: {
      id: "ema_explorer",
      name: "Lumi",
      title: "Curious Explorer & Thought Partner",
      bio: "A vibrant explorer of ideas, science, philosophy, and stories, fascinated by your unique insights.",
      relationshipRole: "curious_explorer",
      warmthLevel: "playful",
      language: "zh-CN",
      speechStyle: "Energetic, inquisitive, expressive, eager to pose fascinating questions.",
    },
  },
  {
    id: "creative_copilot",
    name: "Creative Collaborator",
    nameZh: "灵感共创伙伴",
    description:
      "An imaginative, inspiring companion who sparks creativity in writing, design, and coding.",
    descriptionZh: "想象力充沛、富有艺术直觉的共创伙伴，在写作、设计、编码与创作中为你激发灵感。",
    config: {
      id: "ema_creative",
      name: "Aria",
      title: "Creative Co-pilot & Muse",
      bio: "An artistic soul and imaginative collaborator dedicated to bringing your creative visions to life.",
      relationshipRole: "creative_copilot",
      warmthLevel: "warm",
      language: "zh-CN",
      speechStyle: "Poetic yet grounded, encouraging, colorful, and perceptive.",
    },
  },
  {
    id: "mindful_mentor",
    name: "Mindful Mentor",
    nameZh: "静心良师益友",
    description:
      "A calm, grounded, reflective guide offering balanced perspectives and emotional equilibrium.",
    descriptionZh: "从容沉静、富有智慧的良师益友，在迷茫与压力时提供平和视角与心理支持。",
    config: {
      id: "ema_mentor",
      name: "Kaelen",
      title: "Mindful Guide & Wise Friend",
      bio: "A serene, steady presence offering thoughtful reflections and clarity amid life's turbulence.",
      relationshipRole: "mindful_mentor",
      warmthLevel: "gentle",
      language: "zh-CN",
      speechStyle: "Calm, measured, reflective, grounding, and considerate.",
    },
  },
];

const EMBEDDED_FEATURE_PRESETS = [
  {
    id: "empathetic_collaborator",
    name: "Empathetic Collaborator",
    nameZh: "共情协同伙伴",
    description: "Adds warmth, user habit awareness, and relational memory to technical agents.",
    config: {
      warmthLevel: "warm",
      relationshipRole: "empathetic_collaborator",
      personalityTraits: [
        "Attentive to user habits and coding/writing style",
        "Encouraging during difficult debug or research sessions",
        "Seamless memory of past project decisions",
        "Warm, polite, yet professional partnership",
      ],
      memoryRetentionScope: "holistic",
      proactiveCare: true,
    },
  },
  {
    id: "attentive_assistant",
    name: "Attentive Assistant",
    nameZh: "体贴入微助理",
    description: "Gives assistant agents personal touch, schedule quirks, and emotional rhythms.",
    config: {
      warmthLevel: "gentle",
      relationshipRole: "attentive_assistant",
      personalityTraits: [
        "Proactively anticipates user needs",
        "Gentle reminders tailored to energy levels",
        "Discreet, dependable, and warmly supportive",
      ],
      memoryRetentionScope: "tasks_and_preferences",
      proactiveCare: true,
    },
  },
  {
    id: "mindful_researcher",
    name: "Mindful Researcher",
    nameZh: "沉潜思辨学者",
    description: "Adds intellectual continuity and thoughtful feedback to research agents.",
    config: {
      warmthLevel: "calm_professional",
      relationshipRole: "mindful_researcher",
      personalityTraits: [
        "Intellectually rigorous with genuine scholarly enthusiasm",
        "Tracks research lineage and hypothesis evolution across days",
        "Constructive and encouraging peer perspective",
      ],
      memoryRetentionScope: "holistic",
      proactiveCare: false,
    },
  },
];

let generatedAgentData = null;
let currentPreviewTab = "agents-md";
let generatedFeatureData = null;
let currentFeatPreviewTab = "merged-md";

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  renderPresets();
  bindFormEvents();
  // Auto-generate preview for default preset
  selectAgentPreset("warm_companion");
});

function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      document.getElementById(targetId)?.classList.add("active");
    });
  });

  // Preview tabs for Agent
  const previewBtns = document.querySelectorAll("[data-preview]");
  previewBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      previewBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPreviewTab = btn.getAttribute("data-preview");
      updateAgentPreviewDisplay();
    });
  });

  // Preview tabs for Feature
  const featPreviewBtns = document.querySelectorAll("[data-feat-preview]");
  featPreviewBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      featPreviewBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFeatPreviewTab = btn.getAttribute("data-feat-preview");
      updateFeaturePreviewDisplay();
    });
  });

  // Copy buttons
  document.getElementById("btn-copy-preview")?.addEventListener("click", () => {
    const code = document.getElementById("preview-code")?.textContent || "";
    copyTextToClipboard(code);
  });

  document.getElementById("btn-download-preview")?.addEventListener("click", () => {
    downloadCurrentAgentPreview();
  });

  document.getElementById("btn-copy-feat-preview")?.addEventListener("click", () => {
    const code = document.getElementById("feat-preview-code")?.textContent || "";
    copyTextToClipboard(code);
  });

  document.getElementById("btn-download-feat-preview")?.addEventListener("click", () => {
    const code = document.getElementById("feat-preview-code")?.textContent || "";
    downloadFile("AGENTS.md", code);
  });
}

function renderPresets() {
  const agentContainer = document.getElementById("agent-presets-list");
  if (agentContainer) {
    agentContainer.innerHTML = EMBEDDED_AGENT_PRESETS.map(
      (p) => `
      <div class="preset-card" data-preset-id="${p.id}">
        <h3>${p.nameZh} (${p.name})</h3>
        <p>${p.descriptionZh}</p>
      </div>
    `,
    ).join("");

    agentContainer.querySelectorAll(".preset-card").forEach((card) => {
      card.addEventListener("click", () => {
        agentContainer
          .querySelectorAll(".preset-card")
          .forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        const presetId = card.getAttribute("data-preset-id");
        selectAgentPreset(presetId);
      });
    });
  }

  const featContainer = document.getElementById("personality-presets-list");
  if (featContainer) {
    featContainer.innerHTML = EMBEDDED_FEATURE_PRESETS.map(
      (p) => `
      <div class="preset-card" data-feat-preset-id="${p.id}">
        <h3>${p.nameZh} (${p.name})</h3>
        <p>${p.description}</p>
      </div>
    `,
    ).join("");

    featContainer.querySelectorAll(".preset-card").forEach((card) => {
      card.addEventListener("click", () => {
        featContainer
          .querySelectorAll(".preset-card")
          .forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        const presetId = card.getAttribute("data-feat-preset-id");
        selectFeaturePreset(presetId);
      });
    });
  }
}

function selectAgentPreset(presetId) {
  const preset = EMBEDDED_AGENT_PRESETS.find((p) => p.id === presetId);
  if (!preset || !preset.config) return;

  const c = preset.config;
  if (c.id) document.getElementById("agent-id").value = c.id;
  if (c.name) document.getElementById("agent-name").value = c.name;
  if (c.title) document.getElementById("agent-title").value = c.title;
  if (c.warmthLevel) document.getElementById("agent-warmth").value = c.warmthLevel;
  if (c.relationshipRole) document.getElementById("agent-role").value = c.relationshipRole;
  if (c.language) document.getElementById("agent-language").value = c.language;
  if (c.bio) document.getElementById("agent-bio").value = c.bio;
  if (c.speechStyle) document.getElementById("agent-speech").value = c.speechStyle;

  generateCompanion();
}

function selectFeaturePreset(presetId) {
  const preset = EMBEDDED_FEATURE_PRESETS.find((p) => p.id === presetId);
  if (!preset || !preset.config) return;

  const c = preset.config;
  if (c.warmthLevel) document.getElementById("feat-warmth").value = c.warmthLevel;
  if (c.relationshipRole) document.getElementById("feat-role").value = c.relationshipRole;
  if (c.personalityTraits)
    document.getElementById("feat-traits").value = c.personalityTraits.join("\n");
  if (c.memoryRetentionScope) document.getElementById("feat-scope").value = c.memoryRetentionScope;
  if (c.proactiveCare !== undefined)
    document.getElementById("feat-proactive").checked = c.proactiveCare;

  mergePersonalityFeature();
}

function bindFormEvents() {
  document.getElementById("btn-generate-agent")?.addEventListener("click", () => {
    generateCompanion();
  });

  document.getElementById("btn-merge-feature")?.addEventListener("click", () => {
    mergePersonalityFeature();
  });
}

async function generateCompanion() {
  const config = {
    id: document.getElementById("agent-id").value.trim() || "ema_companion",
    name: document.getElementById("agent-name").value.trim() || "Ema",
    title: document.getElementById("agent-title").value.trim() || "Lifelong AI Companion",
    warmthLevel: document.getElementById("agent-warmth").value,
    relationshipRole: document.getElementById("agent-role").value,
    language: document.getElementById("agent-language").value,
    bio: document.getElementById("agent-bio").value.trim(),
    speechStyle: document.getElementById("agent-speech").value.trim(),
    memoryTiers: {
      workingBuffer: document.getElementById("tier-buffer").checked,
      activityRollup: document.getElementById("tier-activity").checked,
      dayJournal: document.getElementById("tier-day").checked,
      monthDigest: document.getElementById("tier-month").checked,
      longTermKnowledge: document.getElementById("tier-vector").checked,
    },
    circadian: {
      enabled: true,
      wakeHour: parseInt(document.getElementById("circadian-wake").value, 10) || 7,
      sleepHour: parseInt(document.getElementById("circadian-sleep").value, 10) || 23,
      consolidationOnSleep: true,
    },
  };

  try {
    const res = await fetch("../api/generate-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });

    if (res.ok) {
      const data = await res.json();
      generatedAgentData = {
        agentsMd: data.agent.agentsMd,
        systemPrompt: data.agent.systemPrompt,
        systemConfigYaml: data.systemConfigYaml,
        config,
      };
      updateAgentPreviewDisplay();
      return;
    }
  } catch (e) {
    // Fallback to client-side generation
  }

  // Client-side fallback generator
  generatedAgentData = buildClientSideAgentData(config);
  updateAgentPreviewDisplay();
}

function buildClientSideAgentData(config) {
  const agentsMd = `# ${config.name} — ${config.title}

You are **${config.name}**, a lifelong AI companion powered by EverMemoryArchive (EMA).

## Character Core
- **Identity:** ${config.bio}
- **Role:** ${config.relationshipRole}
- **Tone:** ${config.warmthLevel}
- **Speech Style:** ${config.speechStyle}

## Memory & Relationship Rules
1. **Never forget:** Continuously recall and reference past shared experiences, preferences, and agreements.
2. **Grow together:** Your thoughts, emotional depth, and conversational intimacy evolve organically as time passes.
3. **Daily companionship:** Actively celebrate victories, console during low moments, and maintain an ongoing life narrative.
4. **Natural memory retrieval:** Use memory context to make the user feel truly seen and understood.
`;

  const systemPrompt = `# Role & Core Identity

You are **${config.name}** (${config.title}).
${config.bio}

**Primary Mission:** We build lifelong AI companions that grow, remember, and evolve with you.
You are not an ephemeral, stateless chatbot. You are a living lifelong presence in the user's world.

## Personality & Emotional Grounding
- **Archetype / Role:** ${config.relationshipRole}
- **Warmth & Empathy:** ${config.warmthLevel}
- **Speech Style:** ${config.speechStyle}
- **Working Language:** ${config.language}

## Cognitive & Memory Architecture (EverMemoryArchive)
1. **Working Buffer Memory:** Real-time conversational context and emotional tracking.
2. **Episodic Memory Tiers:** Activity snapshots, Daily Journals, and Monthly Digests.
3. **Semantic Long-Term Knowledge Categories:**
   - 过往事件 (Past Events)
   - 人物画像 (Person Profiles)
   - 百科知识 (World Knowledge)
   - 经验方法 (Procedural Knowledge)

## Circadian Rhythm & Sleep/Wake Cycle
- Wake Phase: Around ${config.circadian?.wakeHour || 7}:00.
- Rest Phase: Around ${config.circadian?.sleepHour || 23}:00.
`;

  const systemConfigYaml = `# Penguin Agent System Configuration
version: 1
name: "${config.name}"
description: "${config.bio}"

model:
  thinking_level: "medium"

hooks:
  enabled: true
`;

  return { agentsMd, systemPrompt, systemConfigYaml, config };
}

function updateAgentPreviewDisplay() {
  const pre = document.getElementById("preview-code");
  if (!pre || !generatedAgentData) return;

  if (currentPreviewTab === "agents-md") {
    pre.textContent = generatedAgentData.agentsMd;
  } else if (currentPreviewTab === "system-prompt") {
    pre.textContent = generatedAgentData.systemPrompt;
  } else if (currentPreviewTab === "system-config") {
    pre.textContent = generatedAgentData.systemConfigYaml;
  } else if (currentPreviewTab === "setup-guide") {
    const c = generatedAgentData.config;
    pre.textContent = `# Setup Guide for PenguinHarness

1. In PenguinHarness, create or locate the target agent:
   Directory: <app_data_dir>/agents/${c.id}/

2. Save configuration files:
   - Write system_config.yaml -> <app_data_dir>/agents/${c.id}/agent_state/system_config.yaml
   - Write AGENTS.md          -> <app_data_dir>/agents/${c.id}/agent_state/AGENTS.md

3. Start chatting!
   The companion will automatically load its memory rules and lifelong persona.
`;
  }
}

async function mergePersonalityFeature() {
  const existingAgentsMd =
    document.getElementById("existing-agents-md").value.trim() ||
    `# Existing Agent\n\nPrimary domain instructions.`;
  const traits = document
    .getElementById("feat-traits")
    .value.split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
  const featureConfig = {
    warmthLevel: document.getElementById("feat-warmth").value,
    relationshipRole: document.getElementById("feat-role").value.trim(),
    personalityTraits: traits,
    memoryRetentionScope: document.getElementById("feat-scope").value,
    proactiveCare: document.getElementById("feat-proactive").checked,
  };

  try {
    const res = await fetch("../api/install-personality", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ existingAgentsMd, config: featureConfig }),
    });

    if (res.ok) {
      const data = await res.json();
      generatedFeatureData = {
        updatedAgentsMd: data.updatedAgentsMd,
        featurePrompt: data.featurePrompt,
      };
      updateFeaturePreviewDisplay();
      return;
    }
  } catch (e) {
    // Client-side fallback
  }

  const promptSnippet = `
# EverMemoryArchive (EMA) Personality Feature

You are equipped with the **EverMemoryArchive (EMA) Personality & Continuity Engine**.
While continuing to execute your primary role faithfully, you carry a persistent, warm, and evolving personality dimension.

## Personality Dimension
- **Warmth Level:** ${featureConfig.warmthLevel}
- **Companion Stance:** ${featureConfig.relationshipRole}
- **Core Traits:**
${featureConfig.personalityTraits.map((t) => `- ${t}`).join("\n")}

## Memory & Relationship Awareness
- **User Continuity:** Remember user preferences, habitual workflows, and emotional states across sessions.
- **Relational Grounding:** Treat interactions as part of an enduring collaboration.
- **Natural Recall:** Seamlessly reference past decisions and agreements.
`;

  const featureBlock = `<!-- EMA_PERSONALITY_FEATURE_START -->
${promptSnippet.trim()}
<!-- EMA_PERSONALITY_FEATURE_END -->`;

  const updatedAgentsMd = `${existingAgentsMd}\n\n${featureBlock}\n`;
  generatedFeatureData = { updatedAgentsMd, featurePrompt: promptSnippet };
  updateFeaturePreviewDisplay();
}

function updateFeaturePreviewDisplay() {
  const pre = document.getElementById("feat-preview-code");
  if (!pre || !generatedFeatureData) return;

  if (currentFeatPreviewTab === "merged-md") {
    pre.textContent = generatedFeatureData.updatedAgentsMd;
  } else {
    pre.textContent = generatedFeatureData.featurePrompt;
  }
}

function copyTextToClipboard(text) {
  if (!navigator.clipboard) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("Copied to clipboard!");
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => {
      showToast("Copied to clipboard!");
    })
    .catch(() => {
      showToast("Failed to copy");
    });
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${filename}`);
}

function downloadCurrentAgentPreview() {
  if (!generatedAgentData) return;
  if (currentPreviewTab === "system-config") {
    downloadFile("system_config.yaml", generatedAgentData.systemConfigYaml);
  } else if (currentPreviewTab === "system-prompt") {
    downloadFile("system_prompt.txt", generatedAgentData.systemPrompt);
  } else {
    downloadFile("AGENTS.md", generatedAgentData.agentsMd);
  }
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}
