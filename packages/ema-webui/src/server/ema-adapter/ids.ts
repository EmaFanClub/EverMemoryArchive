import "server-only";

import { buildSession } from "ema";

export const DEFAULT_OWNER_USER_ID = 1;
export const DEFAULT_OWNER_USER_ID_TEXT = String(DEFAULT_OWNER_USER_ID);
export const DEFAULT_WEB_SESSION = buildSession(
  "web",
  "chat",
  DEFAULT_OWNER_USER_ID_TEXT,
);

export function toWebActorId(actorId: number): string {
  return String(actorId);
}

export function toCoreActorId(actorId: string): number {
  const parsed = Number.parseInt(actorId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== actorId) {
    throw new Error(`Invalid actor id: ${actorId}`);
  }
  return parsed;
}

export function toWebConversationId(session: string): string {
  return session;
}
