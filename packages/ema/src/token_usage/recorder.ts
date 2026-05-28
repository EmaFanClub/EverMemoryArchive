import type { LlmUsageReceivedEvent } from "../agent";
import type { DBService } from "../db/service";
import { normalizeUsageMetadata } from "./base";

export async function recordAgentTokenUsage(
  dbService: Pick<DBService, "tokenUsageDB">,
  event: LlmUsageReceivedEvent,
): Promise<number> {
  const totals = normalizeUsageMetadata(event.usageMetadata);
  const { actorId, conversationId, source } = event.usageContext;
  return dbService.tokenUsageDB.createTokenUsageRecord({
    actorId,
    createdAt: event.createdAt,
    source,
    ...(typeof conversationId === "number" ? { conversationId } : {}),
    model: event.model,
    ...totals,
  });
}
