import { EventEmitter } from "node:events";
import type { Config } from "../config";
import { Agent, AgentEventNames, checkCompleteMessages } from "../agent";
import type { AgentEventName, AgentState } from "../agent";
import type { Server } from "../server";
import { Logger } from "../logger";
import { LLMClient } from "../llm";
import { resolveSession } from "../channel";
import { formatTimestamp } from "../utils";
import { buildUserMessageFromActorInput } from "./utils";
import type {
  ActorInput,
  ActorChatResponse,
  ActorStatus,
  ActorWorkerEvent,
  ActorWorkerEventMap,
  ActorWorkerEventName,
  ActorWorkerEventsEmitter,
} from "./base";

export class ActorWorker {
  readonly events: ActorWorkerEventsEmitter =
    new EventEmitter<ActorWorkerEventMap>() as ActorWorkerEventsEmitter;
  private readonly agent: Agent;
  private currentStatus: ActorStatus = "idle";
  private readonly logger: Logger = Logger.create({
    name: "actor",
    level: "debug",
    transport: "console",
  });
  private agentState: AgentState | null = null;
  private queue: ActorInput[] = [];
  private currentRunPromise: Promise<void> | null = null;
  private processingQueue = false;

  private constructor(
    private readonly config: Config,
    private readonly actorId: number,
    private readonly conversationId: number,
    private readonly session: string,
    private readonly ownerUid: string | null,
    private readonly server: Server,
  ) {
    const llm = new LLMClient(this.config.llm);
    this.agent = new Agent(config.agent, llm, this.logger);
    this.bindAgentEvent();
  }

  static async create(
    config: Config,
    actorId: number,
    conversationId: number,
    server: Server,
  ): Promise<ActorWorker> {
    const conversation =
      await server.conversationDB.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }
    const sessionInfo = resolveSession(conversation.session);
    if (!sessionInfo) {
      throw new Error(`Invalid session on conversation ${conversationId}.`);
    }
    const ownerUid = await server.memoryManager.getOwnerUid(
      actorId,
      sessionInfo.channel,
    );
    return new ActorWorker(
      config,
      actorId,
      conversationId,
      conversation.session,
      ownerUid,
      server,
    );
  }

  private bindAgentEvent(
    events: AgentEventName[] = Object.values(AgentEventNames),
  ) {
    for (const eventName of events) {
      if (eventName === "emaReplyReceived") {
        this.agent.events.on("emaReplyReceived", async (content) => {
          const reply = content.reply;
          if (reply.contents.trim().length === 0) {
            return;
          }
          const msgId =
            await this.server.conversationMessageDB.reserveMessageId(
              this.conversationId,
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
          await this.server.memoryManager.addToBuffer(
            this.conversationId,
            msgId,
            true,
            response.time,
          );
          this.emitEvent("actorResponsed", {
            response,
          });
        });
      }
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

  private setStatus(status: ActorStatus): void {
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
          await this.markInputMessagesResumed(batches);
        } else {
          this.agentState = {
            systemPrompt: await this.server.memoryManager.buildSystemPrompt(
              this.config.systemPrompt,
              this.actorId,
              this.conversationId,
            ),
            messages: batches.map((item) =>
              buildUserMessageFromActorInput(item, this.ownerUid ?? undefined),
            ),
            tools: this.config.baseTools,
            toolContext: {
              actorId: this.actorId,
              conversationId: this.conversationId,
              server: this.server,
            },
          };
          await this.markInputMessagesResumed(batches);
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

  private async markInputMessagesResumed(batches: ActorInput[]): Promise<void> {
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
