import { WebSocket } from "undici";

import type { ActorChatResponse } from "../actor";
import { Logger } from "../logger";
import type { Server } from "../server";
import type {
  Channel,
  ChannelAdapter,
  ChannelAdapterFactory,
  ChannelAPICall,
  ChannelClient,
  ChannelClientStatus,
  ChannelResponse,
  ChannelStartOptions,
} from "./base";
import { formatReplyRef, parseReplyRef } from "./utils";

const DEFAULT_START_MAX_ATTEMPTS = 100_000_000;
const DEFAULT_START_RETRY_DELAY_MS = 60_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

interface PendingRequest {
  resolve: (response: ChannelResponse | null) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

export class WebsocketChannelClient implements Channel, ChannelClient {
  readonly name: string;
  readonly actorId: number;
  readonly url: string;
  readonly adapter: ChannelAdapter;

  private readonly accessToken: string | null;
  private readonly server: Server;
  private readonly logger: Logger;

  private enabled = true;
  private status: ChannelClientStatus = "exhausted";
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retrySleepResolver: (() => void) | null = null;
  private loopPromise: Promise<void> | null = null;
  private loopVersion = 0;
  private requestSeq = 0;
  private readonly pendingRequests = new Map<string, PendingRequest>();

  private constructor(
    channel: string,
    actorId: number,
    url: string,
    server: Server,
    adapterFactory: ChannelAdapterFactory,
    enabled: boolean,
    accessToken: string | null,
  ) {
    this.name = channel;
    this.actorId = actorId;
    this.url = url;
    this.server = server;
    this.accessToken = accessToken;
    this.logger = Logger.create({
      name: `channel:${channel}`,
      level: "debug",
      transport: "console",
    });
    this.enabled = enabled;
    this.adapter = adapterFactory(this.call.bind(this));
  }

  static async create(
    channel: string,
    actorId: number,
    url: string,
    server: Server,
    adapterFactory: ChannelAdapterFactory,
    accessToken: string | null = null,
  ): Promise<WebsocketChannelClient> {
    const enabled = true;
    return new WebsocketChannelClient(
      channel,
      actorId,
      url,
      server,
      adapterFactory,
      enabled,
      accessToken?.trim() || null,
    );
  }

  getStatus(): ChannelClientStatus {
    return this.status;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async enable(): Promise<void> {
    this.enabled = true;
  }

  start(options: ChannelStartOptions = {}): void {
    if (!this.enabled || this.loopPromise) {
      return;
    }

    const maxAttempts = options.maxAttempts ?? DEFAULT_START_MAX_ATTEMPTS;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_START_RETRY_DELAY_MS;
    const connectTimeoutMs =
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    const loopVersion = ++this.loopVersion;
    const runningPromise = this.runLoop(
      loopVersion,
      Math.max(1, maxAttempts),
      Math.max(0, retryDelayMs),
      Math.max(0, connectTimeoutMs),
    );
    const trackedPromise = runningPromise.finally(() => {
      if (this.loopPromise === trackedPromise) {
        this.loopPromise = null;
      }
    });
    this.loopPromise = trackedPromise;
    this.loopPromise.catch((error) => {
      this.logger.error(`Channel client loop failed for ${this.name}:`, error);
    });
  }

  async close(): Promise<void> {
    this.loopVersion += 1;
    this.status = "exhausted";
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.retrySleepResolver) {
      this.retrySleepResolver();
      this.retrySleepResolver = null;
    }
    this.clearPendingRequests();
    this.closeSocket();
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
    }
  }

  async disable(): Promise<void> {
    this.enabled = false;
    await this.close();
  }

  async send(response: ActorChatResponse): Promise<void> {
    const normalizedResponse = await this.normalizeResponseReply(response);
    const apiCall = await this.adapter.chatToAPICall(normalizedResponse);
    if (!apiCall) {
      return;
    }

    const channelResponse = await this.call(apiCall);
    if (!channelResponse) {
      this.logger.warn(
        `No response received when sending ${this.name} message for conversation ${response.conversationId}, msgId ${response.msgId}.`,
      );
      return;
    }
    if (!channelResponse.ok) {
      this.logger.warn(
        `Failed to send ${this.name} message for conversation ${response.conversationId}, msgId ${response.msgId}: ${JSON.stringify(channelResponse.error ?? channelResponse.data ?? null)}`,
      );
      return;
    }

    const channelMessageId = this.adapter.resolveChannelMessageId(
      channelResponse,
      apiCall,
    );
    if (!channelMessageId) {
      return;
    }

    this.server.gateway.rememberMessageMapping(
      response.conversationId,
      response.msgId,
      channelMessageId,
    );
    await this.persistDeliveredChannelMessageId(
      response.conversationId,
      response.msgId,
      channelMessageId,
    );
  }

