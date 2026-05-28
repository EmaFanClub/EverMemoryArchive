import type { LlmUsageReceivedEvent } from "../agent";
import type { EmaBus } from "../bus";
import type { DBService } from "../db/service";
import { normalizeUsageMetadata } from "./base";

export async function recordAgentTokenUsage(
  dbService: Pick<DBService, "tokenUsageDB">,
  event: LlmUsageReceivedEvent,
  bus?: Pick<EmaBus, "createEvent" | "publish">,
): Promise<number> {
  const totals = normalizeUsageMetadata(event.usageMetadata);
  const { actorId, conversationId, source } = event.usageContext;
  const recordId = await dbService.tokenUsageDB.createTokenUsageRecord({
    actorId,
    createdAt: event.createdAt,
    source,
    ...(typeof conversationId === "number" ? { conversationId } : {}),
    model: event.model,
    ...totals,
  });
  bus?.publish(
    bus.createEvent({
      type: "actor.token_usage.changed",
      actorId,
      data: {
        recordId,
        source,
        ...(typeof conversationId === "number" ? { conversationId } : {}),
      },
    }),
  );
  return recordId;
}
