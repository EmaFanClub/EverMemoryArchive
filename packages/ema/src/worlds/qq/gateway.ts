/**
 * @prism-shadow/ema - QQ / Snowluma Gateway Remote & Reverse Proxy Client
 *
 * Implements decoupled connectivity to remote or reverse-proxied OneBot 11 / Snowluma gateways:
 * - HTTP API caller supporting reverse proxy base paths, auth tokens, and custom proxy headers
 * - Webhook HMAC-SHA1 signature verification (X-Signature: sha1=...)
 * - Forward WebSocket client for duplex event streaming and action dispatching
 * - Automatic gateway health and login info discovery
 */

import crypto from "node:crypto";
import {
  type OneBotApiCall,
  type OneBotApiResponse,
  type OneBotEvent,
} from "./types.js";

export interface GatewayClientOptions {
  /** HTTP/HTTPS gateway base URL (e.g. "https://snowluma.proxy.domain/api") */
  gatewayUrl?: string;
  /** WebSocket gateway URL (e.g. "wss://snowluma.proxy.domain/ws") */
  gatewayWsUrl?: string;
  /** Gateway Bearer token */
  gatewayToken?: string;
  /** Custom HTTP headers forwarded to reverse-proxied gateway */
  gatewayHeaders?: Record<string, string>;
  /** Webhook secret for HMAC-SHA1 validation */
  webhookSecret?: string;
  /** Request timeout in milliseconds (default: 15000) */
  timeoutMs?: number;
}

/**
 * Creates an HTTP OneBot 11 API caller function for dispatching actions to a reverse-proxied gateway.
 */
