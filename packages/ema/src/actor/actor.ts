import type { Config } from "../config";
import { Logger } from "../logger";
import { EMA_FOREGROUND_HEARTBEAT_PROMPT } from "../memory/prompts";
import type { Server } from "../server";
import {
  WebsocketChannelClient,
  resolveSession,
  type Channel,
  type ChannelEvent,
} from "../channel";
import type { ActorChatInput, ActorInput, ActorSystemInput } from "./base";
import { ActorWorker } from "./actor_worker";
import { SessionManager } from "./session_manager";

const DEFAULT_HEARTBEAT_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_HEARTBEAT_THRESHOLD_MS = 10 * 60_000;

export class Actor {
  readonly sessionManager: SessionManager;
  private readonly channels = new Map<string, Channel>();

  private currentConversationId: number | null = null;
  private currentWorker: ActorWorker | null = null;
  private acquiring = false;
  private heartbeatEnabled = true;
  private idleSince: number | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly logger: Logger = Logger.create({
    name: "actor",
    level: "debug",
    transport: "console",
  });

  private constructor(
    private readonly config: Config,
    readonly actorId: number,
    private readonly server: Server,
  ) {
    this.sessionManager = new SessionManager(
      this.handleQueueUnlocked.bind(this),
    );
  }

  static async create(
    config: Config,
    actorId: number,
    server: Server,
  ): Promise<Actor> {
    const actor = new Actor(config, actorId, server);
    const napcatAccessToken = process.env.EMA_QQ_TOKEN?.trim() || null;
    const qqWsUrl = process.env.EMA_QQ_WS_URL?.trim() || "ws://127.0.0.1:3001";

    actor.registerChannel(server.webChannel);
    actor.registerChannel(
      await WebsocketChannelClient.create(
        "qq",
        actorId,
        qqWsUrl,
        server,
        napcatAccessToken,
      ),
    );
    actor.startChannels();
    actor.startHeartbeat();
    return actor;
  }

  registerChannel(channel: Channel): void {
    this.channels.set(channel.name, channel);
  }

