import "server-only";

import type { ShortTermMemoryRecord } from "ema";
import { toCoreActorId } from "@/server/ema-adapter/ids";
import { ensureEmaServer } from "@/server/ema-server";
import type {
  ActorMemoryKind,
  ActorMemoryListItem,
  ActorMemoryListResponse,
  ActorMemoryMutationResponse,
  ActorMemoryPatchRequest,
  ActorScheduleGroupId,
  ActorScheduleListItem,
  ActorScheduleListResponse,
  ActorScheduleMutationResponse,
  ActorSchedulePatchRequest,
  ActorScheduleTask,
} from "@/types/dashboard/v1beta1";

const API_VERSION = "v1beta1" as const;
const MEMORY_KINDS: ActorMemoryKind[] = ["year", "month", "day", "activity"];
const MEMORY_LIST_LIMITS: Record<ActorMemoryKind, number> = {
  year: 50,
  month: 2,
  day: 2,
  activity: 10,
};
const MEMORY_MAX_LENGTHS: Record<ActorMemoryKind, number> = {
  activity: 100,
  day: 500,
  month: 300,
  year: 400,
};
const SCHEDULE_RUN_AT_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const EDITABLE_SCHEDULE_TASKS = new Set<ActorScheduleTask>([
  "chat",
  "activity",
]);

type CoreScheduleListResult = Record<ActorScheduleGroupId, CoreScheduleItem[]>;

type CoreScheduleItem = {
  id: string;
  type: "once" | "every";
  task: ActorScheduleTask;
  runAt?: string;
  nextRunAt?: string | null;
  interval?: string | number;
  lastRunAt?: string | null;
  conversationId: number | null;
  summary?: string;
  prompt: string;
};

type EmaServer = Awaited<ReturnType<typeof ensureEmaServer>>;

export async function buildActorScheduleListResponse(
  actorId: string,
): Promise<ActorScheduleListResponse> {
  const server = await ensureEmaServer();
  const coreActorId = toCoreActorId(actorId);
  await ensureActorExists(server, coreActorId);
  const scheduler = server.getActorScheduler(coreActorId);
  const listed = (await scheduler.list()) as CoreScheduleListResult;
  const sessions = await buildScheduleSessionMap(
    [
      ...listed.overdue,
      ...listed.upcoming,
      ...listed.recurring,
      ...listed.focused,
    ],
    server,
  );

  return {
    apiVersion: API_VERSION,
    actorId,
    groups: {
      overdue: listed.overdue.map((item) => toWebScheduleItem(item, sessions)),
      upcoming: listed.upcoming.map((item) =>
        toWebScheduleItem(item, sessions),
      ),
      recurring: listed.recurring.map((item) =>
        toWebScheduleItem(item, sessions),
      ),
      focused: listed.focused.map((item) => toWebScheduleItem(item, sessions)),
    },
  };
}

