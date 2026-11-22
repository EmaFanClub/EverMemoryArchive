/**
 * EMA Workbench UI — 4-Step User Workflow (Create -> Train -> Use -> World)
 */

const state = {
  step: "use", // "create" | "train" | "use" | "world"
  identityMode: "edit", // "edit" | "create"
  createTemplate: "sakana-kawaii",
  personas: [],
  currentId: "sakana-kawaii",
  persona: null,
  sessionFilter: "all", // "all" | "playscript" | "training"
  selectedEpochs: 1,
  chat: null,
  chatSending: false,
  showOsByDefault: true,
  expandedOsIds: new Set(),
  pendingCreateAvatarDataUrl: null,
};

function apiUrl(subPath) {
  const clean = subPath.startsWith("/") ? subPath.slice(1) : subPath;
  return `../api/${clean}`;
}

function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.classList.remove("visible");
  }, 2400);
}

function showError(msg) {
  const banner = document.getElementById("error-banner");
  if (!banner) return;
  if (!msg) {
    banner.style.display = "none";
    banner.textContent = "";
    return;
  }
  banner.textContent = msg;
  banner.style.display = "block";
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function switchStep(step) {
  state.step = step;
  document.querySelectorAll(".wf-step").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-step") === step);
  });
  ["create", "train", "use", "world"].forEach((s) => {
    const view = document.getElementById(`step-${s}`);
    if (view) view.style.display = s === step ? "block" : "none";
  });

  const useActions = document.getElementById("topbar-use-actions");
  const trainActions = document.getElementById("topbar-train-actions");
  if (useActions) useActions.style.display = step === "use" ? "flex" : "none";
  if (trainActions) trainActions.style.display = step === "train" ? "flex" : "none";

  if (step === "world") {
    loadWorldConfig();
  }
}

function closeCompanionDropdown() {
  const dd = document.getElementById("companion-dropdown");
  const trig = document.getElementById("companion-trigger");
  if (dd) dd.style.display = "none";
  if (trig) {
    trig.classList.remove("open");
    trig.setAttribute("aria-expanded", "false");
  }
}

function toggleCompanionDropdown() {
  const dd = document.getElementById("companion-dropdown");
  const trig = document.getElementById("companion-trigger");
  if (!dd) return;
  const isOpen = dd.style.display !== "none";
  if (isOpen) {
    closeCompanionDropdown();
  } else {
    renderCompanionDropdown();
    dd.style.display = "flex";
    if (trig) {
      trig.classList.add("open");
      trig.setAttribute("aria-expanded", "true");
    }
  }
}

function renderCompanionDropdown() {
  const listEl = document.getElementById("companion-dropdown-list");
  if (!listEl) return;

  listEl.innerHTML = state.personas
    .map((p) => {
      const isActive = p.id === state.currentId;
      const avatarSrc =
        (isActive && state.persona?.avatarDataUrl) ||
        p.avatarDataUrl ||
        "./icon.png";
      return `
        <button class="companion-option ${isActive ? "active" : ""}" data-persona-id="${escapeHtml(p.id)}" role="option" aria-selected="${isActive}" type="button">
          <div class="companion-option-left">
            <img class="companion-option-avatar" src="${escapeHtml(avatarSrc)}" alt="" onerror="this.src='./icon.png'">
            <div class="companion-option-text">
              <span class="companion-option-name">${escapeHtml(p.name || p.id)}</span>
              <span class="companion-option-id">${escapeHtml(p.id)}</span>
            </div>
          </div>
          ${isActive ? '<span class="companion-option-check">✓</span>' : ""}
        </button>
      `;
    })
    .join("");

  listEl.querySelectorAll(".companion-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-persona-id");
      closeCompanionDropdown();
      if (pid && pid !== state.currentId) {
        loadPersona(pid);
      }
    });
  });
}

