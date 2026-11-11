/**
 * EverMemoryArchive (EMA) Studio Frontend Logic
 */

let agentPresets = [];
let personalityPresets = [];
let generatedAgentData = null;
let currentPreviewTab = "agents-md";
let generatedFeatureData = null;
let currentFeatPreviewTab = "merged-md";

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  bindFormEvents();
  initPersonaStudio();
  await loadPresets();
});

async function loadPresets() {
  const res = await fetch("../api/presets");
  if (!res.ok) {
    showToast(`加载预设失败: ${res.statusText}`);
    return;
  }
  const data = await res.json();
  agentPresets = data.agentPresets || [];
  personalityPresets = data.personalityPresets || [];
  renderPresets();
  if (agentPresets.length > 0) {
    selectAgentPreset(agentPresets[0].id);
  }
}

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
    agentContainer.innerHTML = agentPresets.map(
      (p) => `
      <div class="preset-card" data-preset-id="${p.id}">
        <h3>${p.nameZh || p.name} (${p.name})</h3>
        <p>${p.descriptionZh || p.description}</p>
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
    featContainer.innerHTML = personalityPresets.map(
      (p) => `
      <div class="preset-card" data-feat-preset-id="${p.id}">
        <h3>${p.nameZh || p.name} (${p.name})</h3>
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
  const preset = agentPresets.find((p) => p.id === presetId);
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
  const preset = personalityPresets.find((p) => p.id === presetId);
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
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    generatedAgentData = {
      agentsMd: data.agent.agentsMd,
      systemPrompt: data.agent.systemPrompt,
      systemConfigYaml: data.systemConfigYaml,
      config,
    };
    updateAgentPreviewDisplay();
  } catch (err) {
    showToast(`生成 Companion 配置失败: ${err.message}`);
  }
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
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    generatedFeatureData = {
      updatedAgentsMd: data.updatedAgentsMd,
      featurePrompt: data.featurePrompt,
    };
    updateFeaturePreviewDisplay();
  } catch (err) {
    showToast(`安装人格特性失败: ${err.message}`);
  }
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

/* ==========================================================================
   Persona Studio & Playscript Logic (Hot Update)
   ========================================================================== */

let currentPersonaId = "sakana-kawaii";
let currentPersonaData = null;
let currentChatMessages = [];
let isChatSending = false;

function initPersonaStudio() {
  // Subtabs switching
  const subtabBtns = document.querySelectorAll(".subtab-btn");
  subtabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      subtabBtns.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".subtab-content").forEach((c) => {
        c.classList.remove("active");
        c.style.display = "none";
      });

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-subtab");
      const target = document.getElementById(targetId);
      if (target) {
        target.classList.add("active");
        target.style.display = "block";
      }
    });
  });

  document.getElementById("btn-refresh-personas")?.addEventListener("click", () => {
    loadPersonasList();
  });

  document.getElementById("persona-select")?.addEventListener("change", (e) => {
    currentPersonaId = e.target.value;
    loadPersonaDetails(currentPersonaId);
    loadLiveChatState(currentPersonaId);
  });

  document.querySelectorAll("[data-persona-switch]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-persona-switch");
      if (!targetId) return;
      currentPersonaId = targetId;
      const select = document.getElementById("persona-select");
      if (select) select.value = targetId;
      loadPersonaDetails(currentPersonaId);
      loadLiveChatState(currentPersonaId);
    });
  });

  document.getElementById("btn-save-persona")?.addEventListener("click", () => {
    savePersonaHotUpdate();
  });

  document.getElementById("btn-quick-append")?.addEventListener("click", () => {
    appendQuickLine();
  });

  // Live Chat bindings
  document.getElementById("btn-chat-send")?.addEventListener("click", () => {
    sendLiveChatMessage();
  });
  document.getElementById("chat-user-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendLiveChatMessage();
    }
  });
  document.getElementById("btn-chat-reset")?.addEventListener("click", () => {
    resetLiveChat();
  });
  document.getElementById("chat-toggle-os")?.addEventListener("change", () => {
    renderLiveChatMessages();
  });
  document.querySelectorAll(".chat-quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const promptText = btn.getAttribute("data-prompt") || "";
      const inputEl = document.getElementById("chat-user-input");
      if (inputEl && promptText) {
        inputEl.value = promptText;
        sendLiveChatMessage();
      }
    });
  });

  const avatarInput = document.getElementById("avatar-file-input");
  const triggerAvatarUpload = () => {
    avatarInput?.click();
  };
  document.getElementById("btn-upload-avatar")?.addEventListener("click", triggerAvatarUpload);
  document.getElementById("summary-persona-avatar")?.addEventListener("click", triggerAvatarUpload);
  avatarInput?.addEventListener("change", handleAvatarFileUpload);

  // Track edits in textarea to update status indicator
  ["editor-chapters-toml", "editor-persona-toml", "editor-index-toml"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => {
      setPersonaStatus("editing", "● 有未保存修改 (点击保存并热更新)");
    });
  });

  loadPersonasList();
}

