import "server-only";

import type {
  ActorDetails,
  ActorRuntimeSnapshot,
  EffectiveActorSettings,
} from "ema";
import type {
  ActorRuntimeStatus,
  ActorRuntimeTransition,
  ActorSummary,
  DashboardOverviewResponse,
  DashboardUserProfile,
} from "@/types/dashboard/v1beta1";
import { toWebActorId } from "./ids";
import { toWebSettings, type CoreConversationForQq } from "./settings";

const API_VERSION = "v1beta1" as const;

export interface CoreUserProfile {
  id?: number;
  name: string;
}

export function toWebRuntimeStatus(
  status: ActorRuntimeSnapshot["status"],
): ActorRuntimeStatus {
  return status;
}

export function toWebRuntimeTransition(
  transition: ActorRuntimeSnapshot["transition"],
): ActorRuntimeTransition {
  return transition;
}

export function toActorSummary(
  details: ActorDetails,
  options: {
    settings?: EffectiveActorSettings;
    qqConversations?: CoreConversationForQq[];
  } = {},
): ActorSummary {
  return {
    id: toWebActorId(details.actor.id),
    name: details.roleName,
    status: toWebRuntimeStatus(details.runtime.status),
    transition: toWebRuntimeTransition(details.runtime.transition),
    ...(details.sleepSchedule
      ? {
          sleepSchedule: {
            startMinutes: details.sleepSchedule.startMinutes,
            endMinutes: details.sleepSchedule.endMinutes,
          },
        }
      : {}),
    ...(details.latestPreview
      ? {
          latestPreview: {
            text: details.latestPreview.text,
            time: details.latestPreview.time,
          },
        }
      : {}),
    ...(options.settings
      ? {
          settings: toWebSettings(
            options.settings,
            options.qqConversations ?? [],
          ),
        }
      : {}),
  };
}

export function toDashboardUserProfile(
  user: CoreUserProfile | null,
): DashboardUserProfile {
  return {
    id: user?.id ? String(user.id) : "1",
    name: user?.name ?? "你",
  };
}

export function toDashboardOverviewResponse({
  user,
  actors,
  generatedAt = new Date().toISOString(),
}: {
  user: CoreUserProfile | null;
  actors: ActorSummary[];
  generatedAt?: string;
}): DashboardOverviewResponse {
  return {
    apiVersion: API_VERSION,
    generatedAt,
    user: toDashboardUserProfile(user),
    actors,
  };
}