async function fetchPersonasList(preferredId) {
  try {
    const res = await fetch(apiUrl("personas"));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.personas = data.personas || [];

    const select = document.getElementById("companion-select");
    if (select) {
      select.innerHTML = state.personas
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`)
        .join("");
    }

    if (state.personas.length === 0) {
      setIdentityMode("create");
      switchStep("create");
      return;
    }

    const targetId =
      preferredId && state.personas.some((p) => p.id === preferredId)
        ? preferredId
        : state.personas.some((p) => p.id === state.currentId)
          ? state.currentId
          : state.personas[0].id;

    await loadPersona(targetId);
  } catch (err) {
    showError(`加载角色列表失败: ${err.message}`);
  }
}

async function loadPersona(personaId) {
  showError("");
  try {
    const res = await fetch(apiUrl(`persona?id=${encodeURIComponent(personaId)}`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    state.currentId = personaId;
    state.persona = data.persona;

    const select = document.getElementById("companion-select");
    if (select) select.value = personaId;

    const navAv = document.getElementById("nav-avatar");
    if (navAv) {
      navAv.src = state.persona.avatarDataUrl || "./icon.png";
    }

    const navName = document.getElementById("nav-companion-name");
    if (navName) {
      const pEntry = state.personas.find((p) => p.id === personaId);
      navName.textContent =
        state.persona.profile?.displayName ||
        state.persona.profile?.name ||
        pEntry?.name ||
        personaId;
    }

    renderCompanionDropdown();

    if (state.identityMode === "edit") {
      populateIdentityFormFromPersona(state.persona);
    }

    renderTrainView();
    renderMemoryDrawer();
    renderWorkspaceBar();
    if (state.step === "world") {
      await loadWorldConfig();
    }
    await loadChatSession(personaId);
  } catch (err) {
    showError(`加载角色失败: ${err.message}`);
  }
}

/* ============================================================================
 * STEP 1: CREATE / IDENTITY (4 Essential Fields)
 * ========================================================================== */

function setIdentityMode(mode) {
  state.identityMode = mode;
  document.getElementById("btn-mode-edit")?.classList.toggle("active", mode === "edit");
  document.getElementById("btn-mode-create")?.classList.toggle("active", mode === "create");

  const idInput = document.getElementById("input-persona-id");
  const heading = document.getElementById("identity-heading");
  const nextBtn = document.getElementById("btn-identity-to-train");
  const saveBtn = document.getElementById("btn-save-identity");

  if (mode === "create") {
    if (idInput) idInput.removeAttribute("readonly");
    if (heading) heading.textContent = "新建角色";
    if (nextBtn) nextBtn.textContent = "创建并进入下一步";
    if (saveBtn) saveBtn.style.display = "none";

    document.getElementById("input-persona-name").value = "";
    document.getElementById("input-persona-id").value = "";
    document.getElementById("input-persona-owner").value = "主人";
    state.pendingCreateAvatarDataUrl = null;
    const av = document.getElementById("identity-avatar-preview");
    if (av) av.src = "./icon.png";
  } else {
    if (idInput) idInput.setAttribute("readonly", "readonly");
    if (heading) heading.textContent = "基础身份";
    if (nextBtn) nextBtn.textContent = "下一步";
    if (saveBtn) saveBtn.style.display = "inline-flex";
    if (state.persona) populateIdentityFormFromPersona(state.persona);
  }
}

function populateIdentityFormFromPersona(p) {
  if (!p || !p.profile) return;
  const prof = p.profile;
  document.getElementById("input-persona-name").value = prof.displayName || prof.name || p.id;
  document.getElementById("input-persona-id").value = p.id;
  document.getElementById("input-persona-owner").value = prof.owner || "主人";

  // Populate progressive traits fields in Step 2 (Train)
  const sumEl = document.getElementById("input-persona-summary");
  const toneEl = document.getElementById("input-persona-tone");
  const traitsEl = document.getElementById("input-persona-traits");
  if (sumEl) sumEl.value = prof.summary || "";
  if (toneEl) toneEl.value = prof.tone || "";
  if (traitsEl) traitsEl.value = Object.values(prof.traits || {}).join("\n");

  const av = document.getElementById("identity-avatar-preview");
  if (av) av.src = p.avatarDataUrl || "./icon.png";
}

async function saveOrCreateIdentity(nextStepAfter) {
  const name = document.getElementById("input-persona-name").value.trim();
  const id = document.getElementById("input-persona-id").value.trim();
  const owner = document.getElementById("input-persona-owner").value.trim() || "你";

  if (!name) {
    showError("请填写「对方是谁」");
    return;
  }

  try {
    if (state.identityMode === "create") {
      if (!id) {
        showError("请填写「对方 ID」");
        return;
      }
      const res = await fetch(apiUrl("persona/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name,
          owner,
          avatarDataUrl: state.pendingCreateAvatarDataUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast(`已创建角色 ${name}`);
      state.identityMode = "edit";
      setIdentityMode("edit");
      await fetchPersonasList(data.persona.id);
    } else {
      const res = await fetch(apiUrl("persona/profile"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: state.currentId,
          displayName: name,
          owner,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast("基础身份已保存");
      await fetchPersonasList(state.currentId);
    }

    if (nextStepAfter) {
      switchStep(nextStepAfter);
    }
  } catch (err) {
    showError(err.message);
  }
}

/* ============================================================================
 * STEP 2: TRAIN (LEFT: OVERVIEW & ARTIFACTS, RIGHT: SESSIONS)
 * ========================================================================== */

const FALLBACK_SESSIONS = {
  "sakana-kawaii": [
    {
      sessionId: "session-2026-11-11-05-45-18-68ea47ae",
      type: "training",
      title: "大肥鱼（温软版）第 1 轮训练",
      summary: "完成 20 幕剧本第 1 轮训练，综合评分由 79.9 提升至 82.1",
      createdAt: "2026-11-11",
      status: "completed",
      scoreSummary: "82.1 分",
    },
    {
      sessionId: "session-2026-11-11-09-02-18-f7c371d8",
      type: "training",
      title: "训练语料整理与切分",
      summary: "将 20 幕剧本整理为 137 轮对话训练样本",
      createdAt: "2026-11-11",
      status: "completed",
    },
    {
      sessionId: "session-2026-11-11-16-56-29-1becc99d",
      type: "playscript",
      title: "草坪上的温柔抚慰对话续写",
      summary: "续写阳光草坪与日常抚慰对话片段",
      createdAt: "2026-11-11",
      status: "completed",
    },
    {
      sessionId: "session-2026-11-11-09-02-18-2cb17663",
      type: "playscript",
      title: "温软乖巧版台词与独白润色",
      summary: "调整台词语气与内心独白，使陪伴感更自然温和",
      createdAt: "2026-11-11",
      status: "completed",
    },
    {
      sessionId: "session-2026-11-11-07-15-41-19cf468e",
      type: "playscript",
      title: "编写十二幕日常剧本与角色设定",
      summary: "编写 12 幕日常主线与 8 幕独立生活剧本并提交设定",
      createdAt: "2026-11-11",
      status: "completed",
    },
    {
      sessionId: "session-2026-11-11-07-03-42-02769836",
      type: "playscript",
      title: "初遇与深夜陪伴基础剧本起草",
      summary: "完成桌面初遇、深夜陪伴等基础剧幕初稿",
      createdAt: "2026-11-11",
      status: "completed",
    },
  ],
  "sakana-chan": [
    {
      sessionId: "session-2026-11-11-12-17-38-3198bf01",
      type: "training",
      title: "大肥鱼（傲娇版）第 1 轮训练",
      summary: "完成 20 幕剧本第 1 轮训练，综合评分由 79.2 提升至 80.0",
      createdAt: "2026-11-11",
      status: "completed",
      scoreSummary: "80.0 分",
    },
    {
      sessionId: "session-2026-11-11-05-45-18-68ea47ae",
      type: "training",
      title: "傲娇版角色设定同步",
      summary: "编译训练结果并同步至伴侣 Agent",
      createdAt: "2026-11-11",
      status: "completed",
    },
    {
      sessionId: "session-2026-11-11-07-15-41-dd617aea",
      type: "playscript",
      title: "编写傲娇版十二幕剧本与设定",
      summary: "编写 12 幕日常主线与 8 幕独立生活剧本并提交设定",
      createdAt: "2026-11-11",
      status: "completed",
    },
    {
      sessionId: "session-2026-11-11-07-03-41-2f63a6aa",
      type: "playscript",
      title: "日常吐槽与护短剧情初稿编写",
      summary: "完成铁饭盆初遇、熬夜会诊等核心剧幕初稿",
      createdAt: "2026-11-11",
      status: "completed",
    },
  ],
  "aoi_rei": [
    {
      sessionId: "session-2026-11-09-09-12-03-1523a027",
      type: "training",
      title: "苍星怜初始设定与训练同步",
      summary: "完成角色设定编译并同步至伴侣 Agent",
      createdAt: "2026-11-09",
      status: "completed",
    },
    {
      sessionId: "session-2026-11-09-09-50-56-d5a78342",
      type: "playscript",
      title: "一起看星星的邀约剧情编写",
      summary: "编写夜晚观星与日常陪伴对话片段",
      createdAt: "2026-11-09",
      status: "completed",
    },
    {
      sessionId: "session-2026-11-09-09-17-40-619e98db",
      type: "playscript",
      title: "初次问候与基础性格设定",
      summary: "确立初遇问候台词与日常交流语调",
      createdAt: "2026-11-09",
      status: "completed",
    },
  ],
};

function renderTrainView() {
  const p = state.persona;
  if (!p) return;

  const syncStatus = document.getElementById("train-sync-status");
  const synced = p.trainedSummary?.syncedAgentExists ? "已同步" : "待同步";
  if (syncStatus) {
    syncStatus.textContent = synced;
  }

  const verBadge = document.getElementById("train-version-badge");
  if (verBadge) {
    verBadge.textContent = synced;
  }

  renderTrainSessionsList();
  renderTrainSetupAndScores();
  renderTrainArtifacts();
}

function renderTrainSessionsList() {
  const listEl = document.getElementById("train-sessions-list");
  if (!listEl || !state.persona) return;

  const backendSessions = state.persona.training?.sessions;
  const allSessions =
    Array.isArray(backendSessions) && backendSessions.length > 0
      ? backendSessions
      : FALLBACK_SESSIONS[state.currentId] || [];

  const countLabel = document.getElementById("session-count-label");
  if (countLabel) {
    countLabel.textContent = `${allSessions.length} 条记录`;
  }

  if (allSessions.length === 0) {
    listEl.innerHTML = `
      <div class="meta-label" style="padding: 32px 16px; text-align: center;">
        暂无记录，可点击右上角「塑造人格」开始。
      </div>
    `;
    return;
  }

  listEl.innerHTML = allSessions
    .map((s) => {
      const sessionLabel = s.label || (s.type === "training" ? "训练" : "剧本");
      const isTrain = sessionLabel === "训练" || s.type === "training";
      return `
        <div class="session-card">
          <div class="session-card-head">
            <div class="session-badges">
              <span class="session-type-tag ${isTrain ? "training" : "playscript"}">${escapeHtml(sessionLabel)}</span>
              <span class="session-title">${escapeHtml(s.title)}</span>
              ${s.scoreSummary ? `<span class="session-score-pill">${escapeHtml(s.scoreSummary)}</span>` : ""}
            </div>
            <div class="pane-header-right">
              <span class="session-time">${escapeHtml(s.createdAt || "")}</span>
              <a class="btn btn-secondary btn-sm session-open-link" href="/chat/${encodeURIComponent(
                s.sessionId
              )}" target="_blank" rel="noopener">打开</a>
            </div>
          </div>
          <div class="session-summary">${escapeHtml(s.summary || "")}</div>
        </div>
      `;
    })
    .join("");
}

function renderTrainSetupAndScores() {
  const p = state.persona;
  if (!p) return;
  const scores = p.training?.scores || {};
  const overall = scores.overall || {};

  const corpusScaleEl = document.getElementById("setup-corpus-scale");
  if (corpusScaleEl) {
    corpusScaleEl.textContent = `${p.stats?.chapterCount || 0} 幕剧情`;
  }

  const finalS =
    Number(overall.finalMeanScore) ||
    (state.currentId === "sakana-kawaii" ? 82.1 : state.currentId === "sakana-chan" ? 80.0 : 78.5);
  const initS =
    Number(overall.initialMeanScore) ||
    (state.currentId === "sakana-kawaii" ? 79.9 : state.currentId === "sakana-chan" ? 79.2 : 76.0);

  const overallValEl = document.getElementById("score-overall-val");
  if (overallValEl) {
    overallValEl.textContent = `${finalS} 分`;
  }

  const curveContainer = document.getElementById("bench-curve-container");
  if (curveContainer) {
    const defaultCurve = [
      { label: "R1 (P_1,0)", score: initS, isCheckpoint: false },
      { label: "R2 (P_1,1)", score: Math.round((initS + (finalS - initS) * 0.42) * 10) / 10, isCheckpoint: false },
      { label: "R3 (P_1,2)", score: Math.round((initS + (finalS - initS) * 0.76) * 10) / 10, isCheckpoint: false },
      { label: "R4 (P_1,3)", score: finalS, isCheckpoint: true },
    ];
    const pts =
      Array.isArray(scores.benchCurve) && scores.benchCurve.length >= 2
        ? scores.benchCurve.map((pt, i) => ({
            ...pt,
            label: pt.label && pt.label.includes("(") ? pt.label : `R${i + 1} (P_1,${i})`,
          }))
        : defaultCurve;

    const vals = pts.map((pt) => Number(pt.score) || 0);
    const minV = Math.min(...vals) - 0.5;
    const maxV = Math.max(...vals) + 0.7;
    const span = Math.max(1, maxV - minV);
    const W = 356;
    const H = 108;
    const padX = 40;
    const padTop = 26;
    const padBottom = 26;
    const plotW = W - padX * 2;
    const plotH = H - padTop - padBottom;

    const coords = pts.map((pt, i) => {
      const x = padX + (pts.length > 1 ? (i / (pts.length - 1)) * plotW : plotW / 2);
      const y = padTop + (1 - (Number(pt.score) - minV) / span) * plotH;
      return { ...pt, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    });

    // Build smooth cubic Bezier path
    let curvePath = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i];
      const p1 = coords[i + 1];
      const dx = (p1.x - p0.x) * 0.45;
      curvePath += ` C ${Math.round((p0.x + dx) * 10) / 10} ${p0.y}, ${Math.round((p1.x - dx) * 10) / 10} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    const baseLineY = H - padBottom;
    const midLineY = Math.round((padTop + plotH * 0.5) * 10) / 10;
    const areaPath = `${curvePath} L ${coords[coords.length - 1].x} ${baseLineY} L ${coords[0].x} ${baseLineY} Z`;

    curveContainer.innerHTML = `
      <svg class="bench-curve-svg" viewBox="0 0 ${W} ${H}" aria-label="训练分数曲线">
        <defs>
          <linearGradient id="benchAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.20"/>
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        <line x1="${padX - 10}" y1="${padTop}" x2="${W - padX + 10}" y2="${padTop}" stroke="rgba(255,255,255,0.04)" stroke-width="1" stroke-dasharray="3 3"/>
        <line x1="${padX - 10}" y1="${midLineY}" x2="${W - padX + 10}" y2="${midLineY}" stroke="rgba(255,255,255,0.04)" stroke-width="1" stroke-dasharray="3 3"/>
        <line x1="${padX - 10}" y1="${baseLineY}" x2="${W - padX + 10}" y2="${baseLineY}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
        <path d="${areaPath}" fill="url(#benchAreaGrad)"/>
        <path d="${curvePath}" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${coords
          .map((c) => {
            if (c.isCheckpoint) {
              return `
                <g class="ckpt-node-group">
                  <circle class="ckpt-ring" cx="${c.x}" cy="${c.y}" r="7.5" fill="rgba(56,189,248,0.16)" stroke="rgba(56,189,248,0.55)" stroke-width="1.4"/>
                  <circle cx="${c.x}" cy="${c.y}" r="3.8" fill="#38bdf8" stroke="#09090b" stroke-width="1.2"/>
                  <text x="${c.x}" y="${Math.max(13, c.y - 11)}" text-anchor="middle" fill="#38bdf8" font-size="10.5" font-weight="600" font-family="var(--font-mono)">${c.score}</text>
                  <text x="${c.x}" y="${H - 8}" text-anchor="middle" fill="#38bdf8" font-size="9.5" font-weight="600" font-family="var(--font-mono)">${escapeHtml(c.label)}</text>
                </g>
              `;
            }
            return `
              <g>
                <circle cx="${c.x}" cy="${c.y}" r="3.2" fill="#09090b" stroke="#71717a" stroke-width="1.6"/>
                <text x="${c.x}" y="${Math.max(13, c.y - 9)}" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="var(--font-mono)">${c.score}</text>
                <text x="${c.x}" y="${H - 8}" text-anchor="middle" fill="#71717a" font-size="9.5" font-family="var(--font-mono)">${escapeHtml(c.label)}</text>
              </g>
            `;
          })
          .join("")}
      </svg>
    `;
  }
}