function setPersonaStatus(type, message) {
  const statusEl = document.getElementById("persona-status");
  if (!statusEl) return;
  statusEl.className = "status-indicator " + (
    type === "synced" ? "status-synced" :
    type === "error" ? "status-error" :
    type === "saving" ? "status-saving" : "status-error"
  );
  statusEl.textContent = message;
}

function showPersonaError(msg) {
  const banner = document.getElementById("persona-error-banner");
  if (!banner) return;
  if (msg) {
    banner.textContent = msg;
    banner.style.display = "block";
  } else {
    banner.textContent = "";
    banner.style.display = "none";
  }
}

async function loadPersonasList() {
  try {
    const res = await fetch("../api/personas");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const select = document.getElementById("persona-select");
    if (select && data.personas && data.personas.length) {
      select.innerHTML = data.personas.map((p) => `
        <option value="${p.id}" ${p.id === currentPersonaId ? "selected" : ""}>
          ${p.fullName || p.name} (${p.id})
        </option>
      `).join("");
      if (!data.personas.some(p => p.id === currentPersonaId)) {
        currentPersonaId = data.personas[0].id;
      }
      loadPersonaDetails(currentPersonaId);
      loadLiveChatState(currentPersonaId);
    }
  } catch (err) {
    showPersonaError(`加载 Persona 列表失败: ${err.message}`);
    setPersonaStatus("error", "● 加载列表失败");
  }
}

