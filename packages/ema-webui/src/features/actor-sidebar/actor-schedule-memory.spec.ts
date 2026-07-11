import { describe, expect, test } from "vitest";

import {
  MEMORY_GROUPS,
  SCHEDULE_GROUPS,
  countApproxMemoryLength,
  formatFocusedScheduleSessionLabel,
  formatMemoryPreview,
  formatMemorySourceLabel,
  formatMemoryUpdatedAtLabel,
  formatScheduleIntervalLabel,
  formatSchedulePreview,
  formatScheduleSessionLabel,
  formatScheduleTimeLabel,
  formatScheduleTitle,
  getMemoryGroupsForActor,
  getScheduleGroupsForActor,
  hasReadonlyScheduleDetails,
  isEditableScheduleTask,
  isMemoryGroupEmpty,
  isValidScheduleRunAt,
  isVisibleScheduleInGroup,
} from "./actor-schedule-memory";

describe("actor schedule and memory helpers", () => {
  test("keeps schedule and memory groups in UI order", () => {
    expect(SCHEDULE_GROUPS.map((group) => [group.id, group.label])).toEqual([
      ["upcoming", "单次日程"],
      ["recurring", "周期日程"],
      ["focused", "关注会话"],
      ["overdue", "过时日程"],
    ]);
    expect(MEMORY_GROUPS.map((group) => [group.kind, group.label])).toEqual([
      ["year", "年记"],
      ["month", "月记"],
      ["day", "日记"],
      ["activity", "活动"],
    ]);
  });

  test("formats memory card labels, metadata, and previews", () => {
    expect(
      (["year", "month", "day", "activity"] as const).map((kind) =>
        formatMemorySourceLabel({
          id: kind,
          kind,
          date: "2026-07-06",
          maxLength: 500,
          memory: "",
        }),
      ),
    ).toEqual(["年记", "月记", "日记", "活动"]);
    expect(
      formatMemoryUpdatedAtLabel({
        id: "1",
        kind: "activity",
        date: "2026-07-06 10:00:00",
        maxLength: 100,
        memory: "活动",
        updatedAt: new Date(2026, 6, 6, 10, 5, 9).getTime(),
      }),
    ).toBe("更新于 2026-07-06 10:05:09");
    expect(
      formatMemoryPreview({
        id: "2",
        kind: "day",
        date: "2026-07-06",
        maxLength: 500,
        memory: " 第一行 \n 第二行 ",
      }),
    ).toBe("第一行 第二行");
    expect(countApproxMemoryLength("晚饭后散步 read 12 pages")).toBe(8);
  });

  test("detects whether memory groups have content", () => {
    expect(
      isMemoryGroupEmpty({ year: [], month: [], day: [], activity: [] }),
    ).toBe(true);
    expect(
      isMemoryGroupEmpty({
        year: [],
        month: [],
        day: [
          {
            id: "1",
            kind: "day",
            date: "2026-07-06",
            maxLength: 500,
            memory: "日记",
          },
        ],
        activity: [],
      }),
    ).toBe(false);
  });

  test("formats schedule card content and session badges", () => {
    const chatSchedule = {
      id: "chat",
      type: "once",
      task: "chat",
      editable: true,
      conversationId: "1",
      session: "web-chat-1",
      runAt: "2026-07-06 10:00:00",
      summary: " 主动联系 ",
      prompt: " 第一行正文 \n 第二行正文 ",
    } as const;

    expect(formatScheduleTimeLabel(chatSchedule)).toBe("2026-07-06 10:00:00");
    expect(formatScheduleSessionLabel(chatSchedule)).toBe("web-chat-1");
    expect(formatScheduleTitle(chatSchedule)).toBe("主动联系");
    expect(formatSchedulePreview(chatSchedule)).toBe("第一行正文 第二行正文");
    expect(
      formatScheduleTimeLabel({
        id: "2",
        type: "every",
        task: "activity",
        editable: true,
        nextRunAt: "2026-07-06 23:30:00",
        interval: 300000,
        prompt: "活动",
      }),
    ).toBe("下次 2026-07-06 23:30:00 / 周期 5 分钟");
  });

  test("keeps schedule edit and time validation rules tight", () => {
    expect(isEditableScheduleTask("chat")).toBe(true);
    expect(isEditableScheduleTask("activity")).toBe(true);
    expect(isEditableScheduleTask("sleep")).toBe(false);
    expect(
      hasReadonlyScheduleDetails({
        id: "1",
        type: "once",
        task: "activity",
        editable: true,
        runAt: "2026-07-06 10:00:00",
        prompt: "活动",
      }),
    ).toBe(false);
    expect(
      hasReadonlyScheduleDetails({
        id: "2",
        type: "every",
        task: "activity",
        editable: true,
        interval: 300000,
        prompt: "活动",
      }),
    ).toBe(true);
    expect(isValidScheduleRunAt("2026-07-06 10:00:00")).toBe(true);
    expect(isValidScheduleRunAt("2026-02-29 10:00:00")).toBe(false);
  });

  test("formats focused schedule metadata and hides sleep routines", () => {
    expect(formatScheduleIntervalLabel(60000)).toBe("1 分钟");
    expect(
      formatFocusedScheduleSessionLabel({
        id: "focus",
        type: "every",
        task: "focus",
        editable: false,
        conversationId: "1",
        prompt: "",
      }),
    ).toBe("1");
    expect(
      isVisibleScheduleInGroup("recurring", {
        id: "sleep",
        type: "every",
        task: "sleep",
        editable: false,
        prompt: "",
      }),
    ).toBe(false);
  });

  test("ignores stale schedule and memory data from another actor", () => {
    expect(
      getScheduleGroupsForActor(
        {
          apiVersion: "v1beta1",
          actorId: "1",
          groups: { overdue: [], upcoming: [], recurring: [], focused: [] },
        },
        "2",
      ),
    ).toBeNull();
    expect(
      getMemoryGroupsForActor(
        {
          apiVersion: "v1beta1",
          actorId: "1",
          groups: { year: [], month: [], day: [], activity: [] },
        },
        "2",
      ),
    ).toBeNull();
  });
});
