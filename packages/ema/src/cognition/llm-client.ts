/**
 * @prism-shadow/ema - Penguin Server HTTP/SSE LLM Client & Route Session Reader (RFC-0003 ~ RFC-0007)
 *
 * 1. Talks directly to the PenguinHarness server (`PENGUIN_API_URL` + `PENGUIN_API_TOKEN`)
 *    with zero CLI process-spawn overhead, exact `token_usage` telemetry capture, and
 *    automatic cleanup (`DELETE /api/sessions/:id`) of ephemeral worker sessions.
 * 2. Inspects live Actor Route Sessions (`resolveRouteSession`, `readRouteSessionTurns`)
 *    non-destructively so `compact` (RFC-0006) and `dreaming` (RFC-0007) can execute
 *    in parallel in the background while the Route Session continues serving user inputs.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LiveConversationTurn, LlmCallMetrics } from "./types.js";

export interface LlmCallOptions {
  agentId?: string;
  projectId?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: "low" | "medium" | "high" | "xhigh" | "max";
  workspace?: string;
  timeoutMs?: number;
}

export interface LlmCallResponse {
  text: string;
  thinking: string;
  metrics: LlmCallMetrics;
  sessionId: string;
}

export interface RouteSessionMetadata {
  sessionId: string;
  agentId: string;
  projectId: string;
  status: string;
  title?: string;
  tracePath?: string;
  traceShardPaths?: string[];
}

const MODEL_PRICING_PER_M: Record<
  string,
  { cacheRead: number; cacheWrite: number; output: number }
> = {
  "gemini-3.8-flash": { cacheRead: 0.075, cacheWrite: 0.75, output: 3.75 },
  "gemini-3.6-flash": { cacheRead: 0.075, cacheWrite: 0.75, output: 3.75 },
  "gemini-4-argon": { cacheRead: 0.1, cacheWrite: 2.0, output: 10.0 },
  "gemini-3.5-flash": { cacheRead: 0.15, cacheWrite: 1.5, output: 9.0 },
  "gemini-3.5-flash-lite": { cacheRead: 0.03, cacheWrite: 0.3, output: 2.5 },
  "gemini-3.1-flash-lite": { cacheRead: 0.025, cacheWrite: 0.25, output: 1.5 },
  "gemini-3.1-pro-preview": { cacheRead: 0.2, cacheWrite: 2.0, output: 12.0 },
  "deepseek-flash": { cacheRead: 0.005714, cacheWrite: 0.285714, output: 1.142857 },
  "deepseek-v4-pro": { cacheRead: 0.042857, cacheWrite: 1.285714, output: 3.857143 },
};

export function estimateCostUsd(
  modelId: string | undefined,
  cachedTokens: number,
  promptTokens: number,
  outputTokens: number,
): number {
  const pricing =
    MODEL_PRICING_PER_M[modelId || "gemini-3.8-flash"] ||
    MODEL_PRICING_PER_M["gemini-3.8-flash"];
  const cost =
    (cachedTokens / 1_000_000) * pricing.cacheRead +
    (promptTokens / 1_000_000) * pricing.cacheWrite +
    (outputTokens / 1_000_000) * pricing.output;
  return Number(cost.toFixed(6));
}

interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let id: string | undefined;
  let event: string | undefined;
  let data: string[] = [];

  const flush = (): SseFrame | null => {
    if (data.length === 0 && event === undefined) {
      id = undefined;
      event = undefined;
      return null;
    }
    const frame: SseFrame = {
      ...(id !== undefined ? { id } : {}),
      ...(event !== undefined ? { event } : {}),
      data: data.join("\n"),
    };
    event = undefined;
    data = [];
    return frame;
  };

  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl === -1) break;
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          const frame = flush();
          if (frame) yield frame;
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let val = colon === -1 ? "" : line.slice(colon + 1);
        if (val.startsWith(" ")) val = val.slice(1);
        if (field === "data") data.push(val);
        else if (field === "event") event = val;
        else if (field === "id") id = val;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
}

export class PenguinServerLLMClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly defaultProjectId: string;
  private readonly defaultWorkspace: string;

  constructor(options?: {
    baseUrl?: string;
    token?: string;
    projectId?: string;
    workspace?: string;
  }) {
    const baseUrl = options?.baseUrl || process.env.PENGUIN_API_URL || "http://127.0.0.1:25750";
    const token = options?.token || process.env.PENGUIN_API_TOKEN || "";
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token.trim();
    this.defaultProjectId =
      options?.projectId || process.env.PENGUIN_PROJECT_ID || "default_project";
    this.defaultWorkspace = options?.workspace || process.cwd();
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  private async requestJson<T = any>(
    method: string,
    apiPath: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${apiPath}`, {
      method,
      headers: this.headers(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} on ${method} ${apiPath}: ${errText}`);
    }
    if (res.status === 204 || res.headers.get("content-length") === "0") {
      return undefined as unknown as T;
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Resolves a full or short session ID (e.g. "619e98db") to its Penguin session metadata & tracePath(s).
   */
  async resolveRouteSession(
    agentId: string,
    sessionIdOrSuffix: string,
    projectId = this.defaultProjectId,
  ): Promise<RouteSessionMetadata> {
    let resolvedMeta: RouteSessionMetadata | null = null;
    try {
      const direct = await this.requestJson<{ session: RouteSessionMetadata }>(
        "GET",
        `/api/sessions/${encodeURIComponent(sessionIdOrSuffix)}`,
      );
      if (direct?.session?.sessionId) {
        resolvedMeta = direct.session;
      }
    } catch {
      // Fallback: list agent sessions and match suffix
    }

    if (!resolvedMeta) {
      try {
        const listed = await this.requestJson<{ sessions: Array<{ sessionId: string }> }>(
          "GET",
          `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sessions`,
        );
        const match = (listed?.sessions || []).find(
          (s) =>
            s.sessionId === sessionIdOrSuffix ||
            s.sessionId.endsWith(`-${sessionIdOrSuffix}`) ||
            s.sessionId.endsWith(sessionIdOrSuffix),
        );
        if (match) {
          const full = await this.requestJson<{ session: RouteSessionMetadata }>(
            "GET",
            `/api/sessions/${encodeURIComponent(match.sessionId)}`,
          );
          if (full?.session) resolvedMeta = full.session;
        }
      } catch {
        // Fallback to local filesystem trace discovery
      }
    }

    const fullId = resolvedMeta?.sessionId || sessionIdOrSuffix;
    const appDataDir =
      process.env.PENGUIN_APP_DATA_DIR ||
      path.join(os.homedir(), ".penguin", "data", projectId);
    const tracesRoot = path.join(appDataDir, "agents", agentId, "traces");
    const shardPaths: string[] = [];
    if (fs.existsSync(tracesRoot)) {
      for (const dateDir of fs.readdirSync(tracesRoot).sort()) {
        const subDir = path.join(tracesRoot, dateDir);
        if (!fs.statSync(subDir).isDirectory()) continue;
        const files = fs
          .readdirSync(subDir)
          .filter((f) => f.includes(fullId) && f.endsWith(".jsonl"))
          .sort();
        for (const f of files) {
          shardPaths.push(path.join(subDir, f));
        }
      }
    }

    return {
      sessionId: fullId,
      agentId,
      projectId,
      status: resolvedMeta?.status || "idle",
      title: resolvedMeta?.title,
      tracePath:
        resolvedMeta?.tracePath ||
        (shardPaths.length > 0 ? shardPaths[shardPaths.length - 1] : undefined),
      traceShardPaths: shardPaths.length > 0 ? shardPaths : undefined,
    };
  }

  /**
   * Triggers PenguinHarness's native context rotation (`POST /api/sessions/:sessionId/compact`)
   * on an idle Route Session so `openNextContext` re-reads the updated `AGENTS.md` (with the new
   * `Personality` and `MemoryIndex`) into the Route Session's live system prompt in-place.
   */
  async triggerRouteSessionContextRefresh(
    sessionIdOrSuffix: string,
    agentId = "aoi_rei",
    timeoutMs = 90_000,
  ): Promise<boolean> {
    const meta = await this.resolveRouteSession(agentId, sessionIdOrSuffix);
    const fullSessionId = meta.sessionId;
    try {
      await this.requestJson(
        "POST",
        `/api/sessions/${encodeURIComponent(fullSessionId)}/compact`,
        {},
      );
    } catch {
      return false;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const check = await this.requestJson<{ session: { status: string } }>(
          "GET",
          `/api/sessions/${encodeURIComponent(fullSessionId)}`,
        );
        if (check?.session?.status === "idle") {
          return true;
        }
      } catch {
        break;
      }
    }
    return false;
  }

  /**
   * Executes a single prompt in an isolated ephemeral worker session with automatic retry
   * and guaranteed `DELETE /api/sessions/:id` cleanup so it never blocks or clutters
   * the Actor's primary Route Session.
   */
  async complete(prompt: string, options: LlmCallOptions = {}): Promise<LlmCallResponse> {
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.completeOnce(prompt, options);
      } catch (err: any) {
        lastError = err;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
    }
    throw lastError;
  }

  private async completeOnce(
    prompt: string,
    options: LlmCallOptions = {},
  ): Promise<LlmCallResponse> {
    const startedAt = Date.now();
    const projectId = options.projectId || this.defaultProjectId;
    const agentId = options.agentId || "ema_minimal";
    const workspace = options.workspace || this.defaultWorkspace;
    const timeoutMs = options.timeoutMs ?? 180_000;

    const createBody: Record<string, unknown> = {
      workspace,
      approvalMode: "deny-all",
      source: "cli",
      client: "cli",
    };
    if (options.provider && options.modelId) {
      createBody.provider = options.provider;
      createBody.modelId = options.modelId;
    }

    const created = await this.requestJson<{ session: { sessionId: string } }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sessions`,
      createBody,
    );
    const sessionId = created.session.sessionId;

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    const texts: string[] = [];
    const thinkings: string[] = [];
    let promptTokens = 0;
    let cachedTokens = 0;
    let thoughtsTokens = 0;
    let responseTokens = 0;
    let totalTokens = 0;
    let costUsd = 0;

    try {
      if (options.thinkingLevel) {
        await this.requestJson(
          "PATCH",
          `/api/sessions/${encodeURIComponent(sessionId)}`,
          { thinkingLevel: options.thinkingLevel },
        );
      }

      const sseRes = await fetch(
        `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/stream`,
        {
          headers: this.headers({ accept: "text/event-stream" }),
          signal: abortController.signal,
        },
      );
      if (!sseRes.ok || !sseRes.body) {
        throw new Error(`Failed to open SSE stream for ${sessionId}: HTTP ${sseRes.status}`);
      }

      const iterator = parseSseStream(sseRes.body, abortController.signal);

      for (;;) {
        const { done, value } = await iterator.next();
        if (done || !value) throw new Error("SSE stream closed before ready");
        if (value.event === "server_event") {
          const ev = JSON.parse(value.data);
          if (ev.type === "task_state") break;
        }
      }

      await this.requestJson(
        "POST",
        `/api/sessions/${encodeURIComponent(sessionId)}/tasks`,
        {
          input: [{ type: "text", text: prompt }],
        },
      );

      for (;;) {
        const { done, value: frame } = await iterator.next();
        if (done || !frame) break;

        if (frame.event === "server_event") {
          const ev = JSON.parse(frame.data);
          if (ev.type === "task_state" && ev.state === "idle") {
            break;
          }
          if (ev.type === "approval_request" && ev.toolCall?.payload?.tool_call_id) {
            await this.requestJson(
              "POST",
              `/api/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(ev.toolCall.payload.tool_call_id)}`,
              { decision: "deny" },
            ).catch(() => {});
          }
          continue;
        }

        if (frame.event !== undefined) continue;

        try {
          const msg = JSON.parse(frame.data);
          const p = msg?.payload;
          if (!p) continue;

          if ((msg.origin?.length ?? 0) === 0) {
            if (p.type === "text" && p.role !== "user" && typeof p.text === "string") {
              texts.push(p.text);
            } else if (p.type === "thinking" && typeof p.thinking === "string") {
              thinkings.push(p.thinking);
            } else if (p.type === "token_usage") {
              const req = p.request || p.last_request || p.usage || p;
              promptTokens += Number(
                req.cache_write ?? req.prompt_tokens ?? req.input_tokens ?? req.input ?? 0,
              );
              cachedTokens += Number(
                req.cache_read ?? req.cached_tokens ?? req.cache_read_tokens ?? req.cached ?? 0,
              );
              thoughtsTokens += Number(
                req.thoughts_tokens ?? req.reasoning_tokens ?? req.thinking ?? 0,
              );
              responseTokens += Number(
                req.output ?? req.response_tokens ?? req.output_tokens ?? 0,
              );
              totalTokens += Number(req.total ?? req.total_tokens ?? 0);
            } else if (p.type === "request_end" && p.status && p.status === "fatal") {
              throw new Error(
                `Model request failed (${p.status}): ${p.error_message || p.error_code || "unknown error"}`,
              );
            }
          }
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("Model request failed")) {
            throw err;
          }
        }
      }
    } finally {
      clearTimeout(timer);
      abortController.abort();
      await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        headers: this.headers(),
      }).catch(() => {});
    }

    const latencyMs = Date.now() - startedAt;
    if (totalTokens === 0 && (promptTokens > 0 || cachedTokens > 0 || responseTokens > 0)) {
      totalTokens = promptTokens + cachedTokens + thoughtsTokens + responseTokens;
    }
    costUsd = estimateCostUsd(options.modelId, cachedTokens, promptTokens, responseTokens);

    return {
      text: texts.join("\n").trim(),
      thinking: thinkings.join("\n").trim(),
      sessionId,
      metrics: {
        latencyMs,
        promptTokens,
        cachedTokens,
        thoughtsTokens,
        responseTokens,
        totalTokens,
        costUsd,
      },
    };
  }
}

/**
 * Parses a Penguin session trace `.jsonl` file (or array of trace records) into committed
 * `LiveConversationTurn[]` tuples `<Input_t, latentOS_t, Action_t>`.
 *
 * Concurrency-safe for parallel Route Sessions: any trailing in-flight user turn that does not
 * yet have a committed assistant text reply is ignored until its reply lands.
 */
export function parseSessionTraceTurns(
  traceJsonlContent: string,
  options?: {
    sessionId?: string;
    defaultSender?: string;
    defaultChannel?: string;
  },
): LiveConversationTurn[] {
  const sessionTag = (options?.sessionId || "session").slice(-8);
  const defaultSender = options?.defaultSender || "Owner";
  const defaultChannel = options?.defaultChannel || "direct";

  const lines = traceJsonlContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const turns: LiveConversationTurn[] = [];
  let pendingUser: {
    timestamp: string;
    rawText: string;
    toolOutputs: string[];
    thinkingChunks: string[];
    textChunks: string[];
  } | null = null;

  const flushPending = () => {
    if (!pendingUser || pendingUser.textChunks.length === 0) return;

    const rawUserText = pendingUser.rawText.trim();
    const rawAssistantPreview = pendingUser.textChunks.join("\n").trim();
    // Skip Penguin internal compaction summary prompts & context_summary headers
    if (
      rawUserText.startsWith("[context_summary]") ||
      rawUserText.startsWith("Summarize the task transcript above") ||
      rawAssistantPreview.startsWith("[summary]")
    ) {
      pendingUser = null;
      return;
    }

    let sender = defaultSender;
    let channel = defaultChannel;
    let inputText = rawUserText;

    // Detect QQ Runner wrapper format: [来自 QQ 群 "..." (1044916258) 中 @你的消息]:
    const qqMatch = rawUserText.match(
      /^\[来自\s*QQ\s*群\s*"([^"]*)"\s*\((\d+)\)[^\]]*\]:\s*\n发送人:\s*([^\n]+)\n消息内容:\s*([\s\S]*?)(?:\n\n请以伴侣身份[\s\S]*)?$/,
    );
    if (qqMatch) {
      channel = `qq:group:${qqMatch[2]}`;
      sender = qqMatch[3].trim();
      inputText = `[QQ群「${qqMatch[1]}」- ${sender}]: ${qqMatch[4].trim()}`;
    } else {
      // Detect Web / Channel XML wrapper if present
      const chMatch = rawUserText.match(/<Channel>([^<]+)<\/Channel>/i);
      if (chMatch) {
        channel = chMatch[1].trim();
      }
      const nameMatch = rawUserText.match(/<Name>([^<]+)<\/Name>/i);
      if (nameMatch) {
        sender = nameMatch[1].trim();
      }
      const msgMatches = [...rawUserText.matchAll(/<Message[^>]*>([\s\S]*?)<\/Message>/gi)];
      if (msgMatches.length > 0) {
        inputText = msgMatches.map((m) => m[1].trim()).join(" / ");
      } else if (rawUserText.includes("[RFC-0002 Channel Event]") && pendingUser.toolOutputs.length > 0) {
        inputText = `[频道消息事件 (${channel})]: ${pendingUser.toolOutputs.join(" ").slice(0, 360)}`;
      }
    }

    const rawAssistantText = pendingUser.textChunks.join("\n").trim();
    const osTagMatch = rawAssistantText.match(/<OS>([\s\S]*?)<\/OS>/i);
    const actionTagMatch = rawAssistantText.match(/<Action>([\s\S]*?)<\/Action>/i);

    let latentOS = "";
    let actionText = rawAssistantText;

    if (osTagMatch && actionTagMatch) {
      latentOS = osTagMatch[1].trim();
      actionText = actionTagMatch[1].trim();
    } else {
      actionText = rawAssistantText
        .replace(/<OS>[\s\S]*?<\/OS>/gi, "")
        .replace(/<\/?Action>/gi, "")
        .trim();
      if (osTagMatch) {
        latentOS = osTagMatch[1].trim();
      } else if (pendingUser.thinkingChunks.length > 0) {
        latentOS = pendingUser.thinkingChunks
          .join(" ")
          .replace(/\*\*[^*]+\*\*/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 260);
      } else {
        latentOS = "（静静倾听着对方的话语，在心里温和地整理回应的思绪）";
      }
    }

    const turnIndex = turns.length + 1;
    turns.push({
      turnIndex,
      turnId: `${sessionTag}#turn-${String(turnIndex).padStart(3, "0")}`,
      timestamp: pendingUser.timestamp || new Date().toISOString(),
      sender,
      channel,
      inputText,
      latentOS,
      actionText,
    });

    pendingUser = null;
  };

  let inCompactionSpan = false;

  for (const line of lines) {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.type === "event_msg") {
      if (parsed.payload?.type === "compaction_begin") {
        flushPending();
        inCompactionSpan = true;
      } else if (parsed.payload?.type === "compaction_end") {
        pendingUser = null;
        inCompactionSpan = false;
      }
      continue;
    }
    if (inCompactionSpan) continue;
    if (parsed?.type !== "model_msg" || !parsed?.payload) continue;
    const p = parsed.payload;

    if (p.type === "text" && p.role === "user" && typeof p.text === "string") {
      flushPending();
      pendingUser = {
        timestamp: parsed.timestamp || new Date().toISOString(),
        rawText: p.text,
        toolOutputs: [],
        thinkingChunks: [],
        textChunks: [],
      };
    } else if (pendingUser && p.type === "tool_call_output" && typeof p.output === "string") {
      pendingUser.toolOutputs.push(p.output.replace(/\s+/g, " ").trim());
    } else if (pendingUser && p.role === "assistant") {
      if (p.type === "thinking" && typeof p.thinking === "string") {
        pendingUser.thinkingChunks.push(p.thinking);
      } else if (p.type === "text" && typeof p.text === "string") {
        pendingUser.textChunks.push(p.text);
      }
    }
  }

  flushPending();
  return turns;
}

export function emptyMetrics(): LlmCallMetrics {
  return {
    latencyMs: 0,
    promptTokens: 0,
    cachedTokens: 0,
    thoughtsTokens: 0,
    responseTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

export function sumMetrics(list: LlmCallMetrics[]): LlmCallMetrics {
  return list.reduce(
    (acc, m) => ({
      latencyMs: acc.latencyMs + m.latencyMs,
      promptTokens: acc.promptTokens + m.promptTokens,
      cachedTokens: acc.cachedTokens + m.cachedTokens,
      thoughtsTokens: acc.thoughtsTokens + m.thoughtsTokens,
      responseTokens: acc.responseTokens + m.responseTokens,
      totalTokens: acc.totalTokens + m.totalTokens,
      costUsd: Number((acc.costUsd + m.costUsd).toFixed(6)),
    }),
    emptyMetrics(),
  );
}
