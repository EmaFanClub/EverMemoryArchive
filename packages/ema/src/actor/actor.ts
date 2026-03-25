import type { Config } from "../config";
import { Logger } from "../logger";
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

export class Actor {
  readonly sessionManager: SessionManager;
  private readonly channels = new Map<string, Channel>();

  private currentConversationId: number | null = null;
  private currentWorker: ActorWorker | null = null;
  private acquiring = false;
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

  private runDetached(task: Promise<void>, label: string): void {
    task.catch((error) => {
      this.logger.error(`Failed to ${label}:`, error);
    });
  }
}
