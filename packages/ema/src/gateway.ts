import type { Server } from "./server";
import type { ChannelEvent, GatewayResult, MessageReplyRef } from "./channel";

export class Gateway {
  private readonly channelMessageToMsg = new Map<string, number>();
  private readonly msgToChannelMessage = new Map<string, string>();

  constructor(private readonly server: Server) {}

  async reserveMessageId(conversationId: number): Promise<number> {
    return this.server.conversationMessageDB.reserveMessageId(conversationId);
  }

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

    const channel = await this.resolveChannel(actorId, event.channel);
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

    const conversation = await this.server.getConversationBySession(
      actorId,
      event.session,
    );
    if (!conversation || typeof conversation.id !== "number") {
      return {
        ok: false,
        msg: "Conversation not found.",
      };
    }

    const actor = await this.server.getActor(actorId);
    if (event.kind === "system") {
      await actor.enqueueChannelEvent(event, conversation.id);
      return {
        ok: true,
        msg: "accepted",
        conversationId: conversation.id,
      };
    }

    const msgId =
      event.channel === "web"
        ? Number(event.channelMessageId)
        : await this.reserveMessageId(conversation.id);
    const normalizedReplyTo = await this.normalizeReplyTo(
      conversation.id,
      event.replyTo,
    );
    this.rememberMessageMapping(conversation.id, msgId, event.channelMessageId);
    await actor.enqueueChannelEvent(
      {
        ...event,
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
      await this.server.conversationMessageDB.listConversationMessages({
        conversationId,
        channelMessageId,
        limit: 1,
      });
    const row = rows[0];
    if (!row) {
      return null;
    }
    this.rememberMessageMapping(conversationId, row.msgId, channelMessageId);
    return row.msgId;
  }

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
      await this.server.conversationMessageDB.listConversationMessages({
        conversationId,
        msgIds: [msgId],
        limit: 1,
      });
    const row = rows[0];
    if (!row || !row.channelMessageId) {
      return null;
    }
    this.rememberMessageMapping(conversationId, msgId, row.channelMessageId);
    return row.channelMessageId;
  }

  private async resolveChannel(actorId: number, channelName: string) {
    const actor = await this.server.getActor(actorId);
    return actor.getChannel(channelName);
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
