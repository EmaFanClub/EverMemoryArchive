/**
 * @prism-shadow/ema - Penguin Server HTTP/SSE LLM Client for Training & Evaluation
 *
 * Talks directly to the PenguinHarness server (`PENGUIN_API_URL` + `PENGUIN_API_TOKEN`)
 * with zero CLI process-spawn overhead, exact `token_usage` telemetry capture, and
 * automatic cleanup (`DELETE /api/sessions/:id`) of temporary training sessions.
 */

import type { LlmCallMetrics } from "./types.js";

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
  const pricing = MODEL_PRICING_PER_M[modelId || "gemini-3.8-flash"] ||
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
   * Executes a single prompt against the specified agent/model with automatic retry
   * on transient / rate-limit errors, and cleans up the temporary session.
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

  private async completeOnce(prompt: string, options: LlmCallOptions = {}): Promise<LlmCallResponse> {
    const startedAt = Date.now();
    const projectId = options.projectId || this.defaultProjectId;
    const agentId = options.agentId || "shirobana";
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

      // Wait for initial task_state frame
      for (;;) {
        const { done, value } = await iterator.next();
        if (done || !value) throw new Error("SSE stream closed before ready");
        if (value.event === "server_event") {
          const ev = JSON.parse(value.data);
          if (ev.type === "task_state") break;
        }
      }

      // Post the task
      await this.requestJson(
        "POST",
        `/api/sessions/${encodeURIComponent(sessionId)}/tasks`,
        {
          input: [{ type: "text", text: prompt }],
        },
      );

      // Consume frames until task_state === "idle"
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
      // Delete temporary training session to keep Web UI clean
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

export function sumMetrics(list: LlmCallMetrics[]): LlmCallMetrics {
  return list.reduce(
    (acc, m) => ({
      latencyMs: acc.latencyMs + m.latencyMs,
      promptTokens: acc.promptTokens + m.promptTokens,
      cachedTokens: acc.cachedTokens + m.cachedTokens,
      thoughtsTokens: acc.thoughtsTokens + m.thoughtsTokens,
      responseTokens: acc.responseTokens + m.responseTokens,
      totalTokens: acc.totalTokens + m.totalTokens,
      costUsd: acc.costUsd + m.costUsd,
    }),
    {
      latencyMs: 0,
      promptTokens: 0,
      cachedTokens: 0,
      thoughtsTokens: 0,
      responseTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    },
  );
}
