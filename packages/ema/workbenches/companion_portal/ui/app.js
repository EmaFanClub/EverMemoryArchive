const $ = (id) => document.getElementById(id);

const SDK_URL = "../sdk/workbench.js";
const POLL_RUNNING_MS = 2000;
const SETTLE_RETRY_MS = [0, 350, 1000, 2200];
const GROUP_WINDOW_MS = 5 * 60 * 1000;

let state = {
  sessionId: "",
  status: "idle",
  error: null,
  messages: [],
};
let sending = false;
let messagesSignature = "";
let pinnedToBottom = true;

let sdk; // undefined until tried, null if unavailable
let sdkPromise = null;
let liveSession = null; // { sessionId, reader, text, streaming, activity, settling }
let pollTimer = null;

async function api(route, body) {
  const res = await fetch(
    "../api" + route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  let data;
  try {
    data = JSON.parse(await res.text());
  } catch {
    throw new Error(`请求失败 (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data.error?.message || data.error || "请求失败");
  }
  return data;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateSeparator(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const timeStr = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return timeStr;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${timeStr}`;
}

function scrollToBottom(force = false) {
  const stream = $("stream");
  if (!stream) return;
  if (force || pinnedToBottom) {
    stream.scrollTop = stream.scrollHeight;
  }
}

function renderMessages() {
  const sig = JSON.stringify(state.messages.map((m) => [m.id, m.role, m.text, m.at]));
  if (sig === messagesSignature) return;
  messagesSignature = sig;

  const container = $("messages");
  const nodes = [];
  let currentGroup = null;
  let lastTimestamp = 0;

  for (const msg of state.messages) {
    const ts = Date.parse(msg.at) || 0;
    if (!lastTimestamp || ts - lastTimestamp > GROUP_WINDOW_MS) {
      const sep = document.createElement("div");
      sep.className = "time-separator";
      sep.textContent = formatDateSeparator(msg.at);
      nodes.push(sep);
      currentGroup = null;
    }
    lastTimestamp = ts;

    if (!currentGroup || currentGroup.role !== msg.role) {
      const article = document.createElement("article");
      article.className = `message-group ${msg.role === "user" ? "user" : "actor"}`;

      if (msg.role !== "user") {
        const avatar = document.createElement("span");
        avatar.className = "avatar";
        avatar.setAttribute("aria-hidden", "true");
        avatar.textContent = "怜";
        article.append(avatar);
      }

      const body = document.createElement("div");
      body.className = "group-body";
      article.append(body);
      nodes.push(article);
      currentGroup = { role: msg.role, body };
    }

    const bubble = document.createElement("div");
    bubble.className = `bubble ${msg.role === "user" ? "user" : "actor"}`;

    const p = document.createElement("p");
    p.textContent = msg.text;
    bubble.append(p);

    const time = document.createElement("span");
    time.className = "bubble-time";
    time.textContent = formatTime(msg.at);
    bubble.append(time);

    currentGroup.body.append(bubble);
  }

  container.replaceChildren(...nodes);
  scrollToBottom();
}

function renderStatus() {
  const isRunning = state.status === "running";
  $("status-dot").className = `status-dot ${isRunning ? "busy" : "online"}`;
  $("status-text").textContent = isRunning ? "正在输入..." : "在线";
  $("stop-btn").hidden = !isRunning;

  const errText = state.error;
  $("error-banner").hidden = !errText;
  if (errText) {
    $("error-banner").textContent = errText;
  }

  syncComposerButton();
  renderLiveBubble();
}

function hasChannelReplyArrived() {
  if (!state.lastUserItemId || !Array.isArray(state.messages)) return false;
  const userIdx = state.messages.findIndex((m) => m.id === state.lastUserItemId);
  if (userIdx === -1) return false;
  return state.messages.slice(userIdx + 1).some((m) => m.role === "aoi");
}

function renderLiveBubble() {
  const isRunning = state.status === "running";
  const liveGroup = $("live-group");
  if (!isRunning || hasChannelReplyArrived()) {
    liveGroup.hidden = true;
    return;
  }

  liveGroup.hidden = false;
  const draft = liveSession
    ? [liveSession.text, liveSession.streaming].filter(Boolean).join("\n\n")
    : "";

  const liveText = $("live-text");
  const liveActivity = $("live-activity");

  if (draft) {
    liveText.hidden = false;
    liveText.textContent = draft;
    liveActivity.hidden = true;
  } else {
    liveText.hidden = true;
    liveText.textContent = "";
    liveActivity.hidden = false;
    liveActivity.textContent = liveSession?.activity || "正在思考...";
  }
  scrollToBottom();
}

function loadSdk() {
  sdkPromise ??= import(SDK_URL).then(
    (m) => (sdk = m),
    () => (sdk = null),
  );
  return sdkPromise;
}

function syncLiveSubscription() {
  const wantedSessionId =
    !document.hidden && state.status === "running" && state.sessionId ? state.sessionId : null;

  if (liveSession && liveSession.sessionId === wantedSessionId) return;

  if (liveSession) {
    liveSession.reader?.close();
    liveSession = null;
  }

  if (!wantedSessionId) {
    renderLiveBubble();
    return;
  }

  const current = {
    sessionId: wantedSessionId,
    reader: null,
    text: "",
    streaming: "",
    activity: "正在思考...",
    settling: false,
  };
  liveSession = current;
  renderLiveBubble();

  loadSdk().then(() => {
    if (liveSession !== current || !sdk) return;
    try {
      current.reader = sdk.followSession(current.sessionId, { tailLimit: 1 });
      current.reader.on("event", ({ record }) => onSessionRecord(current, record));
      current.reader.on("reset", () => {
        current.text = "";
        current.streaming = "";
        renderLiveBubble();
      });
      current.reader.on("error", () => {
        current.reader = null;
      });
    } catch {
      current.reader = null;
    }
  });
}

function onSessionRecord(current, record) {
  if (liveSession !== current || record.origin?.length) return;
  const p = record.payload || {};

  if (p.type === "request_begin") {
    current.text = "";
    current.streaming = "";
  } else if (p.type === "partial_thinking") {
    current.activity = "正在思考...";
  } else if (p.type === "partial_tool_call" || p.type === "tool_call") {
    const rawArgs =
      typeof p.arguments === "string" ? p.arguments : JSON.stringify(p.arguments || {});
    if (rawArgs.includes("world get") || rawArgs.includes("/channels/")) {
      current.activity = "正在读取聊天室频道...";
    } else if (rawArgs.includes("world post") || rawArgs.includes("message.post")) {
      current.activity = "正在发送消息到频道...";
    } else {
      current.activity = "正在整理记忆...";
    }
  } else if (p.type === "tool_result") {
    void refresh();
  } else if (p.type === "partial_text" && p.role === "assistant") {
    if (p.event_type === "start") {
      current.streaming = p.text || "";
    } else if (p.event_type === "delta") {
      current.streaming += p.text || "";
    }
  } else if (p.type === "text" && p.role === "assistant") {
    current.text = [current.text, p.text].filter(Boolean).join("\n\n");
    current.streaming = "";
  } else if (p.type === "task_end") {
    void settleTurn(current);
  }

  renderLiveBubble();
}

async function settleTurn(current) {
  if (current.settling) return;
  current.settling = true;
  try {
    for (const delay of SETTLE_RETRY_MS) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (liveSession !== current) return;
      await refresh();
      if (state.status !== "running") return;
    }
  } finally {
    current.settling = false;
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (document.hidden || state.status !== "running") return;
  pollTimer = setTimeout(async () => {
    await refresh();
    schedulePoll();
  }, POLL_RUNNING_MS);
}

async function refresh() {
  try {
    const next = await api("/chat");
    state = next;
    renderMessages();
    renderStatus();
    syncLiveSubscription();
    schedulePoll();
  } catch (err) {
    $("error-banner").textContent = err.message || "无法连接服务";
    $("error-banner").hidden = false;
  }
}

function resizeInput() {
  const input = $("input");
  input.style.height = "auto";
  input.style.height = `${Math.min(120, Math.max(24, input.scrollHeight))}px`;
}

function syncComposerButton() {
  const hasText = $("input").value.trim().length > 0;
  $("send-btn").disabled = sending || state.status === "running" || !hasText;
}

async function sendMessage() {
  const input = $("input");
  const text = input.value.trim();
  if (!text || sending || state.status === "running") return;

  sending = true;
  $("error-banner").hidden = true;
  syncComposerButton();

  try {
    pinnedToBottom = true;
    state = await api("/chat", { text });
    input.value = "";
    resizeInput();
    renderMessages();
    renderStatus();
    syncLiveSubscription();
    schedulePoll();
    scrollToBottom(true);
  } catch (err) {
    $("error-banner").textContent = err.message || "发送失败，请重试";
    $("error-banner").hidden = false;
  } finally {
    sending = false;
    syncComposerButton();
    input.focus();
  }
}

$("stream").addEventListener(
  "scroll",
  () => {
    const el = $("stream");
    pinnedToBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 36;
  },
  { passive: true },
);

$("input").addEventListener("input", () => {
  resizeInput();
  syncComposerButton();
});

$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void sendMessage();
  }
});

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  void sendMessage();
});

$("stop-btn").addEventListener("click", async () => {
  if (!state.sessionId) return;
  await loadSdk();
  if (sdk?.abortSession) {
    try {
      await sdk.abortSession(state.sessionId);
    } catch {}
  }
  setTimeout(() => void refresh(), 300);
});

$("reset-btn").addEventListener("click", async () => {
  if (sending) return;
  sending = true;
  try {
    state = await api("/reset", {});
    messagesSignature = "";
    pinnedToBottom = true;
    renderMessages();
    renderStatus();
    syncLiveSubscription();
    $("input").focus();
  } catch (err) {
    $("error-banner").textContent = err.message || "重置会话失败";
    $("error-banner").hidden = false;
  } finally {
    sending = false;
    syncComposerButton();
  }
});

document.addEventListener("visibilitychange", () => {
  syncLiveSubscription();
  if (!document.hidden) void refresh();
});

void refresh();
