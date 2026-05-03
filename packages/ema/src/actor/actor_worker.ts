import { EventEmitter } from "node:events";
import { GlobalConfig } from "../config/index";
import { Agent, AgentEventNames, checkCompleteMessages } from "../agent";
import type { AgentEventName, AgentState } from "../agent";
import type { Server } from "../server";
import { formatLogTimestamp, Logger } from "../shared/logger";
import { LLMClient } from "../llm";
import { baseTools } from "../tools";
import { resolveSession } from "../channel";
import { formatStickerDisplayText } from "../skills/sticker-skill/pack";
import { stickerIdToBase64 } from "../skills/sticker-skill/utils";
import { formatTimestamp } from "../shared/utils";
import { buildUserMessageFromActorInput } from "./utils";
import type {
  ActorInput,
  ActorChatResponse,
  ActorWorkerStatus,
  ActorWorkerEvent,
  ActorWorkerEventMap,
  ActorWorkerEventName,
  ActorWorkerEventsEmitter,
} from "./base";

export class ActorWorker {
  readonly events: ActorWorkerEventsEmitter =
    new EventEmitter<ActorWorkerEventMap>() as ActorWorkerEventsEmitter;
  private readonly agent: Agent;
  private currentStatus: ActorWorkerStatus = "idle";
  private readonly logger: Logger;
  private agentState: AgentState | null = null;
  private queue: ActorInput[] = [];
  private currentRunPromise: Promise<void> | null = null;
  private processingQueue = false;

  private constructor(
    private readonly actorId: number,
    private readonly conversationId: number,
    readonly session: string,
    private readonly ownerUid: string | null,
    private readonly server: Server,
    llm: LLMClient,
    logger: Logger,
  ) {
    this.logger = logger;
    this.agent = new Agent(GlobalConfig.agent, llm, this.logger);
    this.bindAgentEvent();
    this.logger.info("Actor chat worker created");
  }

