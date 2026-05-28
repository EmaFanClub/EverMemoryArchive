import "server-only";

import type {
  ActorDetails,
  ActorRuntimeSnapshot,
  EmaEvent as CoreEmaEvent,
} from "ema";
import {
  TOKEN_USAGE_SOURCES,
  type TokenUsageSource,
} from "@/types/dashboard/v1beta1";
import type {
  ActorLatestPreviewEventData,
  ActorRuntimeChangedEventData,
  ActorTokenUsageChangedEventData,
  ChannelQqConnectionChangedEventData,
  EmaKnownEvent,
} from "@/types/events/v1beta1";
import { toActorSummary } from "./dashboard";
import { toWebActorId } from "./ids";
import { toWebQqBlockedBy, toWebQqTransportStatus } from "./settings";

export function toWebBusEvent(event: CoreEmaEvent): EmaKnownEvent | null {
  switch (event.type) {
    case "actor.created":
      return toActorSummaryEvent("actor.created", event);
    case "actor.updated":
      return toActorSummaryEvent("actor.updated", event);
    case "actor.deleted":
      return toActorDeletedEvent(event);
    case "actor.runtime.changed":
      return toActorRuntimeChangedEvent(event);
    case "actor.latest_preview":
      return toActorLatestPreviewEvent(event);
    case "actor.token_usage.changed":
      return toActorTokenUsageChangedEvent(event);
    case "channel.qq.connection.changed":
      return toChannelQqConnectionChangedEvent(event);
  }
}

function toActorSummaryEvent(
  type: "actor.created" | "actor.updated",
  event: CoreEmaEvent,
): EmaKnownEvent | null {
  if (!isActorDetails(event.data)) {
    return null;
  }
  const actor = toActorSummary(event.data);
  return {
    type,
    ts: event.ts,
    actorId: actor.id,
    data: { actor },
  };
}

function toActorDeletedEvent(event: CoreEmaEvent): EmaKnownEvent | null {
  const actorId =
    typeof event.actorId === "number"
      ? toWebActorId(event.actorId)
      : readString(event.data, "actorId");
  if (!actorId) {
    return null;
  }
  return {
    type: "actor.deleted",
    ts: event.ts,
    actorId,
    data: { actorId },
  };
}

function toActorRuntimeChangedEvent(event: CoreEmaEvent): EmaKnownEvent | null {
  const status = readString(event.data, "status");
  if (!isRuntimeStatus(status)) {
    return null;
  }
  const transition = readString(event.data, "transition");
  if (!isRuntimeTransition(transition)) {
    return null;
  }
  return {
    type: "actor.runtime.changed",
    ts: event.ts,
    ...(typeof event.actorId === "number"
      ? { actorId: toWebActorId(event.actorId) }
      : {}),
    data: {
      status,
      transition,
    } satisfies ActorRuntimeChangedEventData,
  };
}

function toActorLatestPreviewEvent(event: CoreEmaEvent): EmaKnownEvent | null {
  const text = readString(event.data, "text");
  const time = readNumber(event.data, "time");
  if (!text || typeof time !== "number") {
    return null;
  }
  return {
    type: "actor.latest_preview",
    ts: event.ts,
    ...(typeof event.actorId === "number"
      ? { actorId: toWebActorId(event.actorId) }
      : {}),
    data: {
      text,
      time,
    } satisfies ActorLatestPreviewEventData,
  };
}

function toActorTokenUsageChangedEvent(
  event: CoreEmaEvent,
): EmaKnownEvent | null {
  if (typeof event.actorId !== "number") {
    return null;
  }
  const source = readString(event.data, "source");
  if (!isTokenUsageSource(source)) {
    return null;
  }
  const conversationId = readNumber(event.data, "conversationId");
  return {
    type: "actor.token_usage.changed",
    ts: event.ts,
    actorId: toWebActorId(event.actorId),
    data: {
      source,
      ...(typeof conversationId === "number"
        ? { conversationId: String(conversationId) }
        : {}),
    } satisfies ActorTokenUsageChangedEventData,
  };
}

function toChannelQqConnectionChangedEvent(
  event: CoreEmaEvent,
): EmaKnownEvent | null {
  const checkedAt = readNumber(event.data, "checkedAt");
  return {
    type: "channel.qq.connection.changed",
    ts: event.ts,
    ...(typeof event.actorId === "number"
      ? { actorId: toWebActorId(event.actorId) }
      : {}),
    data: {
      transportStatus: toWebQqTransportStatus(
        readString(event.data, "transportStatus") ?? "",
      ),
      blockedBy: toWebQqBlockedBy(readString(event.data, "blockedBy")),
      endpoint: readString(event.data, "endpoint") ?? "",
      enabled: readBoolean(event.data, "enabled") ?? false,
      checkedAt: new Date(checkedAt ?? event.ts).toISOString(),
      retryable: readBoolean(event.data, "retryable") ?? false,
    } satisfies ChannelQqConnectionChangedEventData,
  };
}

function isActorDetails(value: unknown): value is ActorDetails {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isRecord(value.actor) &&
    typeof value.actor.id === "number" &&
    typeof value.roleName === "string" &&
    isRecord(value.runtime) &&
    isRuntimeStatus(value.runtime.status) &&
    isRuntimeTransition(value.runtime.transition)
  );
}

function isRuntimeStatus(
  value: unknown,
): value is ActorRuntimeSnapshot["status"] {
  return (
    value === "offline" ||
    value === "sleep" ||
    value === "online" ||
    value === "busy"
  );
}

function isRuntimeTransition(
  value: unknown,
): value is ActorRuntimeSnapshot["transition"] {
  return (
    value === null ||
    value === "booting" ||
    value === "shutting_down" ||
    value === "waking" ||
    value === "sleeping"
  );
}

function isTokenUsageSource(value: unknown): value is TokenUsageSource {
  return (
    typeof value === "string" &&
    TOKEN_USAGE_SOURCES.includes(value as TokenUsageSource)
  );
}

function readString(value: unknown, key: string): string | null {
  if (!isRecord(value) || typeof value[key] !== "string") {
    return null;
  }
  return value[key];
}

function readNumber(value: unknown, key: string): number | null {
  if (!isRecord(value) || typeof value[key] !== "number") {
    return null;
  }
  return value[key];
}

function readBoolean(value: unknown, key: string): boolean | null {
  if (!isRecord(value) || typeof value[key] !== "boolean") {
    return null;
  }
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