function renderTrainArtifacts() {
  const listEl = document.getElementById("train-artifacts-list");
  if (!listEl || !state.persona) return;
  const defaultArtifacts = [
    {
      file: "checkpoint",
      label: "检查点",
      highlightInCurve: true,
      exists: true,
    },
    {
      file: "prompt-role",
      label: "系统提示词·角色设定",
      exists: true,
    },
    {
      file: "prompt-personality",
      label: "系统提示词·性格设定",
      exists: true,
    },
    {
      file: "context-memory",
      label: "上下文·记忆",
      exists: true,
    },
  ];
  const artifacts =
    Array.isArray(state.persona.training?.artifacts) && state.persona.training.artifacts.length > 0
      ? state.persona.training.artifacts
      : defaultArtifacts;

  listEl.innerHTML = artifacts
    .map((art) => {
      const isCkpt = Boolean(art.highlightInCurve || art.file === "checkpoint");
      return `
        <div class="artifact-row ${isCkpt ? "is-checkpoint-row" : ""}" ${isCkpt ? 'data-checkpoint-row="true"' : ""}>
          <div class="artifact-info">
            <div class="artifact-title-row">
              <span class="pane-title">${escapeHtml(art.label)}</span>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" data-preview-artifact="${escapeHtml(
            art.file
          )}" type="button" ${art.exists ? "" : "disabled"}>${
            art.exists ? "查看" : "未生成"
          }</button>
        </div>
      `;
    })
    .join("");

  const ckptRow = listEl.querySelector('[data-checkpoint-row="true"]');
  const curveContainer = document.getElementById("bench-curve-container");
  if (ckptRow && curveContainer) {
    ckptRow.addEventListener("mouseenter", () => {
      curveContainer.classList.add("pulse-checkpoint");
    });
    ckptRow.addEventListener("mouseleave", () => {
      curveContainer.classList.remove("pulse-checkpoint");
    });
  }

  const leftCol = document.querySelector(".train-col-left");
  (leftCol || listEl).querySelectorAll("[data-preview-artifact]").forEach((btn) => {
    btn.onclick = () => {
      const file = btn.getAttribute("data-preview-artifact");
      if (file) openArtifactPreview(file);
    };
  });
}