  static async create(
    actorId: number,
    conversationId: number,
    server: Server,
  ): Promise<ActorWorker> {
    const conversation =
      await server.dbService.conversationDB.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }
    if (conversation.actorId !== actorId) {
      throw new Error(`Invalid actor on conversation ${conversationId}.`);
    }
    const sessionInfo = resolveSession(conversation.session);
    if (!sessionInfo) {
      throw new Error(`Invalid session on conversation ${conversationId}.`);
    }
    const ownerUid = await server.memoryManager.getOwnerUid(
      actorId,
      sessionInfo.channel,
    );
    const llm = new LLMClient(
      await server.dbService.getActorLLMConfig(actorId),
    );
    const startedAt = formatLogTimestamp();
    const date = startedAt.slice(0, 10);
    const logger = Logger.create({
      name: "agent.chat",
      context: {
        actorId,
        conversationId,
        session: conversation.session,
      },
      outputs: [
        { type: "console", level: "warn" },
        {
          type: "file",
          level: "debug",
          filePath: `actors/actor_${actorId}/chat/${date}/${startedAt}.jsonl`,
        },
      ],
    });
    return new ActorWorker(
      actorId,
      conversationId,
      conversation.session,
      ownerUid,
      server,
      llm,
      logger,
    );
  }

  private bindAgentEvent(
    events: AgentEventName[] = Object.values(AgentEventNames),
  ) {
    for (const eventName of events) {
      if (eventName === "emaReplyReceived") {
        this.agent.events.on("emaReplyReceived", async (content) => {
          const reply = content.reply;
          if (reply.kind === "text" && reply.content.trim().length === 0) {
            return;
          }
          const msgId =
            await this.server.dbService.conversationMessageDB.reserveMessageId(
              this.actorId,
            );
          const response: ActorChatResponse = {
            kind: "chat",
            actorId: this.actorId,
            conversationId: this.conversationId,
            msgId,
            session: this.session,
            ema_reply: reply,
            time: Date.now(),
          };
          await this.server.memoryManager.persistChatMessage(response);
          await this.server.controller.chat.publishConversationMessage(
            this.conversationId,
            msgId,
          );
          await this.server.memoryManager.addToBuffer(
            this.conversationId,
            msgId,
            true,
            response.time,
          );
          const outboundResponse = await this.buildOutboundResponse(response);
          this.emitEvent("actorResponsed", {
            response: outboundResponse,
          });
        });
      }
    }
  }

  /**
   * Builds the channel-facing actor response. Sticker replies are converted from
   * stable sticker ids to base64 image payloads here so channel adapters can
   * stay transport-focused.
   * @param response - Persisted actor response.
   * @returns Response payload ready for outbound channel delivery.
   */
  private async buildOutboundResponse(
    response: ActorChatResponse,
  ): Promise<ActorChatResponse> {
    if (response.ema_reply.kind !== "sticker") {
      return response;
    }

    try {
      return {
        ...response,
        ema_reply: {
          ...response.ema_reply,
          content: await stickerIdToBase64(response.ema_reply.content),
        },
      };
    } catch (error) {
      this.logger.warn(
        `Failed to resolve sticker '${response.ema_reply.content}', falling back to text proxy.`,
        error,
      );
      return {
        ...response,
        ema_reply: {
          ...response.ema_reply,
          kind: "text",
          content: await formatStickerDisplayText(response.ema_reply.content),
        },
      };
    }
  }

  async work(envelope: ActorInput): Promise<void> {
    if (
      envelope.conversationId &&
      envelope.conversationId !== this.conversationId
    ) {
      throw new Error(
        `Conversation mismatch: expected ${this.conversationId}, got ${envelope.conversationId}.`,
      );
    }
    const inputs = envelope.inputs;
    if (inputs.length === 0) {
      return;
    }
    this.queue.push(envelope);

    if (this.isBusy()) {
      await this.abortCurrentRun();
      return;
    }

    await this.processQueue();
  }

  private emitEvent<K extends ActorWorkerEventName>(
    event: K,
    content: ActorWorkerEvent<K>,
  ) {
    this.events.emit(event, content);
  }

  private setStatus(status: ActorWorkerStatus): void {
    this.currentStatus = status;
  }

  public isBusy(): boolean {
    return this.currentStatus !== "idle";
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }
    this.processingQueue = true;
    try {
      while (this.queue.length > 0) {
        this.setStatus("preparing");
        const batches = this.queue.splice(0, this.queue.length);
        if (
          this.agentState &&
          !checkCompleteMessages(this.agentState.messages)
        ) {
          const messages = this.agentState.messages;
          if (messages.length === 0) {
            throw new Error("Cannot resume from an empty message history.");
          }
          const last = messages[messages.length - 1];
          if (last.role === "model") {
            throw new Error(
              "Cannot resume when the last message is a model message.",
            );
          }
          if (
            last.role === "user" &&
            last.contents.some(
              (content) => content.type === "function_response",
            )
          ) {
            const time = formatTimestamp("YYYY-MM-DD HH:mm:ss", Date.now());
            messages.push({
              role: "model",
              contents: [
                { type: "text", text: `<system time="${time}">` },
                {
                  type: "text",
                  text: "检测到用户插话。请综合考虑这条提示之前和之后的消息，理解上下文之间的关系后选择合适的回复方式，注意避免回复割裂和重复。",
                },
                { type: "text", text: `</system>` },
              ],
            });
          }
          messages.push(
            ...batches.map((item) =>
              buildUserMessageFromActorInput(item, this.ownerUid ?? undefined),
            ),
          );
          await this.markInputMessagesBuffered(batches);
        } else {
          this.agentState = {
            systemPrompt:
              await this.server.memoryManager.buildSystemPromptForChat(
                this.actorId,
                this.conversationId,
              ),
            messages: batches.map((item) =>
              buildUserMessageFromActorInput(item, this.ownerUid ?? undefined),
            ),
            tools: baseTools,
            toolContext: {
              actorId: this.actorId,
              conversationId: this.conversationId,
              server: this.server,
            },
          };
          await this.markInputMessagesBuffered(batches);
        }
        this.setStatus("running");
        this.currentRunPromise = this.agent.runWithState(this.agentState);
        try {
          await this.currentRunPromise;
        } finally {
          this.currentRunPromise = null;
          if (
            this.agentState &&
            checkCompleteMessages(this.agentState.messages)
          ) {
            this.agentState = null;
          }
          if (this.queue.length === 0) {
            this.setStatus("idle");
            this.events.emit("workFinished", {
              ok: true,
              msg: "work finished",
            });
          }
        }
      }
    } catch (error) {
      const resolvedError =
        error instanceof Error ? error : new Error(String(error));
      this.setStatus("idle");
      this.events.emit("workFinished", {
        ok: false,
        msg: resolvedError.message,
        error: resolvedError,
      });
      throw resolvedError;
    } finally {
      this.processingQueue = false;
    }
  }

  private async abortCurrentRun(): Promise<void> {
    if (!this.currentRunPromise) {
      return;
    }
    await this.agent.abort();
    await this.currentRunPromise;
  }

  private async markInputMessagesBuffered(
    batches: ActorInput[],
  ): Promise<void> {
    for (const item of batches) {
      if (item.kind !== "chat") {
        continue;
      }
      await this.server.memoryManager.addToBuffer(
        this.conversationId,
        item.msgId,
        true,
        item.time,
      );
    }
  }
}