export function createOneBotHttpCaller(
  options: GatewayClientOptions,
): (call: OneBotApiCall) => Promise<OneBotApiResponse> {
  const baseUrl = (options.gatewayUrl || "").replace(/\/+$/, "");
  const token = options.gatewayToken;
  const customHeaders = options.gatewayHeaders || {};
  const timeoutMs = options.timeoutMs ?? 15000;

  return async (call: OneBotApiCall): Promise<OneBotApiResponse> => {
    if (!baseUrl) {
      throw new Error("No gatewayUrl configured for OneBot HTTP caller");
    }

    const endpoint = `${baseUrl}/${call.action}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...customHeaders,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(call.params),
        signal: controller.signal,
      });

      if (!res.ok) {
        return {
          status: "failed",
          retcode: res.status,
          message: `HTTP error ${res.status}: ${await res.text().catch(() => "")}`,
          echo: call.echo,
        };
      }

      const json = (await res.json()) as OneBotApiResponse;
      if (call.echo && !json.echo) {
        json.echo = call.echo;
      }
      return json;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "failed",
        retcode: -1,
        message: `Gateway dispatch failure: ${message}`,
        echo: call.echo,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Verifies an inbound webhook HMAC-SHA1 signature from a reverse proxy or OneBot server.
 */
export function verifyOneBotWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader?: string,
  secret?: string,
): boolean {
  if (!secret) return true;
  if (!signatureHeader) return false;

  const expectedPrefix = "sha1=";
  if (!signatureHeader.startsWith(expectedPrefix)) return false;

  const signature = signatureHeader.slice(expectedPrefix.length).trim();
  const hmac = crypto
    .createHmac("sha1", secret)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(hmac, "hex"),
    );
  } catch {
    return false;
  }
}

/**
 * Queries the remote or reverse-proxied gateway for login information (/get_login_info).
 */
export async function queryGatewayLoginInfo(
  caller: (call: OneBotApiCall) => Promise<OneBotApiResponse> | OneBotApiResponse,
): Promise<{ userId?: string; nickname?: string } | null> {
  try {
    const res = await caller({ action: "get_login_info", params: {} });
    if (res.status === "ok" && res.data && typeof res.data === "object") {
      const data = res.data as Record<string, unknown>;
      return {
        userId: data.user_id !== undefined ? String(data.user_id) : undefined,
        nickname: typeof data.nickname === "string" ? data.nickname : undefined,
      };
    }
  } catch {
    // Non-blocking fallback
  }
  return null;
}

/**
 * Queries the gateway for status and version information (/get_status, /get_version_info).
 */
export async function queryGatewayHealth(
  caller: (call: OneBotApiCall) => Promise<OneBotApiResponse> | OneBotApiResponse,
): Promise<{
  connected: boolean;
  online?: boolean;
  good?: boolean;
  appName?: string;
  appVersion?: string;
  error?: string;
}> {
  try {
    const statusRes = await caller({ action: "get_status", params: {} });
    const versionRes = await Promise.resolve(
      caller({ action: "get_version_info", params: {} }),
    ).catch(() => null);

    const isConnected = statusRes.status === "ok" || statusRes.retcode === 0;
    const statusData = (statusRes.data as Record<string, unknown>) || {};
    const versionData = (versionRes?.data as Record<string, unknown>) || {};

    return {
      connected: isConnected,
      online: statusData.online !== false,
      good: statusData.good !== false,
      appName: typeof versionData.app_name === "string" ? versionData.app_name : undefined,
      appVersion: typeof versionData.app_version === "string" ? versionData.app_version : undefined,
    };
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Forward WebSocket client connection to a remote or reverse-proxied OneBot 11 gateway.
 */
export class OneBotWebSocketClient {
  private wsUrl: string;
  private token?: string;
  private headers: Record<string, string>;
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDisposed = false;
  private pendingEchos = new Map<
    string,
    { resolve: (res: OneBotApiResponse) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private eventListeners = new Set<(event: OneBotEvent) => void>();

  constructor(options: {
    wsUrl: string;
    token?: string;
    headers?: Record<string, string>;
  }) {
    this.wsUrl = options.wsUrl;
    this.token = options.token;
    this.headers = options.headers || {};
  }

  connect(): void {
    if (this.isDisposed || this.ws) return;

    try {
      const url = new URL(this.wsUrl);
      if (this.token && !url.searchParams.has("access_token")) {
        url.searchParams.set("access_token", this.token);
      }

      const ws = new globalThis.WebSocket(url.toString());
      this.ws = ws;

      ws.onopen = () => {
        // Connected to reverse proxy / OneBot gateway
      };

      ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === "string" ? event.data : event.data.toString();
          const parsed = JSON.parse(raw) as Record<string, unknown>;

          // Check if this is an API call response with echo
          if (parsed.echo && typeof parsed.echo === "string") {
            const pending = this.pendingEchos.get(parsed.echo);
            if (pending) {
              clearTimeout(pending.timer);
              this.pendingEchos.delete(parsed.echo);
              pending.resolve(parsed as unknown as OneBotApiResponse);
              return;
            }
          }

          // Otherwise if it's an event (has post_type)
          if (parsed.post_type) {
            for (const listener of this.eventListeners) {
              try {
                listener(parsed as unknown as OneBotEvent);
              } catch (listenerErr) {
                console.error("[OneBotWebSocketClient] Error in event listener:", listenerErr);
              }
            }
          }
        } catch {
          // Ignore invalid JSON frame
        }
      };

      ws.onerror = (err) => {
        // Log or handle socket error
      };

      ws.onclose = () => {
        this.ws = null;
        if (!this.isDisposed) {
          this.scheduleReconnect();
        }
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  onEvent(listener: (event: OneBotEvent) => void): { dispose: () => void } {
    this.eventListeners.add(listener);
    return {
      dispose: () => {
        this.eventListeners.delete(listener);
      },
    };
  }

  async call(call: OneBotApiCall, timeoutMs = 15000): Promise<OneBotApiResponse> {
    if (!this.ws || this.ws.readyState !== 1) {
      throw new Error("OneBot WebSocket is not connected");
    }

    const echo = call.echo || `ws-echo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      action: call.action,
      params: call.params,
      echo,
    };

    return new Promise<OneBotApiResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingEchos.delete(echo);
        reject(new Error(`WebSocket API call '${call.action}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingEchos.set(echo, { resolve, reject, timer });
      try {
        this.ws!.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pendingEchos.delete(echo);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isDisposed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  dispose(): void {
    this.isDisposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [, pending] of this.pendingEchos) {
      clearTimeout(pending.timer);
      pending.reject(new Error("WebSocket client disposed"));
    }
    this.pendingEchos.clear();
    this.eventListeners.clear();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
  }
}
