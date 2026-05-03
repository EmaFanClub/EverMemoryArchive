import { buildSession } from "../channel";
import type { Server } from "../server";
import type { ActorDetails, CreateActorInput } from "./types";
import {
  defaultWebConversationName,
  previewFromContents,
} from "./chat_controller";

export class ActorController {
  constructor(private readonly server: Server) {}

  async create(input: CreateActorInput): Promise<ActorDetails> {
    const name = input.name.trim() || "未命名";
    const roleId = await this.server.dbService.roleDB.upsertRole({
      name,
      prompt: input.roleBook,
      updatedAt: Date.now(),
    });
    const actorId = await this.server.dbService.actorDB.upsertActor({
      roleId,
      enabled: false,
      ...(input.avatarUrl?.trim() ? { avatarUrl: input.avatarUrl.trim() } : {}),
    });
    await this.server.dbService.userOwnActorDB.addActorToUser({
      userId: input.ownerUserId,
      actorId,
    });
    const ownerName = await this.server.dbService.getUserDisplayName(
      input.ownerUserId,
    );
    await this.server.dbService.createConversation(
      actorId,
      buildSession("web", "chat", String(input.ownerUserId)),
      defaultWebConversationName(ownerName),
      "",
      true,
    );
    await this.server.controller.schedule.updateSleepSchedule(
      actorId,
      input.sleepSchedule,
    );
    const details = await this.get(actorId, {
      latestPreviewSession: buildSession(
        "web",
        "chat",
        String(input.ownerUserId),
      ),
    });
    if (!details) {
      throw new Error(`Actor ${actorId} not found after creation.`);
    }
    this.server.bus.publish(
      this.server.bus.createEvent({
        type: "actor.created",
        actorId,
        data: details,
      }),
    );
    return details;
  }

  async get(
    actorId: number,
    options: { latestPreviewSession?: string } = {},
  ): Promise<ActorDetails | null> {
    const actor = await this.server.dbService.actorDB.getActor(actorId);
    if (!actor || typeof actor.id !== "number") {
      return null;
    }
    const role = await this.server.dbService.roleDB.getRole(actor.roleId);
    const latestPreview = await this.getLatestPreview(
      actor.id,
      options.latestPreviewSession,
    );
    const sleepSchedule =
      await this.server.controller.schedule.getSleepScheduleInput(actor.id);
    return {
      actor: actor as typeof actor & { id: number },
      roleName: role?.name ?? `Actor ${actor.id}`,
      rolePrompt: role?.prompt ?? "",
      runtime: await this.server.controller.runtime.getSnapshot(actor.id),
      ...(sleepSchedule ? { sleepSchedule } : {}),
      ...(latestPreview ? { latestPreview } : {}),
    };
  }

  async listForUser(userId: number): Promise<ActorDetails[]> {
    const relations =
      await this.server.dbService.userOwnActorDB.listUserOwnActorRelations({
        userId,
      });
    const latestPreviewSession = buildSession("web", "chat", String(userId));
    const actors = await Promise.all(
      relations.map((relation) =>
        this.get(relation.actorId, { latestPreviewSession }),
      ),
    );
    return actors.filter((actor): actor is ActorDetails => Boolean(actor));
  }

  async publishUpdated(actorId: number): Promise<void> {
    const details = await this.get(actorId);
    if (!details) {
      return;
    }
    this.server.bus.publish(
      this.server.bus.createEvent({
        type: "actor.updated",
        actorId,
        data: details,
      }),
    );
  }

  private async getLatestPreview(actorId: number, session?: string) {
    if (!session) {
      return null;
    }
    const conversation =
      await this.server.dbService.conversationDB.getConversationByActorAndSession(
        actorId,
        session,
      );
    if (!conversation || typeof conversation.id !== "number") {
      return null;
    }
    const latest =
      await this.server.dbService.conversationMessageDB.listConversationMessages(
        {
          conversationId: conversation.id,
          sort: "desc",
          limit: 1,
        },
      );
    const message = latest[0];
    if (!message) {
      return null;
    }
    return {
      text: previewFromContents(message.message.contents),
      time: message.createdAt ?? Date.now(),
    };
  }
}
