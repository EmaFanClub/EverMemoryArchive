import type { ActorTokenUsageSummary } from "../db";
import type { Server } from "../server";

export interface ActorTokenUsageSummaryRange {
  from?: number;
  to?: number;
}

export class TokenUsageController {
  constructor(private readonly server: Server) {}

  async getActorSummary(
    actorId: number,
    range: ActorTokenUsageSummaryRange = {},
  ): Promise<ActorTokenUsageSummary> {
    const actor = await this.server.dbService.actorDB.getActor(actorId);
    if (!actor || typeof actor.id !== "number") {
      throw new Error("Actor not found.");
    }
    return this.server.dbService.tokenUsageDB.summarizeActorTokenUsage({
      actorId,
      ...(typeof range.from === "number" ? { from: range.from } : {}),
      ...(typeof range.to === "number" ? { to: range.to } : {}),
    });
  }
}