export async function patchActorScheduleService(
  actorId: string,
  scheduleId: string,
  request: ActorSchedulePatchRequest,
): Promise<ActorScheduleMutationResponse> {
  const unsupportedKeys = Object.keys(request).filter(
    (key) =>
      key !== "requestId" &&
      key !== "summary" &&
      key !== "prompt" &&
      key !== "runAt",
  );
  if (unsupportedKeys.length > 0) {
    return scheduleError(
      actorId,
      "UNSUPPORTED_FIELD",
      "只能编辑日程摘要、正文和单次时间。",
    );
  }

  const summary =
    typeof request.summary === "string" ? request.summary.trim() : undefined;
  const prompt =
    typeof request.prompt === "string" ? request.prompt : undefined;
  const parsedRunAt =
    request.runAt !== undefined
      ? typeof request.runAt === "string"
        ? parseScheduleRunAt(request.runAt)
        : null
      : undefined;
  if (parsedRunAt === null) {
    return scheduleError(
      actorId,
      "INVALID_SCHEDULE",
      "时间必须是有效的 YYYY-MM-DD HH:mm:ss。",
    );
  }
  if (
    summary === undefined &&
    prompt === undefined &&
    parsedRunAt === undefined
  ) {
    return scheduleError(actorId, "INVALID_SCHEDULE", "没有可保存的日程内容。");
  }

  let coreActorId: number;
  try {
    coreActorId = toCoreActorId(actorId);
  } catch (error) {
    return scheduleError(actorId, "INVALID_SCHEDULE", messageFromError(error));
  }

  try {
    const server = await ensureEmaServer();
    await ensureActorExists(server, coreActorId);
    const scheduler = server.getActorScheduler(coreActorId);
    const current = findScheduleById(
      (await scheduler.list()) as CoreScheduleListResult,
      scheduleId,
    );
    if (!current) {
      return scheduleError(actorId, "SCHEDULE_NOT_FOUND", "日程不存在。");
    }
    if (!EDITABLE_SCHEDULE_TASKS.has(current.task)) {
      return scheduleError(
        actorId,
        "UNSUPPORTED_FIELD",
        "该日程不能在此界面编辑。",
      );
    }
    if (parsedRunAt !== undefined && current.type !== "once") {
      return scheduleError(
        actorId,
        "UNSUPPORTED_FIELD",
        "只能编辑单次日程的时间。",
      );
    }
    const result = (await scheduler.update([
      {
        id: scheduleId,
        ...(summary !== undefined ? { summary } : {}),
        ...(prompt !== undefined ? { prompt } : {}),
        ...(parsedRunAt !== undefined ? { runAt: parsedRunAt } : {}),
      },
    ])) as { updated: CoreScheduleItem[] };
    const updated = result.updated[0];
    if (!updated) {
      return scheduleError(actorId, "SCHEDULE_NOT_FOUND", "日程不存在。");
    }
    const sessions = await buildScheduleSessionMap([updated], server);
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      schedule: toWebScheduleItem(updated, sessions),
    };
  } catch (error) {
    return scheduleError(
      actorId,
      messageFromError(error).includes("not found")
        ? "SCHEDULE_NOT_FOUND"
        : "SCHEDULE_UPDATE_FAILED",
      messageFromError(error),
      true,
    );
  }
}

export async function deleteActorScheduleService(
  actorId: string,
  scheduleId: string,
): Promise<ActorScheduleMutationResponse> {
  let coreActorId: number;
  try {
    coreActorId = toCoreActorId(actorId);
  } catch (error) {
    return scheduleError(actorId, "INVALID_SCHEDULE", messageFromError(error));
  }

  try {
    const server = await ensureEmaServer();
    await ensureActorExists(server, coreActorId);
    const scheduler = server.getActorScheduler(coreActorId);
    const current = findScheduleById(
      (await scheduler.list()) as CoreScheduleListResult,
      scheduleId,
    );
    if (!current) {
      return scheduleError(actorId, "SCHEDULE_NOT_FOUND", "日程不存在。");
    }
    if (!EDITABLE_SCHEDULE_TASKS.has(current.task)) {
      return scheduleError(
        actorId,
        "UNSUPPORTED_FIELD",
        "该日程不能在此界面删除。",
      );
    }
    const result = (await scheduler.delete([scheduleId])) as {
      deletedIds: string[];
    };
    if (!result.deletedIds.includes(scheduleId)) {
      return scheduleError(actorId, "SCHEDULE_NOT_FOUND", "日程不存在。");
    }
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
    };
  } catch (error) {
    return scheduleError(
      actorId,
      messageFromError(error).includes("not found")
        ? "SCHEDULE_NOT_FOUND"
        : "SCHEDULE_DELETE_FAILED",
      messageFromError(error),
      true,
    );
  }
}

export async function buildActorMemoryListResponse(
  actorId: string,
): Promise<ActorMemoryListResponse> {
  const server = await ensureEmaServer();
  const coreActorId = toCoreActorId(actorId);
  await ensureActorExists(server, coreActorId);
  const entries = await Promise.all(
    MEMORY_KINDS.map(async (kind) => [
      kind,
      (
        await server.memoryManager.listShortTermMemories(coreActorId, {
          kind,
          limit: MEMORY_LIST_LIMITS[kind],
          sort: "desc",
        })
      ).map(toWebMemoryItem),
    ]),
  );

  return {
    apiVersion: API_VERSION,
    actorId,
    groups: Object.fromEntries(entries) as Record<
      ActorMemoryKind,
      ActorMemoryListItem[]
    >,
  };
}