  getChannel(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  private startChannels(): void {
    for (const channel of this.channels.values()) {
      if (
        channel instanceof WebsocketChannelClient &&
        channel.isEnabled() &&
        channel.getStatus() === "exhausted"
      ) {
        channel.start();
      }
    }
  }

  enqueueChannelEvent(
    message: ChannelEvent,
    conversationId: number,
    msgId?: number,
  ): Promise<void> {
    let envelope: ActorInput;
    if (message.kind === "chat") {
      if (typeof msgId !== "number") {
        throw new Error("msgId is required for channel chat messages.");
      }
      envelope = {
        kind: "chat",
        conversationId,
        msgId,
        inputs: message.inputs,
        time: message.time,
        speaker: message.speaker,
        channelMessageId: message.channelMessageId,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      } satisfies ActorChatInput;
    } else {
      envelope = {
        kind: "system",
        conversationId,
        inputs: message.inputs,
        time: message.time,
      } satisfies ActorSystemInput;
    }
    return this.enqueueActorInput(conversationId, envelope);
  }

  async enqueueActorInput(
    conversationId: number,
    input: ActorInput,
  ): Promise<void> {
    this.idleSince = null;
    if (input.kind === "chat") {
      await this.server.memoryManager.persistChatMessage(input);
    }
    this.sessionManager.enqueue(conversationId, input);
    if (this.currentConversationId === null) {
      this.tryAcquireConversation();
      return;
    }
    if (this.currentConversationId === conversationId) {
      this.pumpHeldQueue();
    }
  }

  private tryAcquireConversation(): void {
    if (this.currentConversationId !== null || this.acquiring) {
      return;
    }
    const conversationId = this.sessionManager.pickNextConversationId();
    if (conversationId === null) {
      return;
    }
    this.acquiring = true;
    this.runDetached(
      this.holdConversation(conversationId).finally(() => {
        this.acquiring = false;
        if (this.currentConversationId === null) {
          setTimeout(() => {
            this.tryAcquireConversation();
          }, 0);
        }
      }),
      `hold conversation ${conversationId}`,
    );
  }

  private async holdConversation(conversationId: number): Promise<void> {
    const worker = await ActorWorker.create(
      this.config,
      this.actorId,
      conversationId,
      this.server,
    );
    this.currentConversationId = conversationId;
    this.currentWorker = worker;
    this.idleSince = null;
    worker.events.on("actorResponsed", (event) => {
      const sessionInfo = resolveSession(event.response.session);
      if (!sessionInfo) {
        this.logger.warn(
          `Invalid session for conversation ${conversationId}, reply dropped.`,
        );
        return;
      }
      const channel = this.getChannel(sessionInfo.channel);
      if (!channel) {
        this.logger.warn(
          `Missing channel for conversation ${conversationId}, reply dropped.`,
        );
        return;
      }
      this.runDetached(
        channel.send(event.response),
        `send reply for conversation ${conversationId}`,
      );
    });
    worker.events.on("workFinished", (event) => {
      if (!event.ok) {
        this.logger.error(
          `Worker finished with error for conversation ${conversationId}: ${event.msg}`,
          event.error,
        );
      }
      if (this.currentConversationId === conversationId) {
        this.releaseConversation();
        this.tryAcquireConversation();
      }
    });
    this.pumpHeldQueue();
  }

  private pumpHeldQueue(): void {
    if (this.currentConversationId === null || !this.currentWorker) {
      return;
    }
    const conversationId = this.currentConversationId;
    for (;;) {
      const input = this.sessionManager.tryPop(conversationId);
      if (!input) {
        return;
      }
      this.runDetached(
        this.currentWorker.work(input),
        `dispatch held conversation ${conversationId}`,
      );
    }
  }

  private handleQueueUnlocked(conversationId: number): void {
    if (this.currentConversationId === null) {
      this.tryAcquireConversation();
      return;
    }
    if (this.currentConversationId === conversationId) {
      this.pumpHeldQueue();
    }
  }

  private releaseConversation(): void {
    if (this.currentWorker) {
      this.currentWorker.events.removeAllListeners("actorResponsed");
      this.currentWorker.events.removeAllListeners("workFinished");
    }
    this.currentWorker = null;
    this.currentConversationId = null;
  }

  setHeartbeatEnabled(enabled: boolean): void {
    this.heartbeatEnabled = enabled;
    this.idleSince = null;
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      this.runDetached(this.tickHeartbeat(), "tick heartbeat");
    }, DEFAULT_HEARTBEAT_CHECK_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private async tickHeartbeat(): Promise<void> {
    if (!this.heartbeatEnabled) {
      return;
    }
    if (this.currentConversationId !== null) {
      this.idleSince = null;
      return;
    }
    const now = Date.now();
    if (this.idleSince === null) {
      this.idleSince = now;
      return;
    }
    if (now - this.idleSince < DEFAULT_HEARTBEAT_THRESHOLD_MS) {
      return;
    }
    this.idleSince = now;
    const conversationId = await this.pickProactiveConversationId();
    if (conversationId === null) {
      return;
    }
    await this.enqueueActorInput(conversationId, {
      kind: "system",
      conversationId,
      time: now,
      inputs: [{ type: "text", text: EMA_FOREGROUND_HEARTBEAT_PROMPT }],
    });
  }

  private async pickProactiveConversationId(): Promise<number | null> {
    const conversations = await this.server.conversationDB.listConversations({
      actorId: this.actorId,
    });
    const candidates = conversations.filter(
      (conversation) => conversation.allowProactive === true,
    );
    if (candidates.length === 0) {
      return null;
    }
    return candidates[Math.floor(Math.random() * candidates.length)].id ?? null;
  }

  private runDetached(task: Promise<void>, label: string): void {
    task.catch((error) => {
      this.logger.error(`Failed to ${label}:`, error);
    });
  }
}
