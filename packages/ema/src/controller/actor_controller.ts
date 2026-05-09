import path from "node:path";
import { rm } from "node:fs/promises";

import { buildSession } from "../channel";
import { GlobalConfig } from "../config";
import type { ActorEntity } from "../db";
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
      origin: input.origin ?? "blank",
      ...(input.trainingStatus
        ? {
            trainingStatus: input.trainingStatus,
            trainingUpdatedAt: Date.now(),
          }
        : {}),
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

  async delete(
    actorId: number,
  ): Promise<{ actorId: number; deletedAt: number }> {
    const actor = await this.server.dbService.actorDB.getActor(actorId);
    if (!actor || typeof actor.id !== "number") {
      throw new Error("Actor not found.");
    }
    if (actor.trainingStatus === "running") {
      throw new Error("Actor is training.");
    }

    const runtime = await this.server.controller.runtime.getSnapshot(actorId);
    if (runtime.transition !== null) {
      throw new Error("Actor is transitioning.");
    }

    const deletedAt = Date.now();
    const deleted = await this.server.dbService.actorDB.deleteActor(actorId);
    if (!deleted) {
      throw new Error("Actor not found.");
    }

    this.server.bus.publish(
      this.server.bus.createEvent({
        type: "actor.deleted",
        actorId,
        data: { actorId },
      }),
    );

    void this.cleanupDeletedActor(actor as ActorEntity & { id: number }).catch(
      () => undefined,
    );
    return { actorId, deletedAt };
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

  private async cleanupDeletedActor(
    actor: ActorEntity & { id: number },
  ): Promise<void> {
    const actorId = actor.id;
    await Promise.all([
      this.ignoreCleanupError(() => this.removeActorRuntime(actorId)),
      this.ignoreCleanupError(() => this.removeActorSchedulerJobs(actorId)),
      this.ignoreCleanupError(() => this.removeActorOwnerships(actorId)),
      this.ignoreCleanupError(() => this.removeActorMessages(actorId)),
      this.ignoreCleanupError(() => this.removeActorConversations(actorId)),
      this.ignoreCleanupError(() => this.removeActorShortTermMemories(actorId)),
      this.ignoreCleanupError(() => this.removeActorLongTermMemories(actorId)),
      this.ignoreCleanupError(() =>
        this.server.dbService.personalityDB.deletePersonality(actorId),
      ),
      this.ignoreCleanupError(() => this.removeActorRoleIfUnused(actor)),
      this.ignoreCleanupError(() =>
        rm(
          path.join(GlobalConfig.system.logsDir, "actors", `actor_${actorId}`),
          {
            recursive: true,
            force: true,
          },
        ),
      ),
    ]);
  }

  private async ignoreCleanupError(
    cleanup: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await cleanup();
    } catch {
      // Actor deletion cleanup is best-effort; residual checks can handle leftovers.
    }
  }

  private async removeActorRuntime(actorId: number): Promise<void> {
    await this.server.actorRegistry.unload(actorId);
    await this.server.gateway.channelRegistry.removeActorChannels(actorId);
  }

  private async removeActorSchedulerJobs(actorId: number): Promise<void> {
    const jobs = await this.server.scheduler.listJobs({
      "data.actorId": actorId,
    });
    await Promise.allSettled(
      jobs.map((job) => {
        const id = job.attrs._id?.toString();
        return id ? this.server.scheduler.cancel(id) : Promise.resolve(false);
      }),
    );
  }

  private async removeActorOwnerships(actorId: number): Promise<void> {
    const relations =
      await this.server.dbService.userOwnActorDB.listUserOwnActorRelations({
        actorId,
      });
    await Promise.allSettled(
      relations.map((relation) =>
        this.server.dbService.userOwnActorDB.removeActorFromUser(relation),
      ),
    );
  }

  private async removeActorMessages(actorId: number): Promise<void> {
    const messages =
      await this.server.dbService.conversationMessageDB.listConversationMessages(
        {
          actorId,
        },
      );
    await Promise.allSettled(
      messages
        .filter((message) => typeof message.id === "number")
        .map((message) =>
          this.server.dbService.conversationMessageDB.deleteConversationMessage(
            message.id as number,
          ),
        ),
    );
  }

  private async removeActorConversations(actorId: number): Promise<void> {
    const conversations =
      await this.server.dbService.conversationDB.listConversations({ actorId });
    await Promise.allSettled(
      conversations
        .filter((conversation) => typeof conversation.id === "number")
        .map((conversation) =>
          this.server.dbService.conversationDB.deleteConversation(
            conversation.id as number,
          ),
        ),
    );
  }

  private async removeActorShortTermMemories(actorId: number): Promise<void> {
    const shortTermMemories =
      await this.server.dbService.shortTermMemoryDB.listShortTermMemories({
        actorId,
      });
    await Promise.allSettled([
      ...shortTermMemories
        .filter((memory) => typeof memory.id === "number")
        .map((memory) =>
          this.server.dbService.shortTermMemoryDB.deleteShortTermMemory(
            memory.id as number,
          ),
        ),
    ]);
  }

  private async removeActorLongTermMemories(actorId: number): Promise<void> {
    const longTermMemories =
      await this.server.dbService.longTermMemoryDB.listLongTermMemories({
        actorId,
      });
    await Promise.allSettled([
      ...longTermMemories
        .filter((memory) => typeof memory.id === "number")
        .map((memory) =>
          this.server.dbService.longTermMemoryDB.deleteLongTermMemory(
            memory.id as number,
          ),
        ),
    ]);
  }

  private async removeActorRoleIfUnused(
    actor: ActorEntity & { id: number },
  ): Promise<void> {
    const activeActors = await this.server.dbService.actorDB.listActors();
    const isRoleUsed = activeActors.some(
      (activeActor) =>
        activeActor.id !== actor.id && activeActor.roleId === actor.roleId,
    );
    if (!isRoleUsed) {
      await this.server.dbService.roleDB.deleteRole(actor.roleId);
    }
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