export async function patchActorMemoryService(
  actorId: string,
  memoryId: string,
  request: ActorMemoryPatchRequest,
  updatedAt: number = Date.now(),
): Promise<ActorMemoryMutationResponse> {
  const memory = typeof request.memory === "string" ? request.memory : "";
  if (!memory.trim()) {
    return memoryError(actorId, "INVALID_MEMORY", "记忆正文不能为空。");
  }
  const parsedMemoryId = parsePositiveIntegerId(memoryId);
  if (parsedMemoryId === null) {
    return memoryError(
      actorId,
      "INVALID_MEMORY",
      `Invalid memory id: ${memoryId}`,
    );
  }

  let coreActorId: number;
  try {
    coreActorId = toCoreActorId(actorId);
  } catch (error) {
    return memoryError(actorId, "INVALID_MEMORY", messageFromError(error));
  }

  try {
    const server = await ensureEmaServer();
    await ensureActorExists(server, coreActorId);
    const records = await server.memoryManager.listShortTermMemories(
      coreActorId,
      {
        ids: [parsedMemoryId],
        limit: 1,
      },
    );
    const record = records[0];
    if (!record) {
      return memoryError(actorId, "MEMORY_NOT_FOUND", "记忆不存在。");
    }
    const actualLength = countApproxMemoryLength(memory);
    const maxLength = MEMORY_MAX_LENGTHS[record.kind];
    if (actualLength > maxLength) {
      return memoryError(
        actorId,
        "INVALID_MEMORY",
        `记忆正文过长：约 ${actualLength}，最多 ${maxLength}。`,
      );
    }
    const updated: ShortTermMemoryRecord = {
      ...record,
      memory,
      updatedAt,
    };
    await upsertShortTermMemoryById(server, coreActorId, updated);
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      memory: toWebMemoryItem(updated),
    };
  } catch (error) {
    return memoryError(
      actorId,
      messageFromError(error).includes("not found")
        ? "MEMORY_NOT_FOUND"
        : "MEMORY_UPDATE_FAILED",
      messageFromError(error),
      true,
    );
  }
}

export async function deleteActorMemoryService(
  actorId: string,
  memoryId: string,
): Promise<ActorMemoryMutationResponse> {
  const parsedMemoryId = parsePositiveIntegerId(memoryId);
  if (parsedMemoryId === null) {
    return memoryError(
      actorId,
      "INVALID_MEMORY",
      `Invalid memory id: ${memoryId}`,
    );
  }

  let coreActorId: number;
  try {
    coreActorId = toCoreActorId(actorId);
  } catch (error) {
    return memoryError(actorId, "INVALID_MEMORY", messageFromError(error));
  }

  try {
    const server = await ensureEmaServer();
    await ensureActorExists(server, coreActorId);
    const records = await server.memoryManager.listShortTermMemories(
      coreActorId,
      {
        ids: [parsedMemoryId],
        limit: 1,
      },
    );
    if (!records[0]) {
      return memoryError(actorId, "MEMORY_NOT_FOUND", "记忆不存在。");
    }
    const deleted =
      await server.dbService.shortTermMemoryDB.deleteShortTermMemory(
        parsedMemoryId,
      );
    if (!deleted) {
      return memoryError(actorId, "MEMORY_NOT_FOUND", "记忆不存在。");
    }
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
    };
  } catch (error) {
    return memoryError(
      actorId,
      messageFromError(error).includes("not found")
        ? "MEMORY_NOT_FOUND"
        : "MEMORY_DELETE_FAILED",
      messageFromError(error),
      true,
    );
  }
}

async function ensureActorExists(server: EmaServer, actorId: number) {
  const details = await server.controller.actor.get(actorId);
  if (!details) {
    throw new Error("Actor not found.");
  }
}

function findScheduleById(
  listed: CoreScheduleListResult,
  scheduleId: string,
): CoreScheduleItem | null {
  for (const group of Object.values(listed)) {
    const item = group.find((candidate) => candidate.id === scheduleId);
    if (item) return item;
  }
  return null;
}