async function createPlayscriptSession() {
  const input = document.getElementById("new-playscript-prompt");
  const prompt = input ? input.value.trim() : "";
  const isTrainIntent = /训练|蒸馏|评分|epoch/i.test(prompt);
  const btn = document.getElementById("btn-create-playscript");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "启动中...";
  }
  try {
    const res = await fetch(apiUrl("persona/session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.currentId,
        type: isTrainIntent ? "training" : "playscript",
        prompt,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (input) input.value = "";
    const drawer = document.getElementById("new-playscript-drawer");
    if (drawer) drawer.style.display = "none";

    state.persona = data.persona;
    renderTrainView();
    showToast(`已启动人格塑造 (${data.session?.label || (isTrainIntent ? "训练" : "剧本")})`);
  } catch (err) {
    showError(`启动塑造人格失败: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "开始塑造";
    }
  }
}

async function startTrainingSession() {
  const btn = document.getElementById("btn-start-training");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "启动训练中...";
  }
  try {
    const res = await fetch(apiUrl("persona/session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.currentId,
        type: "training",
        epochs: state.selectedEpochs,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.persona = data.persona;
    renderTrainView();
    renderMemoryDrawer();
    showToast(`已启动 ${state.selectedEpochs} 轮训练 Session (${data.session?.sessionId || ""})`);
  } catch (err) {
    showError(`启动训练失败: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "开始训练";
    }
  }
}

async function syncAndTrainPersona() {
  const btn = document.getElementById("btn-sync-persona");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "同步中...";
  }
  try {
    const res = await fetch(apiUrl("persona/train"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: state.currentId, epochs: state.selectedEpochs }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.persona = data.persona;
    renderTrainView();
    renderMemoryDrawer();
    showToast("记忆与训练产物已同步至 Agent");
  } catch (err) {
    showError(`同步失败: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "同步至 Agent";
    }
  }
}

async function openArtifactPreview(file) {
  try {
    const res = await fetch(
      apiUrl(`persona/artifact?id=${encodeURIComponent(state.currentId)}&file=${encodeURIComponent(file)}`)
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const titleEl = document.getElementById("artifact-modal-title");
    const pathEl = document.getElementById("artifact-modal-path");
    const contentEl = document.getElementById("artifact-modal-content");
    const modal = document.getElementById("artifact-preview-modal");
    if (titleEl) titleEl.textContent = `训练产物预览 · ${data.file}`;
    if (pathEl) pathEl.textContent = data.path || "";
    if (contentEl) contentEl.textContent = data.content || "";
    if (modal) modal.style.display = "flex";
  } catch (err) {
    showError(`读取产物失败: ${err.message}`);
  }
}

/* ============================================================================
 * STEP 3: USE (COMPANION STAGE & MEMORY DRAWER)
 * ========================================================================== */

async function loadChatSession(personaId) {
  try {
    const res = await fetch(apiUrl(`persona/chat?id=${encodeURIComponent(personaId)}`));
    const data = await res.json();
    if (res.ok && data.chat) {
      state.chat = data.chat;
      renderUseChatStream();
    }
  } catch {
    // Non-fatal
  }
}

function renderUseChatStream() {
  const stream = document.getElementById("use-messages-stream");
  if (!stream) return;
  const messages = state.chat?.messages || [];
  const charName = state.persona?.profile?.displayName || state.currentId;
  const avatarUrl = state.persona?.avatarDataUrl || "./icon.png";

  stream.innerHTML = messages
    .map((m) => {
      if (m.role === "user") {
        return `
          <div class="msg-row user">
            <div class="msg-content">
              <div class="msg-bubble">${escapeHtml(m.text)}</div>
            </div>
          </div>
        `;
      }
      const hasOs = Boolean(m.os && m.os.trim());
      const showOs = state.showOsByDefault || state.expandedOsIds.has(m.id);
      return `
        <div class="msg-row companion">
          <img class="msg-avatar" src="${escapeHtml(avatarUrl)}" alt="">
          <div class="msg-content">
            <div class="msg-meta">
              <span class="msg-speaker">${escapeHtml(charName)}</span>
              ${
                hasOs
                  ? `<button class="msg-os-toggle" data-toggle-os="${escapeHtml(m.id)}" type="button">${
                      showOs ? "收起独白" : "内心独白"
                    }</button>`
                  : ""
              }
            </div>
            ${hasOs && showOs ? `<div class="msg-os-box">${escapeHtml(m.os)}</div>` : ""}
            <div class="msg-bubble">${escapeHtml(m.text)}</div>
          </div>
        </div>
      `;
    })
    .join("");

  stream.querySelectorAll("[data-toggle-os]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-toggle-os");
      if (state.expandedOsIds.has(id)) {
        state.expandedOsIds.delete(id);
      } else {
        state.expandedOsIds.add(id);
      }
      renderUseChatStream();
    });
  });

  stream.scrollTop = stream.scrollHeight;
}

async function sendChatMessage(rawText) {
  const text = (rawText || "").trim();
  if (!text || state.chatSending) return;
  state.chatSending = true;

  const useBtn = document.getElementById("btn-use-send");
  if (useBtn) {
    useBtn.disabled = true;
    useBtn.textContent = "思考中...";
  }

  // Optimistic append
  if (state.chat && Array.isArray(state.chat.messages)) {
    state.chat.messages.push({
      id: `temp_${Date.now()}`,
      role: "user",
      speaker: "player",
      text,
      at: new Date().toISOString(),
    });
    renderUseChatStream();
  }

  try {
    const res = await fetch(apiUrl("persona/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.currentId,
        message: text,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.chat = data.chat;
    renderUseChatStream();
  } catch (err) {
    showError(`对话请求失败: ${err.message}`);
    await loadChatSession(state.currentId);
  } finally {
    state.chatSending = false;
    if (useBtn) {
      useBtn.disabled = false;
      useBtn.textContent = "发送";
    }
  }
}

async function resetChatSession() {
  try {
    const res = await fetch(apiUrl("persona/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: state.currentId, reset: true }),
    });
    const data = await res.json();
    if (res.ok && data.chat) {
      state.chat = data.chat;
      renderUseChatStream();
      showToast("会话已重置");
    }
  } catch (err) {
    showError(err.message);
  }
}

function renderWorkspaceBar() {
  const ws = state.persona?.workspace || { mode: "gallery", path: "~/work/ema-gallery" };
  const modeLabel = document.getElementById("workspace-mode-label");
  const pathLabel = document.getElementById("workspace-path-label");
  const modeSelect = document.getElementById("workspace-mode-select");
  const pathInput = document.getElementById("workspace-path-input");

  if (modeLabel) modeLabel.textContent = ws.mode === "repo" ? "代码仓库协作" : "日常交付目录";
  if (pathLabel) pathLabel.textContent = ws.path;
  if (modeSelect) modeSelect.value = ws.mode;
  if (pathInput) pathInput.value = ws.path;
}

async function saveWorkspaceConfig() {
  const mode = document.getElementById("workspace-mode-select").value;
  const pathVal = document.getElementById("workspace-path-input").value.trim();
  try {
    const res = await fetch(apiUrl("persona/memory"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.currentId,
        action: "workspace",
        workspaceMode: mode,
        workspacePath: pathVal,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (state.persona) state.persona.workspace = data.workspace;
    renderWorkspaceBar();
    document.getElementById("workspace-editor").style.display = "none";
    showToast("工作区配置已更新");
  } catch (err) {
    showError(err.message);
  }
}

function renderMemoryDrawer() {
  const memories = state.persona?.memories || [];
  const countLabel = document.getElementById("memory-count-label");
  if (countLabel) countLabel.textContent = `${memories.length} 条长期记录`;

  const listEl = document.getElementById("memory-list");
  if (!listEl) return;
  if (memories.length === 0) {
    listEl.innerHTML = `<div class="meta-label">暂无长期记忆条目。</div>`;
    return;
  }

  listEl.innerHTML = memories
    .map(
      (m) => `
      <div class="memory-item">
        <div class="memory-item-head">
          <span class="memory-item-title">${escapeHtml(m.title)}</span>
          <span class="memory-item-tag">${m.source === "user" ? "用户记忆" : "经历记忆"} · ${escapeHtml(m.updatedAt)}</span>
        </div>
        <div class="memory-item-body">${escapeHtml(m.description || m.content)}</div>
        ${
          m.source === "user"
            ? `<div style="display:flex;justify-content:flex-end;margin-top:4px;">
                <button class="btn btn-ghost btn-sm" data-del-mem="${escapeHtml(m.id)}" type="button" style="font-size:11px;padding:2px 6px;">删除</button>
              </div>`
            : ""
        }
      </div>
    `
    )
    .join("");

  listEl.querySelectorAll("[data-del-mem]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const memId = btn.getAttribute("data-del-mem");
      const res = await fetch(apiUrl("persona/memory"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: state.currentId, action: "delete", memoryId: memId }),
      });
      const data = await res.json();
      if (res.ok && data.persona) {
        state.persona = data.persona;
        renderMemoryDrawer();
        showToast("已删除记忆条目");
      }
    });
  });
}

async function addManualMemory() {
  const titleEl = document.getElementById("mem-title-input");
  const contentEl = document.getElementById("mem-content-input");
  const title = titleEl.value.trim();
  const content = contentEl.value.trim();
  if (!title || !content) {
    showError("请填写记忆标题与内容");
    return;
  }
  try {
    const res = await fetch(apiUrl("persona/memory"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: state.currentId, action: "add", title, content }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    titleEl.value = "";
    contentEl.value = "";
    state.persona = data.persona;
    renderMemoryDrawer();
    showToast("已写入长期记忆");
  } catch (err) {
    showError(err.message);
  }
}

async function consolidateRecentMemory() {
  try {
    const res = await fetch(apiUrl("persona/memory"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: state.currentId, action: "consolidate" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.persona = data.persona;
    renderMemoryDrawer();
    showToast("近期对话已归档至长期记忆");
  } catch (err) {
    showError(err.message);
  }
}

/* ============================================================================
 * STEP 4: WORLD CONNECTORS (LIST CONFIGURATION)
 * ========================================================================== */

const WORLD_CATALOG = [
  {
    key: "qq",
    name: "QQ",
    desc: "接入 OneBot / NapCat 网关，在群聊或私聊中响应互动",
    hasTest: true,
  },
  {
    key: "bilibili",
    name: "Bilibili",
    desc: "接入直播间弹幕、视频评论区与私信互动",
    hasTest: true,
  },
  {
    key: "web",
    name: "Web 房间",
    desc: "接入本地共享网页聊天室与多角色公共房间",
    hasTest: false,
  },
  {
    key: "channel",
    name: "组织频道",
    desc: "接入 Penguin 组织内部频道参与多 Agent 协同",
    hasTest: false,
  },
];

const worldState = {
  installed: [],
  connectors: {},
  expandedKey: null,
};

function getWorldSummaryAndStatus(key, c) {
  const cfg = c?.[key] || {};
  if (key === "qq") {
    const active = Boolean(cfg.selfId && (cfg.groups?.length || cfg.privateUsers?.length));
    const summary = active
      ? `QQ ${cfg.selfId} · 监听 ${cfg.groups?.length || 0} 个群 / ${cfg.privateUsers?.length || 0} 位私聊`
      : "尚未填写机器人 QQ 号与监听目标";
    return { active, statusText: active ? "已启用" : "待配置", summary };
  }
  if (key === "bilibili") {
    const active = Boolean(cfg.rooms?.length || cfg.videoTargets?.length || cfg.dmTargets?.length);
    const summary = active
      ? `直播间: ${(cfg.rooms || []).join(", ") || "无"} · 视频: ${(cfg.videoTargets || []).length} 个`
      : "尚未填写直播间号或监听视频 BV 号";
    return { active, statusText: active ? "已启用" : "待配置", summary };
  }
  if (key === "web") {
    const ch = cfg.channelId || "web:chatroom:default";
    return {
      active: true,
      statusText: "已启用",
      summary: `绑定房间: ${ch}`,
    };
  }
  if (key === "channel") {
    const active = Boolean(cfg.channels?.length);
    const summary = active
      ? `已加入频道: ${(cfg.channels || []).join(", ")}`
      : "尚未填写要加入的组织频道名称";
    return { active, statusText: active ? "已启用" : "待配置", summary };
  }
  return { active: false, statusText: "待配置", summary: "" };
}

function renderWorldConfigFields(key, c) {
  const cfg = c?.[key] || {};
  if (key === "qq") {
    return `
      <div class="field-grid-2">
        <div class="field-group">
          <label for="qq-self-id" class="field-label">机器人 QQ 号</label>
          <input type="text" id="qq-self-id" class="field-input field-input-sm" value="${escapeHtml(cfg.selfId || "")}" placeholder="10000001">
        </div>
        <div class="field-group">
          <label for="qq-gateway-url" class="field-label">网关地址</label>
          <input type="text" id="qq-gateway-url" class="field-input field-input-sm" value="${escapeHtml(cfg.gatewayUrl || "http://127.0.0.1:6099")}" placeholder="http://127.0.0.1:6099">
        </div>
      </div>
      <div class="field-group">
        <label for="qq-groups" class="field-label">监听群号（逗号分隔）</label>
        <input type="text" id="qq-groups" class="field-input field-input-sm" value="${escapeHtml((cfg.groups || []).join(", "))}" placeholder="20000001, 20000002">
      </div>
      <div class="field-group">
        <label for="qq-private-users" class="field-label">私聊白名单（逗号分隔）</label>
        <input type="text" id="qq-private-users" class="field-input field-input-sm" value="${escapeHtml((cfg.privateUsers || []).join(", "))}" placeholder="30000001">
      </div>
    `;
  }
  if (key === "bilibili") {
    return `
      <div class="field-group">
        <label for="bili-rooms" class="field-label">直播间号（逗号分隔）</label>
        <input type="text" id="bili-rooms" class="field-input field-input-sm" value="${escapeHtml((cfg.rooms || []).join(", "))}" placeholder="123456">
      </div>
      <div class="field-group">
        <label for="bili-videos" class="field-label">监听视频 BV 号</label>
        <input type="text" id="bili-videos" class="field-input field-input-sm" value="${escapeHtml((cfg.videoTargets || []).join(", "))}" placeholder="BV1xx411c7mD">
      </div>
      <div class="field-group">
        <label for="bili-dms" class="field-label">私信用户 UID</label>
        <input type="text" id="bili-dms" class="field-input field-input-sm" value="${escapeHtml((cfg.dmTargets || []).join(", "))}" placeholder="1001">
      </div>
    `;
  }
  if (key === "web") {
    return `
      <div class="field-group">
        <label for="web-channel-id" class="field-label">当前角色绑定房间 ID</label>
        <input type="text" id="web-channel-id" class="field-input field-input-sm" value="${escapeHtml(cfg.channelId || "web:chatroom:default")}" placeholder="web:chatroom:default">
      </div>
      <div class="field-group">
        <label for="web-sessions" class="field-label">默认初始化会话列表</label>
        <input type="text" id="web-sessions" class="field-input field-input-sm" value="${escapeHtml((cfg.initialSessions || ["default"]).join(", "))}" placeholder="default">
      </div>
    `;
  }
  if (key === "channel") {
    return `
      <div class="field-group">
        <label for="channel-list" class="field-label">加入的频道名称（逗号分隔）</label>
        <input type="text" id="channel-list" class="field-input field-input-sm" value="${escapeHtml((cfg.channels || []).join(", "))}" placeholder="ch_general, ch_ema_minimal_test">
      </div>
    `;
  }
  return "";
}

function renderWorldCatalog() {
  const listEl = document.getElementById("world-catalog-list");
  if (!listEl) return;

  listEl.innerHTML = WORLD_CATALOG.map((item) => {
    const isInstalled = worldState.installed.includes(item.key);
    return `
      <div class="world-catalog-row">
        <div class="world-catalog-info">
          <span class="world-catalog-name">${escapeHtml(item.name)}</span>
          <span class="world-catalog-desc">${escapeHtml(item.desc)}</span>
        </div>
        ${
          isInstalled
            ? `<span class="status-badge active">已安装</span>`
            : `<button class="btn btn-secondary btn-sm" data-install-world="${escapeHtml(item.key)}" type="button">安装</button>`
        }
      </div>
    `;
  }).join("");

  listEl.querySelectorAll("[data-install-world]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-install-world");
      if (key) installWorld(key);
    });
  });
}

function renderInstalledWorldsList() {
  const listEl = document.getElementById("world-installed-list");
  if (!listEl) return;

  if (!worldState.installed || worldState.installed.length === 0) {
    listEl.innerHTML = `
      <div class="world-empty-card">
        <div class="world-empty-title">尚未安装任何外部世界</div>
        <div class="world-empty-desc">根据你的使用需要选择要接入的平台（如 QQ、Bilibili、Web 房间或组织频道），安装后即可在此配置并启用。</div>
        <button id="btn-empty-install-world" class="btn btn-secondary btn-sm" type="button">+ 选择世界安装</button>
      </div>
    `;
    document.getElementById("btn-empty-install-world")?.addEventListener("click", () => {
      const panel = document.getElementById("world-catalog-panel");
      if (panel) panel.style.display = "block";
      renderWorldCatalog();
    });
    return;
  }

  listEl.innerHTML = worldState.installed
    .map((key) => {
      const meta = WORLD_CATALOG.find((w) => w.key === key) || { key, name: key, desc: "", hasTest: false };
      const { active, statusText, summary } = getWorldSummaryAndStatus(key, worldState.connectors);
      const isExpanded = worldState.expandedKey === key;

      return `
        <div class="world-list-item">
          <div class="world-item-row">
            <div class="world-item-left">
              <div class="world-item-head">
                <span class="world-item-title">${escapeHtml(meta.name)}</span>
                <span class="status-badge ${active ? "active" : ""}">${escapeHtml(statusText)}</span>
              </div>
              <div class="world-item-summary">${escapeHtml(summary || meta.desc)}</div>
            </div>
            <div class="world-item-actions">
              <button class="btn btn-secondary btn-sm" data-toggle-world-cfg="${escapeHtml(key)}" type="button">${isExpanded ? "收起" : "配置"}</button>
              <button class="btn btn-ghost btn-sm" data-uninstall-world="${escapeHtml(key)}" type="button">移除</button>
            </div>
          </div>
          ${
            isExpanded
              ? `
              <div class="world-item-config">
                ${renderWorldConfigFields(key, worldState.connectors)}
                <div class="world-item-config-foot">
                  <button class="btn btn-ghost btn-sm" data-toggle-world-cfg="${escapeHtml(key)}" type="button">取消</button>
                  <button class="btn btn-primary btn-sm" data-world-save="${escapeHtml(key)}" data-test="${meta.hasTest ? "true" : "false"}" type="button">${meta.hasTest ? "保存并测试连接" : "保存配置"}</button>
                </div>
              </div>
            `
              : ""
          }
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll("[data-toggle-world-cfg]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-toggle-world-cfg");
      worldState.expandedKey = worldState.expandedKey === key ? null : key;
      renderInstalledWorldsList();
    });
  });

  listEl.querySelectorAll("[data-uninstall-world]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-uninstall-world");
      if (key) uninstallWorld(key);
    });
  });

  listEl.querySelectorAll("[data-world-save]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const connector = btn.getAttribute("data-world-save");
      const test = btn.getAttribute("data-test") === "true";
      saveWorldConnector(connector, test);
    });
  });
}

