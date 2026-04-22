import type { ActorChatResponse } from "../actor";
import {
  ChannelRegistry,
  type ChannelEvent,
  type GatewayResult,
  type MessageReplyRef,
  resolveSession,
} from "../channel";
import { Logger } from "../logger";
import type { Server } from "../server";
import type { DispatchActorResponseResult } from "./base";

/**
 * Routes inbound channel events and outbound actor responses.
 */
export class Gateway {
  readonly channelRegistry: ChannelRegistry;

  private readonly channelMessageToMsg = new Map<string, number>();
  private readonly msgToChannelMessage = new Map<string, string>();
  private readonly logger: Logger = Logger.create({
    name: "gateway",
    level: "debug",
    transport: "console",
  });

  constructor(private readonly server: Server) {
    this.channelRegistry = new ChannelRegistry(server);
  }

  /**
   * Reserves one actor-scoped message id.
   * @param actorId - Actor identifier.
   * @returns Reserved message id.
   */
  async reserveMessageId(actorId: number): Promise<number> {
    return this.server.dbService.conversationMessageDB.reserveMessageId(
      actorId,
    );
  }

  /**
   * Dispatches one inbound channel event into the actor runtime.
   * @param actorId - Actor identifier.
   * @param event - Normalized channel event.
   * @returns Dispatch result.
   */
  async dispatchChannel(
    actorId: number,
    event: ChannelEvent,
  ): Promise<GatewayResult> {
    if (!event.channel) {
      return {
        ok: false,
        msg: "Missing channel.",
      };
    }

    const channel = this.channelRegistry.getChannel(actorId, event.channel);
    if (!channel) {
      return {
        ok: false,
        msg: `Channel '${event.channel}' is not registered.`,
      };
    }

    if (!event.session) {
      return {
        ok: false,
        msg: "Missing session.",
      };
    }

    const conversation = await this.server.dbService.getConversationBySession(
      actorId,
      event.session,
    );
    if (!conversation || typeof conversation.id !== "number") {
      return {
        ok: false,
        msg: "Conversation not found.",
      };
    }

    const actor = await this.server.actorRegistry.ensure(actorId);
    if (event.kind === "system") {
      await actor.enqueueChannelEvent(event, conversation.id);
      return {
        ok: true,
        msg: "accepted",
        conversationId: conversation.id,
      };
    }

    const msgId = await this.reserveMessageId(actorId);
    const channelMessageId =
      event.channel === "web" ? String(msgId) : event.channelMessageId;
    const normalizedReplyTo = await this.normalizeReplyTo(
      conversation.id,
      event.replyTo,
    );
    this.rememberMessageMapping(conversation.id, msgId, channelMessageId);
    await actor.enqueueChannelEvent(
      {
        ...event,
        channelMessageId,
        ...(normalizedReplyTo ? { replyTo: normalizedReplyTo } : {}),
      },
      conversation.id,
      msgId,
    );

    return {
      ok: true,
      msg: "accepted",
      conversationId: conversation.id,
      msgId,
    };
  }

  /**
   * Dispatches one outbound actor response to its target channel.
   * @param response - Actor response payload.
   * @returns Dispatch result.
   */
  async dispatchActorResponse(
    response: ActorChatResponse,
  ): Promise<DispatchActorResponseResult> {
    const sessionInfo = resolveSession(response.session);
    if (!sessionInfo) {
      this.logger.warn(
        `Invalid session for conversation ${response.conversationId}, reply dropped.`,
      );
      return {
        ok: false,
        msg: "Invalid session.",
      };
    }

    const channel = this.channelRegistry.getChannel(
      response.actorId,
      sessionInfo.channel,
    );
    if (!channel) {
      this.logger.warn(
        `Missing channel for conversation ${response.conversationId}, reply dropped.`,
      );
      return {
        ok: false,
        msg: `Channel '${sessionInfo.channel}' is not registered.`,
      };
    }

    await channel.send(response);
    return {
      ok: true,
      msg: "accepted",
    };
  }

  /**
   * Stores one conversation message to channel message mapping.
   * @param conversationId - Conversation identifier.
   * @param msgId - Internal actor-scoped message id.
   * @param channelMessageId - External channel message id.
   */
  rememberMessageMapping(
    conversationId: number,
    msgId: number,
    channelMessageId: string,
  ): void {
    this.channelMessageToMsg.set(
      this.buildChannelKey(conversationId, channelMessageId),
      msgId,
    );
    this.msgToChannelMessage.set(
      this.buildMsgKey(conversationId, msgId),
      channelMessageId,
    );
  }

  /**
   * Resolves one internal message id by channel message id.
   * @param conversationId - Conversation identifier.
   * @param channelMessageId - External channel message id.
   * @returns Internal message id, or null when missing.
   */
  async resolveMsgIdByChannelMessageId(
    conversationId: number,
    channelMessageId: string,
  ): Promise<number | null> {
    const channelKey = this.buildChannelKey(conversationId, channelMessageId);
    const cached = this.channelMessageToMsg.get(channelKey);
    if (typeof cached === "number") {
      return cached;
    }
    const rows =
      await this.server.dbService.conversationMessageDB.listConversationMessages(
        {
          conversationId,
          channelMessageId,
          limit: 1,
        },
      );
    const row = rows[0];
    if (!row) {
      return null;
    }
    this.rememberMessageMapping(conversationId, row.msgId, channelMessageId);
    return row.msgId;
  }

  /**
   * Resolves one channel message id by internal message id.
   * @param conversationId - Conversation identifier.
   * @param msgId - Internal actor-scoped message id.
   * @returns Channel message id, or null when missing.
   */
  async resolveChannelMessageIdByMsgId(
    conversationId: number,
    msgId: number,
  ): Promise<string | null> {
    const msgKey = this.buildMsgKey(conversationId, msgId);
    const cached = this.msgToChannelMessage.get(msgKey);
    if (typeof cached === "string") {
      return cached;
    }
    const rows =
      await this.server.dbService.conversationMessageDB.listConversationMessages(
        {
          conversationId,
          msgIds: [msgId],
          limit: 1,
        },
      );
    const row = rows[0];
    if (!row || !row.channelMessageId) {
      return null;
    }
    this.rememberMessageMapping(conversationId, msgId, row.channelMessageId);
    return row.channelMessageId;
  }

  private async normalizeReplyTo(
    conversationId: number,
    replyTo: MessageReplyRef | undefined,
  ): Promise<MessageReplyRef | undefined> {
    if (!replyTo) {
      return undefined;
    }
    if (replyTo.kind === "msg") {
      return replyTo;
    }
    const resolved = await this.resolveMsgIdByChannelMessageId(
      conversationId,
      replyTo.channelMessageId,
    );
    if (typeof resolved === "number") {
      return {
        kind: "msg",
        msgId: resolved,
      };
    }
    return replyTo;
  }

  private buildChannelKey(
    conversationId: number,
    channelMessageId: string,
  ): string {
    return `${conversationId}:${channelMessageId}`;
  }

  private buildMsgKey(conversationId: number, msgId: number): string {
    return `${conversationId}:${msgId}`;
  }
}