function parseScheduleRunAt(value: string): number | null {
  const match = SCHEDULE_RUN_AT_RE.exec(value);
  if (!match) {
    return null;
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

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null;
  }
  return date.getTime();
}

async function buildScheduleSessionMap(
  items: CoreScheduleItem[],
  server: EmaServer,
): Promise<Map<number, string>> {
  const conversationIds = new Set<number>();
  for (const item of items) {
    if (
      (item.task === "chat" || item.task === "focus") &&
      typeof item.conversationId === "number"
    ) {
      conversationIds.add(item.conversationId);
    }
  }
  if (conversationIds.size === 0) {
    return new Map();
  }

  const entries = await Promise.all(
    [...conversationIds].map(async (conversationId) => {
      const conversation =
        await server.dbService.conversationDB.getConversation(conversationId);
      return [conversationId, conversation?.session] as const;
    }),
  );
  return new Map(
    entries
      .filter(
        (entry): entry is readonly [number, string] =>
          typeof entry[1] === "string" && entry[1].trim().length > 0,
      )
      .map(([conversationId, session]) => [conversationId, session]),
  );
}

function toWebScheduleItem(
  item: CoreScheduleItem,
  sessions: Map<number, string> = new Map(),
): ActorScheduleListItem {
  const session =
    typeof item.conversationId === "number"
      ? sessions.get(item.conversationId)
      : undefined;
  return {
    id: item.id,
    type: item.type,
    task: item.task,
    editable: EDITABLE_SCHEDULE_TASKS.has(item.task),
    ...(item.runAt !== undefined ? { runAt: item.runAt } : {}),
    ...(item.nextRunAt !== undefined ? { nextRunAt: item.nextRunAt } : {}),
    ...(item.interval !== undefined ? { interval: item.interval } : {}),
    ...(item.lastRunAt !== undefined ? { lastRunAt: item.lastRunAt } : {}),
    ...(typeof item.conversationId === "number"
      ? { conversationId: String(item.conversationId) }
      : {}),
    ...(session ? { session } : {}),
    ...(item.summary !== undefined ? { summary: item.summary } : {}),
    prompt: item.prompt,
  };
}

function toWebMemoryItem(record: ShortTermMemoryRecord): ActorMemoryListItem {
  return {
    id: String(record.id),
    kind: record.kind,
    date: record.date,
    ...(record.dayDate !== undefined ? { dayDate: record.dayDate } : {}),
    maxLength: MEMORY_MAX_LENGTHS[record.kind],
    memory: record.memory,
    ...(record.createdAt !== undefined ? { createdAt: record.createdAt } : {}),
    ...(record.updatedAt !== undefined ? { updatedAt: record.updatedAt } : {}),
    ...(record.processedAt !== undefined
      ? { processedAt: record.processedAt }
      : {}),
  };
}

async function upsertShortTermMemoryById(
  server: EmaServer,
  actorId: number,
  record: ShortTermMemoryRecord,
) {
  await server.dbService.shortTermMemoryDB.upsertShortTermMemory({
    id: record.id,
    actorId,
    kind: record.kind,
    date: record.date,
    dayDate: record.dayDate,
    memory: record.memory,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    processedAt: record.processedAt,
  });
}

function parsePositiveIntegerId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    return null;
  }
  return parsed;
}

function countApproxMemoryLength(value: string): number {
  const tokens = value.match(/\p{Script=Han}|[\p{L}]+|[\p{N}]+/gu);
  return tokens?.length ?? 0;
}

function scheduleError(
  actorId: string,
  code: NonNullable<ActorScheduleMutationResponse["error"]>["code"],
  message: string,
  retryable = false,
): ActorScheduleMutationResponse {
  return {
    apiVersion: API_VERSION,
    ok: false,
    actorId,
    error: {
      code,
      retryable,
      message,
    },
  };
}

function memoryError(
  actorId: string,
  code: NonNullable<ActorMemoryMutationResponse["error"]>["code"],
  message: string,
  retryable = false,
): ActorMemoryMutationResponse {
  return {
    apiVersion: API_VERSION,
    ok: false,
    actorId,
    error: {
      code,
      retryable,
      message,
    },
  };
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
