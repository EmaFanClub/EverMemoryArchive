import type {
  ActorMemoryKind,
  ActorMemoryListItem,
  ActorMemoryListResponse,
  ActorScheduleGroupId,
  ActorScheduleListItem,
  ActorScheduleListResponse,
  ActorScheduleTask,
} from "@/types/dashboard/v1beta1";

const SCHEDULE_RUN_AT_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export const SCHEDULE_GROUPS: Array<{
  id: ActorScheduleGroupId;
  label: string;
  empty: string;
}> = [
  { id: "upcoming", label: "单次日程", empty: "没有单次日程" },
  { id: "recurring", label: "周期日程", empty: "没有周期日程" },
  { id: "focused", label: "关注会话", empty: "没有关注会话" },
  { id: "overdue", label: "过时日程", empty: "没有过时日程" },
];

export const MEMORY_GROUPS: Array<{
  kind: ActorMemoryKind;
  label: string;
  empty: string;
}> = [
  { kind: "year", label: "年记", empty: "暂无年记" },
  { kind: "month", label: "月记", empty: "暂无月记" },
  { kind: "day", label: "日记", empty: "暂无日记" },
  { kind: "activity", label: "活动", empty: "暂无活动记忆" },
];

export const SCHEDULE_TASK_LABELS: Record<ActorScheduleTask, string> = {
  chat: "聊天",
  activity: "活动",
  wake: "唤醒",
  sleep: "睡眠",
  focus: "关注",
};

export const MEMORY_KIND_LABELS: Record<ActorMemoryKind, string> = {
  year: "年记",
  month: "月记",
  day: "日记",
  activity: "活动",
};

export function isEditableScheduleTask(task: ActorScheduleTask): boolean {
  return task === "chat" || task === "activity";
}

export function isVisibleScheduleInGroup(
  groupId: ActorScheduleGroupId,
  item: ActorScheduleListItem,
): boolean {
  return (
    groupId !== "recurring" || (item.task !== "sleep" && item.task !== "wake")
  );
}

export function formatScheduleTimeLabel(item: ActorScheduleListItem): string {
  if (item.type === "once") {
    return item.runAt ?? "未设置时间";
  }
  const parts = [
    item.nextRunAt ? `下次 ${item.nextRunAt}` : "下次未定",
    item.interval !== undefined
      ? `周期 ${formatScheduleIntervalLabel(item.interval)}`
      : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" / ");
}

export function formatMemorySourceLabel(
  item: ActorMemoryListItem,
): string | null {
  return MEMORY_KIND_LABELS[item.kind];
}

export function formatMemoryUpdatedAtLabel(item: ActorMemoryListItem): string {
  const timestamp = item.updatedAt ?? item.createdAt;
  return `更新于 ${
    typeof timestamp === "number" ? formatDateTime(timestamp) : "未记录"
  }`;
}

export function countApproxMemoryLength(value: string): number {
  const tokens = value.match(/\p{Script=Han}|[\p{L}]+|[\p{N}]+/gu);
  return tokens?.length ?? 0;
}

export function formatMemoryPreview(item: ActorMemoryListItem): string {
  return normalizeScheduleText(item.memory) || "暂无正文";
}

export function hasReadonlyScheduleDetails(
  item: ActorScheduleListItem,
): boolean {
  return !(item.editable && item.type === "once") || Boolean(item.lastRunAt);
}

export function formatScheduleIntervalLabel(
  interval: ActorScheduleListItem["interval"],
): string {
  if (interval === undefined) return "未设置";
  if (typeof interval !== "number") return interval;
  const minutes = Math.max(1, Math.round(interval / 60000));
  return `${minutes} 分钟`;
}

export function isValidScheduleRunAt(value: string): boolean {
  const match = SCHEDULE_RUN_AT_RE.exec(value);
  if (!match) {
    return false;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const date = new Date(year, month - 1, day, hour, minute, second);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute &&
    date.getSeconds() === second
  );
}

export function formatScheduleSessionLabel(
  item: ActorScheduleListItem,
): string | null {
  const session = normalizeScheduleText(item.session);
  if (session) return session;
  return item.conversationId ?? null;
}

export function formatFocusedScheduleSessionLabel(
  item: ActorScheduleListItem,
): string {
  return formatScheduleSessionLabel(item) ?? "未设置";
}

export function formatScheduleTitle(item: ActorScheduleListItem): string {
  return (
    normalizeScheduleText(item.summary) ||
    normalizeScheduleText(item.prompt) ||
    `${SCHEDULE_TASK_LABELS[item.task]}日程`
  );
}

export function formatSchedulePreview(item: ActorScheduleListItem): string {
  return normalizeScheduleText(item.prompt) || "暂无正文";
}

export function isMemoryGroupEmpty(
  groups: ActorMemoryListResponse["groups"],
): boolean {
  return MEMORY_GROUPS.every((group) => groups[group.kind].length === 0);
}

export function getScheduleGroupsForActor(
  response: ActorScheduleListResponse | null,
  actorId: string,
): ActorScheduleListResponse["groups"] | null {
  return response?.actorId === actorId ? response.groups : null;
}

export function getMemoryGroupsForActor(
  response: ActorMemoryListResponse | null,
  actorId: string,
): ActorMemoryListResponse["groups"] | null {
  return response?.actorId === actorId ? response.groups : null;
}

function normalizeScheduleText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ].map((part) => String(part).padStart(2, "0"));
  return `${parts[0]}-${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}:${parts[5]}`;
}
