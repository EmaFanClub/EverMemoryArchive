import type { ActorSideTabId } from "./ActorSidePanel";

export type ActorSideTabByActorId = Record<string, ActorSideTabId>;

const ACTOR_SIDE_TAB_IDS = [
  "schedule",
  "memory",
  "logs",
  "stats",
  "settings",
] as const satisfies readonly ActorSideTabId[];

export function resolveActorSideTab(
  tabs: ActorSideTabByActorId,
  actorId: string,
): ActorSideTabId {
  return tabs[actorId] ?? "schedule";
}

export function updateActorSideTab(
  tabs: ActorSideTabByActorId,
  actorId: string,
  tab: ActorSideTabId,
): ActorSideTabByActorId {
  return {
    ...tabs,
    [actorId]: tab,
  };
}

export function deleteActorSideTab(
  tabs: ActorSideTabByActorId,
  actorId: string,
): ActorSideTabByActorId {
  const next = { ...tabs };
  delete next[actorId];
  return next;
}

export function readActorSideTabs(
  storage: Pick<Storage, "getItem">,
  key: string,
): ActorSideTabByActorId {
  try {
    const stored = storage.getItem(key);
    if (!stored) {
      return {};
    }
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, ActorSideTabId] =>
          isActorSideTabId(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function writeActorSideTabs(
  storage: Pick<Storage, "setItem">,
  key: string,
  tabs: ActorSideTabByActorId,
): void {
  storage.setItem(key, JSON.stringify(tabs));
}

function isActorSideTabId(value: unknown): value is ActorSideTabId {
  return (
    typeof value === "string" &&
    ACTOR_SIDE_TAB_IDS.includes(value as ActorSideTabId)
  );
}