async function loadPersonaDetails(personaId) {
  showPersonaError(null);
  setPersonaStatus("saving", "● 正在加载...");
  try {
    const res = await fetch(`../api/persona?id=${encodeURIComponent(personaId)}`);
    if (!res.ok) throw new Error(`Failed to load persona: ${res.statusText}`);
    const data = await res.json();
    if (!data.persona) throw new Error("No persona returned");
    currentPersonaData = data.persona;

    // Populate Editors
    const edChapters = document.getElementById("editor-chapters-toml");
    const edPersona = document.getElementById("editor-persona-toml");
    const edIndex = document.getElementById("editor-index-toml");
    const edTrained = document.getElementById("editor-trained-agents-md");
    if (edChapters) edChapters.value = currentPersonaData.chaptersToml || "";
    if (edPersona) edPersona.value = currentPersonaData.personaToml || "";
    if (edIndex) edIndex.value = currentPersonaData.indexToml || "";
    if (edTrained) edTrained.value = currentPersonaData.trainedAgentsMd || "";

    const pathChapters = document.getElementById("code-path-chapters");
    const pathPersona = document.getElementById("code-path-persona");
    const pathIndex = document.getElementById("code-path-index");
    const pathTrained = document.getElementById("code-path-trained-agents");
    if (pathChapters) pathChapters.textContent = `personas/${currentPersonaId}/script/chapters.toml`;
    if (pathPersona) pathPersona.textContent = `personas/${currentPersonaId}/persona.toml`;
    if (pathIndex) pathIndex.textContent = `personas/${currentPersonaId}/script/index.toml`;
    if (pathTrained) pathTrained.textContent = `personas/${currentPersonaId}/AGENTS.md`;

    const trainedMetricsEl = document.getElementById("trained-metrics-summary");
    if (trainedMetricsEl && currentPersonaData.trainedSummary) {
      const ts = currentPersonaData.trainedSummary;
      const ov = ts.overallSummary || {};
      const au = ts.autonomyTrackSummary || {};
      trainedMetricsEl.textContent = `${ts.version} (Epoch ${ts.epochsCompleted}) · 综合得分 ${ov.initialMeanScore} → ${ov.finalMeanScore} (OS ${ov.meanOsScore} / Action ${ov.meanActionScore}) · 自主性专项 ${au.finalMeanScore} · RSI 演进 ${ts.mutationCount} 步 · 保留同温层记忆 ${ts.retainedMemoryCount}/${ts.totalMemoryCount} 幕`;
    }

    document.querySelectorAll("[data-persona-switch]").forEach((btn) => {
      const isMatch = btn.getAttribute("data-persona-switch") === currentPersonaId;
      btn.style.borderColor = isMatch ? "#38bdf8" : "";
      btn.style.color = isMatch ? "#38bdf8" : "";
    });

    // Populate Overview Cards
    const parsedPersona = currentPersonaData.parsed?.persona || {};
    const parsedIndex = currentPersonaData.parsed?.index || {};
    const parsedChapters = currentPersonaData.parsed?.chapters || {};

    const nameEl = document.getElementById("summary-persona-name");
    const descEl = document.getElementById("summary-persona-desc");
    const badgeEl = document.getElementById("persona-badge");
    const chapterCountEl = document.getElementById("summary-chapter-count");
    const chapterNameEl = document.getElementById("summary-chapter-name");
    const lineCountEl = document.getElementById("summary-line-count");
    const invariantCountEl = document.getElementById("summary-invariant-count");

    if (nameEl) nameEl.textContent = parsedPersona.persona?.display_name || currentPersonaId;
    if (descEl) descEl.textContent = parsedPersona.persona?.summary || "人格靠剧情演出约束";
    if (badgeEl) badgeEl.textContent = parsedPersona.persona?.archetype || "persona";

    const profileAvatarEl = document.getElementById("summary-persona-avatar");
    const activeAvatarUrl = currentPersonaData.avatarDataUrl || "";
    if (profileAvatarEl) {
      if (activeAvatarUrl) {
        profileAvatarEl.src = activeAvatarUrl;
        profileAvatarEl.style.display = "";
      } else {
        profileAvatarEl.style.display = "none";
      }
    }
    const chatHeaderAvatar = document.getElementById("chat-header-avatar");
    if (chatHeaderAvatar) {
      if (activeAvatarUrl) {
        chatHeaderAvatar.src = activeAvatarUrl;
        chatHeaderAvatar.style.display = "";
      } else {
        chatHeaderAvatar.style.display = "none";
      }
    }
    const chatNameEl = document.getElementById("chat-companion-name");
    if (chatNameEl) {
      chatNameEl.textContent =
        parsedPersona.persona?.display_name || parsedPersona.persona?.name || currentPersonaId;
    }
    const chatSubEl = document.getElementById("chat-companion-subtitle");
    if (chatSubEl && currentPersonaData.trainedSummary) {
      const ts = currentPersonaData.trainedSummary;
      const ov = ts.overallSummary || {};
      chatSubEl.textContent = `${ts.version} · 综合得分 ${ov.initialMeanScore} → ${ov.finalMeanScore} · 已保留相遇前同温层记忆 (Ch 1–5) · 实时推理驱动`;
    }
    const btnClassicAvatar = document.getElementById("btn-avatar-classic");
    if (btnClassicAvatar) {
      if (currentPersonaData.speakerAvatars?.["sakana-chan"]) {
        btnClassicAvatar.src = currentPersonaData.speakerAvatars["sakana-chan"];
        btnClassicAvatar.style.display = "";
      } else {
        btnClassicAvatar.style.display = "none";
      }
    }
    const btnKawaiiAvatar = document.getElementById("btn-avatar-kawaii");
    if (btnKawaiiAvatar) {
      if (currentPersonaData.speakerAvatars?.["sakana-kawaii"]) {
        btnKawaiiAvatar.src = currentPersonaData.speakerAvatars["sakana-kawaii"];
        btnKawaiiAvatar.style.display = "";
      } else {
        btnKawaiiAvatar.style.display = "none";
      }
    }

    const chapters = [
      ...(parsedChapters.chapters || []),
      ...(currentPersonaData.parsed?.autonomy?.chapters || []),
    ];
    if (chapterCountEl) chapterCountEl.textContent = `${chapters.length} 幕`;
    if (chapterNameEl && chapters[0]) chapterNameEl.textContent = chapters[0].title || "";

    const totalLines = chapters.reduce((sum, ch) => sum + (ch.lines?.length || 0), 0);
    if (lineCountEl) lineCountEl.textContent = `${totalLines} 行`;

    const invariants = Object.keys(parsedPersona.invariants || {}).length;
    if (invariantCountEl) invariantCountEl.textContent = `${invariants} 条严格约束`;

    // Render Stage Preview
    const combinedChapters = {
      chapters: [
        ...(parsedChapters.chapters || []),
        ...(currentPersonaData.parsed?.autonomy?.chapters || []),
      ],
    };
    renderStagePreview(combinedChapters);
    setPersonaStatus("synced", "● 已同步 (persona branch)");
  } catch (err) {
    showPersonaError(`加载 Persona 失败: ${err.message}`);
    setPersonaStatus("error", "● 加载失败");
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let currentChapterId = "__all__";

function getSpeakerAvatarUrl(speaker) {
  const spLower = (speaker || "").toLowerCase();
  const isCompanion = !speaker || spLower === currentPersonaId.toLowerCase() || spLower.includes("sakana") || speaker.includes("鱼");
  const speakerAvatars = currentPersonaData?.speakerAvatars || {};
  if (isCompanion) {
    return currentPersonaData?.avatarDataUrl || speakerAvatars[currentPersonaId] || "";
  }
  return speakerAvatars[spLower] || "";
}

function renderSpeakerAvatarInnerHtml(speaker, avatarUrl) {
  if (avatarUrl) {
    return `<img class="speaker-avatar-img" src="${avatarUrl}" alt="${escapeHtml(speaker)}">`;
  }
  const initial = (speaker || "C").trim().slice(0, 1);
  return `<span>${escapeHtml(initial)}</span>`;
}

function renderChapterLinesHtml(chapter) {
  const lines = chapter.lines || [];
  const scopeBadge = chapter.memory_scope
    ? `<span class="badge badge-archetype" style="margin-left: 8px; font-size: 0.72rem;">${escapeHtml(chapter.memory_scope)}</span>`
    : "";
  const headerHtml = `
    <div class="stage-line line-transition" style="margin-top: 12px; margin-bottom: 8px;">
      <span class="transition-text" style="font-weight: 700;">${escapeHtml(chapter.title || chapter.id)} — ${escapeHtml(chapter.setting_time || "")} (${lines.length} 句)${scopeBadge}</span>
    </div>
  `;
  const linesHtml = lines.map((line) => {
    const type = line.type || "dialogue";
    const speaker = line.speaker || "";
    const text = escapeHtml(line.text || "");

    if (type === "transition") {
      return `
        <div class="stage-line line-transition">
          <span class="transition-text">${text}</span>
        </div>
      `;
    } else if (type === "narration") {
      return `
        <div class="stage-line line-narration">
          <div class="narration-text">${text}</div>
        </div>
      `;
    } else if (type === "monologue") {
      const avatarUrl = getSpeakerAvatarUrl(speaker || currentPersonaId);
      return `
        <div class="stage-line line-monologue">
          <div class="speaker-avatar avatar-fish" title="${escapeHtml(speaker || currentPersonaId)}">
            ${renderSpeakerAvatarInnerHtml(speaker || currentPersonaId, avatarUrl)}
          </div>
          <div class="bubble bubble-monologue">
            <div class="bubble-speaker">${escapeHtml(speaker || currentPersonaId)} <span class="bubble-type-tag">内心独白 (&lt;OS&gt;)</span></div>
            <div class="bubble-text">${text}</div>
          </div>
        </div>
      `;
    } else if (type === "choice") {
      return `
        <div class="stage-line line-choice">
          <div class="choice-box">${text}</div>
        </div>
      `;
    } else {
      const spLower = speaker.toLowerCase();
      const isSakana = spLower.includes("sakana") || speaker.includes("鱼");
      const avatarUrl = getSpeakerAvatarUrl(speaker);
      const avatarClass = isSakana ? "avatar-fish" : "avatar-player";
      const bubbleClass = isSakana ? "bubble-sakana" : "bubble-player";

      return `
        <div class="stage-line line-dialogue ${isSakana ? 'align-left' : 'align-right'}">
          <div class="speaker-avatar ${avatarClass}" title="${escapeHtml(speaker)}">
            ${renderSpeakerAvatarInnerHtml(speaker, avatarUrl)}
          </div>
          <div class="bubble ${bubbleClass}">
            <div class="bubble-speaker">${escapeHtml(speaker)}</div>
            <div class="bubble-text">${text}</div>
          </div>
        </div>
      `;
    }
  }).join("");
  return headerHtml + linesHtml;
}

function renderStagePreview(chaptersData) {
  const container = document.getElementById("stage-lines-container");
  if (!container) return;

  if (!chaptersData || !chaptersData.chapters || !chaptersData.chapters.length) {
    container.innerHTML = `<div class="empty-stage" style="text-align: center; color: #8b949e; padding: 2rem;">暂无剧本章节数据</div>`;
    return;
  }

  const chapters = chaptersData.chapters;
  const chapterSelect = document.getElementById("stage-chapter-select");
  if (chapterSelect) {
    const totalLines = chapters.reduce((s, c) => s + (c.lines?.length || 0), 0);
    const optionsHtml = [
      `<option value="__all__" ${currentChapterId === "__all__" ? "selected" : ""}>全部 ${chapters.length} 幕完整连播 (共 ${totalLines} 句)</option>`,
      ...chapters.map((ch) => {
        const count = ch.lines?.length || 0;
        const scope = ch.memory_scope ? ` [${ch.memory_scope}]` : "";
        return `<option value="${ch.id}" ${ch.id === currentChapterId ? "selected" : ""}>${escapeHtml(ch.title)} (${count}句)${scope}</option>`;
      }),
    ].join("");
    chapterSelect.innerHTML = optionsHtml;
    if (!chapterSelect.dataset.bound) {
      chapterSelect.dataset.bound = "true";
      chapterSelect.addEventListener("change", (e) => {
        currentChapterId = e.target.value;
        renderStagePreview({
          chapters: [
            ...(currentPersonaData?.parsed?.chapters?.chapters || []),
            ...(currentPersonaData?.parsed?.autonomy?.chapters || []),
          ],
        });
      });
    }
  }

  const titleEl = document.getElementById("stage-chapter-title");
  const timeEl = document.getElementById("stage-setting-time");

  if (currentChapterId === "__all__") {
    if (titleEl) titleEl.textContent = `全部 ${chapters.length} 幕`;
    if (timeEl) timeEl.textContent = `共 ${chapters.length} 幕 · ${chapters.reduce((s, c) => s + (c.lines?.length || 0), 0)} 句原子剧本`;
    container.innerHTML = chapters.map((ch) => renderChapterLinesHtml(ch)).join("");
  } else {
    const chapter = chapters.find((c) => c.id === currentChapterId) || chapters[0];
    if (titleEl) titleEl.textContent = chapter.title || "第一幕";
    if (timeEl) timeEl.textContent = `${chapter.setting_time || ""} (${chapter.memory_scope || "script"})`;
    container.innerHTML = renderChapterLinesHtml(chapter);
  }

  container.scrollTop = 0;
}

async function savePersonaHotUpdate() {
  showPersonaError(null);
  setPersonaStatus("saving", "● 正在保存并热更新...");

  const payload = {
    id: currentPersonaId,
    personaToml: document.getElementById("editor-persona-toml")?.value,
    chaptersToml: document.getElementById("editor-chapters-toml")?.value,
    indexToml: document.getElementById("editor-index-toml")?.value,
  };

  try {
    const res = await fetch("../api/persona/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Save failed");
    }

    const now = new Date().toLocaleTimeString();
    setPersonaStatus("synced", `● 热更新成功 (${now})`);
    showToast(`Persona 热更新成功！(${now})`);

    // Reload details to sync preview
    loadPersonaDetails(currentPersonaId);
  } catch (err) {
    showPersonaError(`保存/热更新失败: ${err.message}`);
    setPersonaStatus("error", "● 语法或格式错误");
  }
}

async function appendQuickLine() {
  const type = document.getElementById("quick-line-type")?.value || "dialogue";
  const speaker = document.getElementById("quick-speaker")?.value.trim() || "";
  const textInput = document.getElementById("quick-line-text");
  const text = textInput ? textInput.value.trim() : "";

  if (!text) {
    showToast("请输入台词内容");
    return;
  }

  showPersonaError(null);
  setPersonaStatus("saving", "● 正在追加台词...");

  try {
    const res = await fetch("../api/persona/append-line", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: currentPersonaId,
        chapterId: currentChapterId !== "__all__" ? currentChapterId : "chapter_01",
        line: { type, speaker, text },
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Append failed");

    if (textInput) textInput.value = "";
    showToast("台词已追加并热重载！");
    loadPersonaDetails(currentPersonaId);
  } catch (err) {
    showPersonaError(`追加失败: ${err.message}`);
    setPersonaStatus("error", "● 追加失败");
  }
}

async function handleAvatarFileUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 512 * 1024) {
    showPersonaError("头像文件过大，请上传小于 512 KB 的 PNG / JPEG / WebP 图片");
    e.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = String(reader.result || "");
    showPersonaError(null);
    setPersonaStatus("saving", "● 正在上传头像...");
    try {
      const res = await fetch("../api/persona/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: currentPersonaId, dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      showToast("角色头像已更新！");
      loadPersonaDetails(currentPersonaId);
    } catch (err) {
      showPersonaError(`头像上传失败: ${err.message}`);
      setPersonaStatus("error", "● 头像上传失败");
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsDataURL(file);
}

/* ==========================================================================
   Live Chat WebUI Logic
   ========================================================================== */

async function loadLiveChatState(personaId) {
  try {
    const res = await fetch(`../api/persona/chat?id=${encodeURIComponent(personaId)}`);
    if (!res.ok) throw new Error("Failed to load chat state");
    const data = await res.json();
    currentChatMessages = data.chat?.messages || [];
    renderLiveChatMessages();
  } catch (err) {
    console.warn("Failed to load live chat state:", err);
  }
}

function renderLiveChatMessages() {
  const streamEl = document.getElementById("chat-messages-stream");
  if (!streamEl) return;

  const showOs = document.getElementById("chat-toggle-os")?.checked !== false;
  const companionSpeakerName =
    currentPersonaData?.parsed?.persona?.persona?.display_name ||
    currentPersonaData?.parsed?.persona?.persona?.name ||
    currentPersonaId;
  const companionAvatar = getSpeakerAvatarUrl(currentPersonaId);
  const playerAvatar = getSpeakerAvatarUrl("player");

  const html = currentChatMessages
    .map((msg) => {
      const spokenText = msg.text || msg.spoken || "";
      if (msg.role === "user") {
        return `
          <div class="stage-line line-dialogue align-right">
            <div class="speaker-avatar avatar-player" title="用户">
              ${renderSpeakerAvatarInnerHtml("用户", playerAvatar)}
            </div>
            <div class="bubble bubble-player">
              <div class="bubble-speaker">用户</div>
              <div class="chat-spoken-text">${escapeHtml(spokenText)}</div>
            </div>
          </div>
        `;
      } else {
        const osHtml =
          showOs && msg.os
            ? `<div class="chat-os-thought"><span class="chat-os-tag">&lt;OS 内心独白&gt;</span>${escapeHtml(msg.os)}</div>`
            : "";
        const actionHtml = msg.action
          ? `<div class="chat-action-stage">${escapeHtml(msg.action)}</div>`
          : "";
        return `
          <div class="stage-line line-dialogue align-left">
            <div class="speaker-avatar avatar-fish" title="${escapeHtml(companionSpeakerName)}">
              ${renderSpeakerAvatarInnerHtml(companionSpeakerName, companionAvatar)}
            </div>
            <div class="bubble bubble-sakana">
              <div class="bubble-speaker">${escapeHtml(companionSpeakerName)}</div>
              ${osHtml}
              ${actionHtml}
              <div class="chat-spoken-text">${escapeHtml(spokenText)}</div>
            </div>
          </div>
        `;
      }
    })
    .join("");

  const typingHtml = isChatSending
    ? `
      <div class="stage-line line-dialogue align-left">
        <div class="speaker-avatar avatar-fish">
          ${renderSpeakerAvatarInnerHtml(companionSpeakerName, companionAvatar)}
        </div>
        <div class="bubble bubble-sakana">
          <div class="bubble-speaker">${escapeHtml(companionSpeakerName)}</div>
          <div class="chat-action-stage">（正在认真倾听并组织语言……）</div>
        </div>
      </div>
    `
    : "";

  streamEl.innerHTML = html + typingHtml;
  streamEl.scrollTop = streamEl.scrollHeight;
}

async function sendLiveChatMessage() {
  if (isChatSending) return;
  const inputEl = document.getElementById("chat-user-input");
  const sendBtn = document.getElementById("btn-chat-send");
  const text = inputEl ? inputEl.value.trim() : "";
  if (!text) return;

  isChatSending = true;
  if (inputEl) inputEl.value = "";
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = "思考中...";
  }

  // Optimistic append
  currentChatMessages.push({
    id: `temp-${Date.now()}`,
    role: "user",
    speaker: "主人",
    spoken: text,
    createdAt: new Date().toISOString(),
  });
  renderLiveChatMessages();

  try {
    const res = await fetch("../api/persona/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: currentPersonaId,
        message: text,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Chat request failed");
    currentChatMessages = data.chat?.messages || currentChatMessages;
  } catch (err) {
    showPersonaError(`对话请求失败: ${err.message}`);
  } finally {
    isChatSending = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = "发送消息";
    }
    renderLiveChatMessages();
  }
}

async function resetLiveChat() {
  if (isChatSending) return;
  try {
    const res = await fetch("../api/persona/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: currentPersonaId,
        action: "reset",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Reset failed");
    currentChatMessages = data.chat?.messages || [];
    renderLiveChatMessages();
    showToast("对话已重置为初始问候状态！");
  } catch (err) {
    showPersonaError(`重置对话失败: ${err.message}`);
  }
}