  async call(
    apiCall: ChannelAPICall,
    options?: { timeoutMs?: number },
  ): Promise<ChannelResponse | null> {
    if (!this.enabled) {
      throw new Error(`Channel '${this.name}' is disabled.`);
    }
    if (this.status !== "connected" || !this.socket) {
      throw new Error(`Channel '${this.name}' is not connected.`);
    }

    const socket = this.socket;
    const requestId = this.buildRequestId();
    const payload = await this.adapter.encode(apiCall, requestId);
    if (!payload) {
      return null;
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    return await new Promise<ChannelResponse | null>((resolve, reject) => {
      const timeout =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pendingRequests.delete(requestId);
              this.logger.warn(
                `Timed out waiting for ${this.name} response (${apiCall.method}, requestId=${requestId}, timeout=${timeoutMs}ms).`,
              );
              resolve(null);
            }, timeoutMs)
          : null;

      this.pendingRequests.set(requestId, { resolve, timeout });

      try {
        socket.send(payload);
      } catch (error) {
        if (timeout) {
          clearTimeout(timeout);
        }
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }

  private async runLoop(
    loopVersion: number,
    maxAttempts: number,
    retryDelayMs: number,
    connectTimeoutMs: number,
  ): Promise<void> {
    while (this.enabled && this.loopVersion === loopVersion) {
      let connected = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (!this.enabled || this.loopVersion !== loopVersion) {
          return;
        }
        this.logger.info(
          `Attempting to connect ${this.name} (attempt ${attempt}/${maxAttempts}, timeout ${connectTimeoutMs}ms)...`,
        );
        this.status = "connecting";

        try {
          const socket = await this.connectOnce(loopVersion, connectTimeoutMs);
          if (!socket) {
            return;
          }
          connected = true;
          this.status = "connected";
          this.logger.info(`Connected ${this.name} to ${this.url}.`);
          await this.waitForSocketClose(socket, loopVersion);
          break;
        } catch (error) {
          this.closeSocket();
          if (attempt >= maxAttempts) {
            this.status = "exhausted";
            this.logger.error(
              `Failed to connect ${this.name} after ${maxAttempts} attempts:`,
              error,
            );
            return;
          }
          this.logger.warn(
            `Failed to connect ${this.name} (attempt ${attempt}/${maxAttempts}):`,
            error,
          );
          await this.sleep(retryDelayMs, loopVersion);
        }
      }

      if (!connected || !this.enabled || this.loopVersion !== loopVersion) {
        return;
      }

      this.status = "connecting";
      await this.sleep(retryDelayMs, loopVersion);
    }
  }

  private async connectOnce(
    loopVersion: number,
    connectTimeoutMs: number,
  ): Promise<WebSocket | null> {
    const init = this.buildWebSocketInit();
    const socket = init
      ? new WebSocket(this.url, init)
      : new WebSocket(this.url);
    this.socket = socket;

    return await new Promise<WebSocket | null>((resolve, reject) => {
      let settled = false;
      const timeout =
        connectTimeoutMs > 0
          ? setTimeout(() => {
              if (settled) {
                return;
              }
              settled = true;
              cleanup();
              this.closeSocket(socket);
              reject(
                new Error(
                  `Timed out opening websocket '${this.url}' after ${connectTimeoutMs}ms.`,
                ),
              );
            }, connectTimeoutMs)
          : null;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
      };

      const handleOpen = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (!this.enabled || this.loopVersion !== loopVersion) {
          this.closeSocket(socket);
          resolve(null);
          return;
        }
        socket.addEventListener("message", (event) => {
          this.handleSocketMessage(event.data);
        });
        resolve(socket);
      };

      const handleError = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.closeSocket(socket);
        reject(new Error(`Failed to open websocket '${this.url}'.`));
      };

      const handleClose = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error(`Websocket '${this.url}' closed before opening.`));
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    });
  }

  private async waitForSocketClose(
    socket: WebSocket,
    loopVersion: number,
  ): Promise<void> {
    if (
      socket.readyState === WebSocket.CLOSING ||
      socket.readyState === WebSocket.CLOSED
    ) {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.clearPendingRequests();
      this.logger.warn(
        `Disconnected ${this.name} from ${this.url} before close event could be observed.`,
      );
      return;
    }

    await new Promise<void>((resolve) => {
      const handleClose = (event: Event) => {
        socket.removeEventListener("close", handleClose);
        if (this.socket === socket) {
          this.socket = null;
        }
        this.clearPendingRequests();
        const code =
          "code" in event && typeof event.code === "number"
            ? event.code
            : undefined;
        const reason =
          "reason" in event && typeof event.reason === "string"
            ? event.reason
            : "";
        this.logger.warn(
          `Disconnected ${this.name} from ${this.url}${
            typeof code === "number" ? ` (code=${code}` : ""
          }${
            typeof code === "number"
              ? `, reason=${JSON.stringify(reason || "")})`
              : "."
          }`,
        );
        resolve();
      };
      socket.addEventListener("close", handleClose);
    });

    if (!this.enabled || this.loopVersion !== loopVersion) {
      this.status = "exhausted";
    }
  }

  private async handleSocketMessage(raw: unknown): Promise<void> {
    try {
      const normalized = this.normalizeIncomingRaw(raw);
      const decoded = await this.adapter.decode(normalized);
      if (decoded.kind === "ignore") {
        return;
      }
      if (decoded.kind === "response") {
        this.resolvePendingRequest(decoded.requestId, decoded.response);
        return;
      }
      for (const event of decoded.events) {
        const result = await this.server.gateway.dispatchChannel(
          this.actorId,
          event,
        );
        if (!result.ok) {
          this.logger.warn(
            `Gateway rejected ${this.name} message: ${result.msg}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to handle ${this.name} message:`, error);
    }
  }

  private resolvePendingRequest(
    requestId: string,
    response: ChannelResponse,
  ): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(requestId);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    pending.resolve(response);
  }

  private clearPendingRequests(): void {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      this.pendingRequests.delete(requestId);
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.resolve(null);
    }
  }

  private buildRequestId(): string {
    this.requestSeq += 1;
    return `${this.name}:${this.actorId}:${Date.now()}:${this.requestSeq}`;
  }

  private async normalizeResponseReply(
    response: ActorChatResponse,
  ): Promise<ActorChatResponse> {
    if (!response.ema_reply.reply_to) {
      return response;
    }
    const replyTo = parseReplyRef(response.ema_reply.reply_to);
    if (!replyTo) {
      return response;
    }
    if (replyTo.kind === "channel") {
      if (replyTo.channel !== this.name) {
        return response;
      }
      return {
        ...response,
        ema_reply: {
          ...response.ema_reply,
          reply_to: formatReplyRef(replyTo),
        },
      };
    }
    const channelMessageId =
      await this.server.gateway.resolveChannelMessageIdByMsgId(
        response.conversationId,
        replyTo.msgId,
      );
    if (!channelMessageId) {
      return response;
    }
    return {
      ...response,
      ema_reply: {
        ...response.ema_reply,
        reply_to: formatReplyRef({
          kind: "channel",
          channel: this.name,
          channelMessageId,
        }),
      },
    };
  }

  private normalizeIncomingRaw(raw: unknown): unknown {
    if (typeof raw === "string") {
      return raw;
    }
    if (raw instanceof ArrayBuffer) {
      return Buffer.from(raw).toString("utf8");
    }
    if (ArrayBuffer.isView(raw)) {
      return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString(
        "utf8",
      );
    }
    return raw;
  }

  private async persistDeliveredChannelMessageId(
    conversationId: number,
    msgId: number,
    channelMessageId: string,
  ): Promise<void> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const updated =
        await this.server.dbService.conversationMessageDB.updateConversationMessageChannelMessageId(
          conversationId,
          msgId,
          channelMessageId,
        );
      if (updated) {
        return;
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    this.logger.warn(
      `Failed to persist channelMessageId for conversation ${conversationId}, msgId ${msgId}.`,
    );
  }

  private async sleep(ms: number, loopVersion: number): Promise<void> {
    if (ms <= 0 || !this.enabled || this.loopVersion !== loopVersion) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.retrySleepResolver = () => {
        this.retrySleepResolver = null;
        resolve();
      };
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.retrySleepResolver?.();
      }, ms);
    });
  }

  private closeSocket(socket: WebSocket | null = this.socket): void {
    if (!socket) {
      return;
    }
    if (this.socket === socket) {
      this.socket = null;
    }
    try {
      socket.close();
    } catch {
      // Ignore close errors from stale sockets.
    }
  }

  private buildWebSocketInit(): { headers?: Record<string, string> } | null {
    if (!this.accessToken) {
      return null;
    }
    return {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    };
  }
}
