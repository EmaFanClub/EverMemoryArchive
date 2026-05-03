import type { ChannelConfig } from "../config";
import { buildSession, resolveSession } from "../channel";
import type { ConversationEntity } from "../db";
import type { Server } from "../server";
import type { QQConversationInput } from "./types";

export type QQTransportStatus = "connecting" | "connected" | "disconnected";

export type QQBlockedBy = "actor_offline" | "qq_disabled" | null;

export interface QQConnectionState {
  target: "qq";
  actorId: number;
  enabled: boolean;
  endpoint: string;
  transportStatus: QQTransportStatus;
  blockedBy: QQBlockedBy;
  checkedAt: number;
  retryable: boolean;
}

export class ChannelController {
  constructor(private readonly server: Server) {}

  async saveQqConnectionConfig(
    actorId: number,
    config: Pick<ChannelConfig["qq"], "wsUrl" | "accessToken">,
  ): Promise<ChannelConfig["qq"]> {
    if (!config.wsUrl.trim()) {
      throw new Error("QQ wsUrl is required.");
    }
    if (!config.accessToken.trim()) {
      throw new Error("QQ accessToken is required.");
    }
    const actor = await this.requireActor(actorId);
    const current = await this.server.dbService.getActorChannelConfig(actorId);
    const nextConfig = {
      ...current.qq,
      wsUrl: config.wsUrl.trim(),
      accessToken: config.accessToken.trim(),
    };
    await this.server.dbService.actorDB.upsertActor({
      ...actor,
      channelConfig: {
        ...current,
        qq: nextConfig,
      },
    });
    await this.server.gateway.channelRegistry.refreshActorChannels(actorId);
    await this.publishQqStatus(actorId);
    await this.server.controller.actor.publishUpdated(actorId);
    return nextConfig;
  }

  async setQqEnabled(
    actorId: number,
    enabled: boolean,
  ): Promise<ChannelConfig["qq"]> {
    const actor = await this.requireActor(actorId);
    const current = await this.server.dbService.getActorChannelConfig(actorId);
    if (enabled) {
      if (!current.qq.wsUrl.trim()) {
        throw new Error("QQ wsUrl is required before QQ can be enabled.");
      }
      if (!current.qq.accessToken.trim()) {
        throw new Error("QQ accessToken is required before QQ can be enabled.");
      }
    }
    const nextConfig = {
      ...current.qq,
      enabled,
    };
    await this.server.dbService.actorDB.upsertActor({
      ...actor,
      channelConfig: {
        ...current,
        qq: nextConfig,
      },
    });
    await this.server.gateway.channelRegistry.refreshActorChannels(actorId);
    await this.publishQqStatus(actorId);
    await this.server.controller.actor.publishUpdated(actorId);
    return nextConfig;
  }

  async listQqConversations(actorId: number): Promise<ConversationEntity[]> {
    const conversations =
      await this.server.dbService.conversationDB.listConversations({
        actorId,
      });
    return conversations.filter((conversation) => {
      const session = resolveSession(conversation.session);
      return session?.channel === "qq";
    });
  }

  async addQqConversation(
    actorId: number,
    input: QQConversationInput,
  ): Promise<ConversationEntity & { id: number }> {
    const session = buildSession("qq", input.type, input.uid.trim());
    const existing =
      await this.server.dbService.conversationDB.getConversationByActorAndSession(
        actorId,
        session,
      );
    if (existing) {
      throw new Error(`QQ conversation ${session} already exists.`);
    }
    return await this.upsertQqConversation(actorId, session, input);
  }

  async updateQqConversation(
    actorId: number,
    conversationId: number,
    input: Omit<QQConversationInput, "type" | "uid">,
  ): Promise<ConversationEntity & { id: number }> {
    const current =
      await this.server.dbService.conversationDB.getConversation(
        conversationId,
      );
    if (
      !current ||
      current.actorId !== actorId ||
      typeof current.id !== "number"
    ) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }
    const session = resolveSession(current.session);
    if (session?.channel !== "qq") {
      throw new Error(
        `Conversation ${conversationId} is not a QQ conversation.`,
      );
    }
    return await this.upsertQqConversation(
      actorId,
      current.session,
      {
        type: session.type,
        uid: session.uid,
        name: input.name,
        description: input.description,
        allowProactive: input.allowProactive,
      },
      current.id,
    );
  }

  async deleteQqConversation(
    actorId: number,
    conversationId: number,
  ): Promise<boolean> {
    const current =
      await this.server.dbService.conversationDB.getConversation(
        conversationId,
      );
    if (!current || current.actorId !== actorId) {
      return false;
    }
    const session = resolveSession(current.session);
    if (session?.channel !== "qq") {
      return false;
    }
    return await this.server.dbService.conversationDB.deleteConversation(
      conversationId,
    );
  }

  async getQqConnectionState(actorId: number): Promise<QQConnectionState> {
    const config = await this.server.dbService.getActorChannelConfig(actorId);
    let transportStatus: QQTransportStatus = "disconnected";
    let blockedBy: QQBlockedBy = null;
    if (!config.qq.enabled) {
      blockedBy = "qq_disabled";
    } else if (!this.server.actorRegistry?.get(actorId)) {
      blockedBy = "actor_offline";
    } else {
      transportStatus =
        this.server.gateway?.channelRegistry.getActorChannelStatus(
          actorId,
          "qq",
        ) ?? "disconnected";
    }

    return {
      target: "qq",
      actorId,
      enabled: config.qq.enabled,
      endpoint: config.qq.wsUrl,
      transportStatus,
      blockedBy,
      checkedAt: Date.now(),
      retryable: blockedBy === null && transportStatus === "disconnected",
    };
  }

  async restartQq(actorId: number): Promise<QQConnectionState> {
    const config = await this.server.dbService.getActorChannelConfig(actorId);
    if (
      config.qq.enabled &&
      config.qq.wsUrl.trim() &&
      config.qq.accessToken.trim() &&
      this.server.actorRegistry?.get(actorId)
    ) {
      await this.server.gateway.channelRegistry.restartActorChannel(
        actorId,
        "qq",
      );
    }
    return await this.publishQqStatus(actorId);
  }

  async publishQqStatus(actorId: number): Promise<QQConnectionState> {
    const state = await this.getQqConnectionState(actorId);
    this.server.bus.publish(
      this.server.bus.createEvent({
        type: "channel.qq.connection.changed",
        actorId,
        data: {
          target: state.target,
          enabled: state.enabled,
          endpoint: state.endpoint,
          transportStatus: state.transportStatus,
          blockedBy: state.blockedBy,
          checkedAt: state.checkedAt,
          retryable: state.retryable,
        },
      }),
    );
    return state;
  }

  private async upsertQqConversation(
    actorId: number,
    session: string,
    input: QQConversationInput,
    id?: number,
  ): Promise<ConversationEntity & { id: number }> {
    const conversationId =
      await this.server.dbService.conversationDB.upsertConversation({
        ...(id ? { id } : {}),
        actorId,
        session,
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        allowProactive: input.allowProactive === true,
      });
    const conversation =
      await this.server.dbService.conversationDB.getConversation(
        conversationId,
      );
    if (!conversation || typeof conversation.id !== "number") {
      throw new Error(`Conversation ${conversationId} not found after save.`);
    }
    return conversation as ConversationEntity & { id: number };
  }

  private async requireActor(actorId: number) {
    const actor = await this.server.dbService.actorDB.getActor(actorId);
    if (!actor || typeof actor.id !== "number") {
      throw new Error(`Actor ${actorId} not found.`);
    }
    return actor as typeof actor & { id: number };
  }
}