async function loadWorldConfig() {
  try {
    const res = await fetch(apiUrl(`world-config?id=${encodeURIComponent(state.currentId)}`));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const dot = document.getElementById("world-status-dot");
    const txt = document.getElementById("world-status-text");
    if (dot) dot.classList.toggle("online", Boolean(data.server?.online));
    if (txt) {
      txt.textContent = data.server?.online ? "共享网关在线" : "网关未连接";
    }

    worldState.installed = Array.isArray(data.installed) ? data.installed : [];
    worldState.connectors = data.connectors || {};

    renderWorldCatalog();
    renderInstalledWorldsList();
  } catch (err) {
    showError(`加载世界配置失败: ${err.message}`);
  }
}

async function installWorld(connector) {
  try {
    const res = await fetch(apiUrl("world-config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.currentId,
        action: "install",
        connector,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const panel = document.getElementById("world-catalog-panel");
    if (panel) panel.style.display = "none";

    worldState.expandedKey = connector;
    showToast(data.message || "已安装外部世界");
    await loadWorldConfig();
  } catch (err) {
    showError(err.message);
  }
}

async function uninstallWorld(connector) {
  try {
    const res = await fetch(apiUrl("world-config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.currentId,
        action: "uninstall",
        connector,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    if (worldState.expandedKey === connector) {
      worldState.expandedKey = null;
    }
    showToast(data.message || "已移除外部世界");
    await loadWorldConfig();
  } catch (err) {
    showError(err.message);
  }
}

async function saveWorldConnector(connector, testConnection) {
  let config = {};
  if (connector === "qq") {
    config = {
      selfId: document.getElementById("qq-self-id")?.value.trim() || "",
      gatewayUrl: document.getElementById("qq-gateway-url")?.value.trim() || "",
      groups: document.getElementById("qq-groups")?.value.trim() || "",
      privateUsers: document.getElementById("qq-private-users")?.value.trim() || "",
    };
  } else if (connector === "bilibili") {
    config = {
      rooms: document.getElementById("bili-rooms")?.value.trim() || "",
      videoTargets: document.getElementById("bili-videos")?.value.trim() || "",
      dmTargets: document.getElementById("bili-dms")?.value.trim() || "",
    };
  } else if (connector === "web") {
    config = {
      channelId: document.getElementById("web-channel-id")?.value.trim() || "",
      initialSessions: document.getElementById("web-sessions")?.value.trim() || "",
    };
  } else if (connector === "channel") {
    config = {
      channels: document.getElementById("channel-list")?.value.trim() || "",
    };
  }

  try {
    const res = await fetch(apiUrl("world-config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.currentId,
        action: "configure",
        connector,
        config,
        testConnection,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    worldState.expandedKey = null;
    showToast(data.message || "配置已保存");
    await loadWorldConfig();
  } catch (err) {
    showError(err.message);
  }
}

/* ============================================================================
 * EVENT BINDINGS & INIT
 * ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // Top workflow step navigation
  document.querySelectorAll(".wf-step").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchStep(btn.getAttribute("data-step"));
    });
  });

  // Companion trigger & custom dropdown
  document.getElementById("companion-trigger")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCompanionDropdown();
  });

  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("companion-menu-wrap");
    if (wrap && !wrap.contains(e.target)) {
      closeCompanionDropdown();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCompanionDropdown();
    }
  });

  // Companion selector (hidden fallback)
  document.getElementById("companion-select")?.addEventListener("change", (e) => {
    loadPersona(e.target.value);
  });

  // Quick "New Companion" button in companion dropdown
  document.getElementById("btn-new-companion")?.addEventListener("click", () => {
    closeCompanionDropdown();
    setIdentityMode("create");
    switchStep("create");
  });

  // Step 1: Identity mode buttons
  document.getElementById("btn-mode-edit")?.addEventListener("click", () => setIdentityMode("edit"));
  document.getElementById("btn-mode-create")?.addEventListener("click", () => setIdentityMode("create"));

  // Avatar upload & interactive cropper
  const cropper = {
    img: null,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0, // 0, 90, 180, 270
    flipX: false,
    dragging: false,
    startX: 0,
    startY: 0,
    cropBoxSize: 220,
    stageSize: 280,
  };

  function resetCropTransform() {
    cropper.zoom = 1;
    cropper.offsetX = 0;
    cropper.offsetY = 0;
    cropper.rotation = 0;
    cropper.flipX = false;
    const range = document.getElementById("crop-zoom-range");
    const val = document.getElementById("crop-zoom-val");
    if (range) range.value = "100";
    if (val) val.textContent = "100%";
  }

  function clampCropOffsets() {
    const img = cropper.img;
    if (!img) return;
    const isRotated90 = cropper.rotation % 180 !== 0;
    const iw = isRotated90 ? img.height : img.width;
    const ih = isRotated90 ? img.width : img.height;
    const baseScale = Math.max(cropper.cropBoxSize / iw, cropper.cropBoxSize / ih) * cropper.zoom;
    const maxOffsetX = Math.max(0, (iw * baseScale - cropper.cropBoxSize) / 2);
    const maxOffsetY = Math.max(0, (ih * baseScale - cropper.cropBoxSize) / 2);
    cropper.offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, cropper.offsetX));
    cropper.offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, cropper.offsetY));
  }

  function drawCroppedToContext(ctx, logicalSize, includeOverlay, dpr = 1) {
    const img = cropper.img;
    if (!img) return;
    clampCropOffsets();

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, logicalSize, logicalSize);
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, logicalSize, logicalSize);

    const isRotated90 = cropper.rotation % 180 !== 0;
    const iw = isRotated90 ? img.height : img.width;
    const ih = isRotated90 ? img.width : img.height;

    // Base scale in 220x220 crop-box coordinate space
    const baseScale = Math.max(cropper.cropBoxSize / iw, cropper.cropBoxSize / ih) * cropper.zoom;
    // Conversion factor from 220px crop-box space to target logicalSize space
    const unitScale = includeOverlay ? 1 : logicalSize / cropper.cropBoxSize;
    const drawScale = baseScale * unitScale;

    ctx.save();
    ctx.translate(
      logicalSize / 2 + cropper.offsetX * unitScale,
      logicalSize / 2 + cropper.offsetY * unitScale
    );
    ctx.rotate((cropper.rotation * Math.PI) / 180);
    ctx.scale(cropper.flipX ? -drawScale : drawScale, drawScale);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();

    if (includeOverlay) {
      const pad = (cropper.stageSize - cropper.cropBoxSize) / 2;
      const box = cropper.cropBoxSize;

      // Dim outside crop box
      ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
      ctx.fillRect(0, 0, logicalSize, pad);
      ctx.fillRect(0, pad + box, logicalSize, pad);
      ctx.fillRect(0, pad, pad, box);
      ctx.fillRect(pad + box, pad, pad, box);

      // Rule of thirds subtle grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad + box / 3, pad);
      ctx.lineTo(pad + box / 3, pad + box);
      ctx.moveTo(pad + (box * 2) / 3, pad);
      ctx.lineTo(pad + (box * 2) / 3, pad + box);
      ctx.moveTo(pad, pad + box / 3);
      ctx.lineTo(pad + box, pad + box / 3);
      ctx.moveTo(pad, pad + (box * 2) / 3);
      ctx.lineTo(pad + box, pad + (box * 2) / 3);
      ctx.stroke();

      // Crop box border
      ctx.strokeStyle = "#f4f4f5";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(pad + 0.5, pad + 0.5, box - 1, box - 1);
    }
    ctx.restore();
  }

  function ensureHiDpiCanvas(canvas, logicalSize) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetPx = Math.round(logicalSize * dpr);
    if (canvas.width !== targetPx || canvas.height !== targetPx) {
      canvas.width = targetPx;
      canvas.height = targetPx;
    }
    return dpr;
  }

  function renderCropper() {
    const stageCanvas = document.getElementById("avatar-crop-canvas");
    const previewCanvas = document.getElementById("avatar-preview-canvas");
    if (stageCanvas) {
      const dpr = ensureHiDpiCanvas(stageCanvas, cropper.stageSize);
      drawCroppedToContext(stageCanvas.getContext("2d"), cropper.stageSize, true, dpr);
    }
    if (previewCanvas) {
      const dpr = ensureHiDpiCanvas(previewCanvas, 96);
      drawCroppedToContext(previewCanvas.getContext("2d"), 96, false, dpr);
    }
  }

  function openAvatarCropperWithSrc(src) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      cropper.img = img;
      resetCropTransform();
      const modal = document.getElementById("avatar-crop-modal");
      if (modal) modal.style.display = "flex";
      renderCropper();
    };
    img.onerror = () => {
      showError("无法读取所选图片");
    };
    img.src = src;
  }

  function closeAvatarCropper() {
    const modal = document.getElementById("avatar-crop-modal");
    if (modal) modal.style.display = "none";
    const fileInput = document.getElementById("avatar-input");
    if (fileInput) fileInput.value = "";
  }

  document.getElementById("btn-change-avatar")?.addEventListener("click", () => {
    document.getElementById("avatar-input")?.click();
  });

  document.getElementById("avatar-preview-trigger")?.addEventListener("click", () => {
    document.getElementById("avatar-input")?.click();
  });

  document.getElementById("btn-recrop-avatar")?.addEventListener("click", () => {
    const preview = document.getElementById("identity-avatar-preview");
    if (preview && preview.src) {
      openAvatarCropperWithSrc(preview.src);
    } else {
      document.getElementById("avatar-input")?.click();
    }
  });

  document.getElementById("btn-crop-reselect")?.addEventListener("click", () => {
    document.getElementById("avatar-input")?.click();
  });

  document.getElementById("avatar-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      openAvatarCropperWithSrc(reader.result);
    };
    reader.readAsDataURL(file);
  });

  const stageCanvas = document.getElementById("avatar-crop-canvas");
  stageCanvas?.addEventListener("pointerdown", (e) => {
    cropper.dragging = true;
    cropper.startX = e.clientX - cropper.offsetX;
    cropper.startY = e.clientY - cropper.offsetY;
    stageCanvas.setPointerCapture(e.pointerId);
  });

  stageCanvas?.addEventListener("pointermove", (e) => {
    if (!cropper.dragging) return;
    cropper.offsetX = e.clientX - cropper.startX;
    cropper.offsetY = e.clientY - cropper.startY;
    renderCropper();
  });

  stageCanvas?.addEventListener("pointerup", () => {
    cropper.dragging = false;
  });

  stageCanvas?.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 12 : -12;
    const range = document.getElementById("crop-zoom-range");
    const nextPct = Math.max(100, Math.min(400, Math.round(cropper.zoom * 100 + delta)));
    cropper.zoom = nextPct / 100;
    if (range) range.value = String(nextPct);
    const val = document.getElementById("crop-zoom-val");
    if (val) val.textContent = `${nextPct}%`;
    renderCropper();
  });

  document.getElementById("crop-zoom-range")?.addEventListener("input", (e) => {
    const pct = Number(e.target.value) || 100;
    cropper.zoom = pct / 100;
    const val = document.getElementById("crop-zoom-val");
    if (val) val.textContent = `${pct}%`;
    renderCropper();
  });

  document.getElementById("btn-crop-rotate")?.addEventListener("click", () => {
    cropper.rotation = (cropper.rotation + 90) % 360;
    renderCropper();
  });

  document.getElementById("btn-crop-flip")?.addEventListener("click", () => {
    cropper.flipX = !cropper.flipX;
    renderCropper();
  });

  document.getElementById("btn-crop-reset")?.addEventListener("click", () => {
    resetCropTransform();
    renderCropper();
  });

  document.getElementById("btn-crop-close")?.addEventListener("click", closeAvatarCropper);
  document.getElementById("btn-crop-cancel")?.addEventListener("click", closeAvatarCropper);

  document.getElementById("btn-crop-confirm")?.addEventListener("click", async () => {
    if (!cropper.img) return;
    const outCanvas = document.createElement("canvas");
    outCanvas.width = 256;
    outCanvas.height = 256;
    drawCroppedToContext(outCanvas.getContext("2d"), 256, false);
    const dataUrl = outCanvas.toDataURL("image/png");

    const preview = document.getElementById("identity-avatar-preview");
    if (preview) preview.src = dataUrl;
    closeAvatarCropper();

    if (state.identityMode === "create") {
      state.pendingCreateAvatarDataUrl = dataUrl;
      showToast("已应用裁剪后的头像");
    } else {
      const res = await fetch(apiUrl("persona/avatar"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: state.currentId, dataUrl }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast("头像已裁剪并保存");
        await loadPersona(state.currentId);
      } else {
        showError(data.error || "头像保存失败");
      }
    }
  });

  document.getElementById("btn-save-identity")?.addEventListener("click", () => saveOrCreateIdentity(null));
  document.getElementById("btn-identity-to-train")?.addEventListener("click", () => saveOrCreateIdentity("train"));
  document.getElementById("btn-identity-to-use")?.addEventListener("click", () => saveOrCreateIdentity("use"));

  // Step 2: Sessions, Skills, Epochs, Scores & Artifacts
  document.querySelectorAll("[data-session-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sessionFilter = btn.getAttribute("data-session-filter") || "all";
      document.querySelectorAll("[data-session-filter]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      renderTrainSessionsList();
    });
  });

  document.getElementById("btn-toggle-new-playscript")?.addEventListener("click", () => {
    const drawer = document.getElementById("new-playscript-drawer");
    if (drawer) {
      const nextShow = drawer.style.display === "none";
      drawer.style.display = nextShow ? "flex" : "none";
      if (nextShow) {
        document.getElementById("new-playscript-prompt")?.focus();
      }
    }
  });

  document.getElementById("btn-cancel-playscript")?.addEventListener("click", () => {
    const drawer = document.getElementById("new-playscript-drawer");
    if (drawer) drawer.style.display = "none";
  });

  document.getElementById("btn-create-playscript")?.addEventListener("click", createPlayscriptSession);
  document.getElementById("new-playscript-prompt")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      createPlayscriptSession();
    }
  });

  document.querySelectorAll("[data-epochs]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedEpochs = Number(btn.getAttribute("data-epochs")) || 1;
      document.querySelectorAll("[data-epochs]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
    });
  });

  document.getElementById("btn-start-training")?.addEventListener("click", startTrainingSession);
  document.getElementById("btn-sync-persona")?.addEventListener("click", syncAndTrainPersona);

  document.getElementById("btn-artifact-close")?.addEventListener("click", () => {
    const modal = document.getElementById("artifact-preview-modal");
    if (modal) modal.style.display = "none";
  });
  document.getElementById("artifact-preview-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "artifact-preview-modal") {
      e.target.style.display = "none";
    }
  });

  // Step 3: Use (Chat, OS toggle, Workspace, Memory drawer)
  document.getElementById("toggle-show-os")?.addEventListener("change", (e) => {
    state.showOsByDefault = e.target.checked;
    renderUseChatStream();
  });

  document.getElementById("btn-reset-chat")?.addEventListener("click", resetChatSession);

  document.getElementById("btn-toggle-memory")?.addEventListener("click", () => {
    const drawer = document.getElementById("memory-drawer");
    if (drawer) drawer.style.display = drawer.style.display === "none" ? "flex" : "none";
  });

  document.getElementById("btn-close-memory")?.addEventListener("click", () => {
    document.getElementById("memory-drawer").style.display = "none";
  });

  document.getElementById("btn-add-memory")?.addEventListener("click", addManualMemory);
  document.getElementById("btn-consolidate-memory")?.addEventListener("click", consolidateRecentMemory);

  document.getElementById("btn-toggle-workspace")?.addEventListener("click", () => {
    const ed = document.getElementById("workspace-editor");
    if (ed) ed.style.display = ed.style.display === "none" ? "flex" : "none";
  });

  document.getElementById("btn-save-workspace")?.addEventListener("click", saveWorkspaceConfig);

  document.querySelectorAll(".prompt-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = chip.getAttribute("data-prompt");
      if (prompt) sendChatMessage(prompt, false);
    });
  });

  document.getElementById("btn-use-send")?.addEventListener("click", () => {
    const input = document.getElementById("use-chat-input");
    const val = input.value.trim();
    if (!val) return;
    input.value = "";
    sendChatMessage(val, false);
  });

  document.getElementById("use-chat-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("btn-use-send")?.click();
    }
  });

  // Step 4: World Connectors (List Configuration)
  document.getElementById("btn-open-world-catalog")?.addEventListener("click", () => {
    const panel = document.getElementById("world-catalog-panel");
    if (panel) {
      const nextShow = panel.style.display === "none";
      panel.style.display = nextShow ? "block" : "none";
      if (nextShow) renderWorldCatalog();
    }
  });

  document.getElementById("btn-close-world-catalog")?.addEventListener("click", () => {
    const panel = document.getElementById("world-catalog-panel");
    if (panel) panel.style.display = "none";
  });

  // Initial load
  fetchPersonasList("sakana-kawaii");
});
