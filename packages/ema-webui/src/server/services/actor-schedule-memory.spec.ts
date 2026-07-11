import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ensureEmaServer = vi.hoisted(() => vi.fn());

vi.mock("../ema-server", () => ({
  ensureEmaServer,
}));

import {
  buildActorMemoryListResponse,
  buildActorScheduleListResponse,
  deleteActorMemoryService,
  deleteActorScheduleService,
  patchActorMemoryService,
  patchActorScheduleService,
} from "./actor-schedule-memory";

describe("actor schedule and memory service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureEmaServer.mockReset();
  });

  test("lists actor schedules with editable flags and session labels", async () => {
    const list = vi.fn(async () => ({
      overdue: [],
      upcoming: [
        {
          id: "job-chat",
          type: "once",
          task: "chat",
          runAt: "2026-07-07 10:00:00",
          conversationId: 3,
          summary: "聊天",
          prompt: "继续聊",
          addition: {},
        },
      ],
      recurring: [
        {
          id: "job-sleep",
          type: "every",
          task: "sleep",
          nextRunAt: "2026-07-06 23:30:00",
          interval: "30 23 * * *",
          lastRunAt: null,
          conversationId: null,
          prompt: "",
          addition: {},
        },
      ],
      focused: [],
    }));
    const getConversation = vi.fn(async () => ({
      id: 3,
      actorId: 1,
      session: "web-chat-3",
      name: "",
      description: "",
    }));
    ensureEmaServer.mockResolvedValueOnce({
      controller: { actor: { get: vi.fn(async () => ({ actor: { id: 1 } })) } },
      getActorScheduler: vi.fn(() => ({ list })),
      dbService: { conversationDB: { getConversation } },
    });

    await expect(buildActorScheduleListResponse("1")).resolves.toEqual({
      apiVersion: "v1beta1",
      actorId: "1",
      groups: {
        overdue: [],
        upcoming: [
          {
            id: "job-chat",
            type: "once",
            task: "chat",
            editable: true,
            conversationId: "3",
            session: "web-chat-3",
            runAt: "2026-07-07 10:00:00",
            summary: "聊天",
            prompt: "继续聊",
          },
        ],
        recurring: [
          {
            id: "job-sleep",
            type: "every",
            task: "sleep",
            editable: false,
            nextRunAt: "2026-07-06 23:30:00",
            interval: "30 23 * * *",
            lastRunAt: null,
            prompt: "",
          },
        ],
        focused: [],
      },
    });
    expect(getConversation).toHaveBeenCalledWith(3);
  });

  test("updates editable one-time schedules and rejects invalid runAt before IO", async () => {
    const list = vi.fn(async () => ({
      overdue: [],
      upcoming: [
        {
          id: "job-1",
          type: "once",
          task: "activity",
          runAt: "2026-07-06 10:00:00",
          conversationId: null,
          summary: "旧摘要",
          prompt: "旧正文",
          addition: {},
        },
      ],
      recurring: [],
      focused: [],
    }));
    const update = vi.fn(async () => ({
      updated: [
        {
          id: "job-1",
          type: "once",
          task: "activity",
          runAt: "2026-07-06 11:30:00",
          conversationId: null,
          summary: "新摘要",
          prompt: "新正文",
          addition: {},
        },
      ],
    }));
    ensureEmaServer.mockResolvedValueOnce({
      controller: { actor: { get: vi.fn(async () => ({ actor: { id: 1 } })) } },
      getActorScheduler: vi.fn(() => ({ list, update })),
    });

    await expect(
      patchActorScheduleService("1", "job-1", {
        summary: " 新摘要 ",
        prompt: " 新正文 ",
        runAt: "2026-07-06 11:30:00",
      }),
    ).resolves.toMatchObject({
      ok: true,
      schedule: {
        id: "job-1",
        runAt: "2026-07-06 11:30:00",
        summary: "新摘要",
        prompt: "新正文",
      },
    });
    expect(update).toHaveBeenCalledWith([
      {
        id: "job-1",
        summary: "新摘要",
        prompt: " 新正文 ",
        runAt: new Date(2026, 6, 6, 11, 30, 0).getTime(),
      },
    ]);

    ensureEmaServer.mockClear();
    await expect(
      patchActorScheduleService("1", "job-1", {
        runAt: "2026-02-29 10:00:00",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_SCHEDULE", retryable: false },
    });
    expect(ensureEmaServer).not.toHaveBeenCalled();
  });

  test("rejects non-editable schedule patches", async () => {
    const update = vi.fn();
    ensureEmaServer.mockResolvedValueOnce({
      controller: { actor: { get: vi.fn(async () => ({ actor: { id: 1 } })) } },
      getActorScheduler: vi.fn(() => ({
        update,
        list: vi.fn(async () => ({
          overdue: [],
          upcoming: [],
          recurring: [
            {
              id: "job-sleep",
              type: "every",
              task: "sleep",
              nextRunAt: "2026-07-06 23:30:00",
              interval: "30 23 * * *",
              lastRunAt: null,
              conversationId: null,
              prompt: "",
              addition: {},
            },
          ],
          focused: [],
        })),
      })),
    });

    await expect(
      patchActorScheduleService("1", "job-sleep", { prompt: "不能改" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_FIELD", retryable: false },
    });
    expect(update).not.toHaveBeenCalled();
  });

  test("deletes only editable actor schedules by id", async () => {
    const deleteSchedule = vi.fn(async () => ({ deletedIds: ["job-1"] }));
    const list = vi.fn(async () => ({
      overdue: [],
      upcoming: [
        {
          id: "job-1",
          type: "once",
          task: "activity",
          runAt: "2026-07-06 10:00:00",
          conversationId: null,
          prompt: "活动",
          addition: {},
        },
      ],
      recurring: [],
      focused: [],
    }));
    ensureEmaServer.mockResolvedValueOnce({
      controller: { actor: { get: vi.fn(async () => ({ actor: { id: 1 } })) } },
      getActorScheduler: vi.fn(() => ({ delete: deleteSchedule, list })),
    });

    await expect(deleteActorScheduleService("1", "job-1")).resolves.toEqual({
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
    });
    expect(deleteSchedule).toHaveBeenCalledWith(["job-1"]);

    const blockedDelete = vi.fn();
    ensureEmaServer.mockResolvedValueOnce({
      controller: { actor: { get: vi.fn(async () => ({ actor: { id: 1 } })) } },
      getActorScheduler: vi.fn(() => ({
        delete: blockedDelete,
        list: vi.fn(async () => ({
          overdue: [],
          upcoming: [],
          recurring: [
            {
              id: "job-sleep",
              type: "every",
              task: "sleep",
              nextRunAt: "2026-07-06 23:30:00",
              interval: "30 23 * * *",
              lastRunAt: null,
              conversationId: null,
              prompt: "",
              addition: {},
            },
          ],
          focused: [],
        })),
      })),
    });
    await expect(
      deleteActorScheduleService("1", "job-sleep"),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_FIELD", retryable: false },
    });
    expect(blockedDelete).not.toHaveBeenCalled();
  });

  test("lists short-term memories with max lengths and per-kind limits", async () => {
    const listShortTermMemories = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, kind: "year", date: "2026", memory: "年记" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 3, kind: "day", date: "2026-07-06", memory: "日记" },
      ])
      .mockResolvedValueOnce([]);
    ensureEmaServer.mockResolvedValueOnce({
      controller: { actor: { get: vi.fn(async () => ({ actor: { id: 1 } })) } },
      memoryManager: { listShortTermMemories },
    });

    await expect(buildActorMemoryListResponse("1")).resolves.toMatchObject({
      apiVersion: "v1beta1",
      actorId: "1",
      groups: {
        year: [{ id: "1", kind: "year", maxLength: 400, memory: "年记" }],
        month: [],
        day: [{ id: "3", kind: "day", maxLength: 500, memory: "日记" }],
        activity: [],
      },
    });
    expect(listShortTermMemories).toHaveBeenNthCalledWith(1, 1, {
      kind: "year",
      limit: 50,
      sort: "desc",
    });
    expect(listShortTermMemories).toHaveBeenNthCalledWith(4, 1, {
      kind: "activity",
      limit: 10,
      sort: "desc",
    });
  });

  test("updates memory content, preserves metadata, and enforces length limits", async () => {
    const listShortTermMemories = vi.fn(async () => [
      {
        id: 9,
        kind: "activity",
        date: "2026-07-06 10:00:00",
        dayDate: "2026-07-06",
        memory: "old",
        createdAt: 1,
        updatedAt: 2,
        processedAt: 3,
      },
    ]);
    const upsertShortTermMemory = vi.fn();
    ensureEmaServer.mockResolvedValue({
      controller: { actor: { get: vi.fn(async () => ({ actor: { id: 1 } })) } },
      memoryManager: { listShortTermMemories },
      dbService: { shortTermMemoryDB: { upsertShortTermMemory } },
    });

    await expect(
      patchActorMemoryService("1", "9", { memory: " new " }, 100),
    ).resolves.toMatchObject({
      ok: true,
      memory: {
        id: "9",
        dayDate: "2026-07-06",
        maxLength: 100,
        memory: " new ",
        createdAt: 1,
        updatedAt: 100,
        processedAt: 3,
      },
    });
    expect(upsertShortTermMemory).toHaveBeenCalledWith({
      id: 9,
      actorId: 1,
      kind: "activity",
      date: "2026-07-06 10:00:00",
      dayDate: "2026-07-06",
      memory: " new ",
      createdAt: 1,
      updatedAt: 100,
      processedAt: 3,
    });

    await expect(
      patchActorMemoryService("1", "9", { memory: "字".repeat(101) }, 100),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_MEMORY", retryable: false },
    });
  });

  test("deletes short-term memories after actor ownership lookup", async () => {
    const listShortTermMemories = vi.fn(async () => [
      { id: 9, kind: "day", date: "2026-07-06", memory: "日记" },
    ]);
    const deleteShortTermMemory = vi.fn(async () => true);
    ensureEmaServer.mockResolvedValueOnce({
      controller: { actor: { get: vi.fn(async () => ({ actor: { id: 1 } })) } },
      memoryManager: { listShortTermMemories },
      dbService: { shortTermMemoryDB: { deleteShortTermMemory } },
    });

    await expect(deleteActorMemoryService("1", "9")).resolves.toEqual({
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
    });
    expect(listShortTermMemories).toHaveBeenCalledWith(1, {
      ids: [9],
      limit: 1,
    });
    expect(deleteShortTermMemory).toHaveBeenCalledWith(9);
  });
});
