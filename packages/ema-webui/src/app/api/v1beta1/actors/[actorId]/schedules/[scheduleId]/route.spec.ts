import { beforeEach, describe, expect, test, vi } from "vitest";

const patchActorScheduleService = vi.hoisted(() => vi.fn());
const deleteActorScheduleService = vi.hoisted(() => vi.fn());

vi.mock("@/server/services/actor-schedule-memory", () => ({
  deleteActorScheduleService,
  patchActorScheduleService,
}));

import { DELETE, PATCH, actorScheduleMutationStatus } from "./route";

describe("actor schedule mutation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("passes patch body to schedule service", async () => {
    const payload = {
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
      schedule: {
        id: "job-1",
        type: "once",
        task: "activity",
        editable: true,
        runAt: "2026-07-06 10:00:00",
        prompt: "新正文",
      },
    };
    patchActorScheduleService.mockResolvedValueOnce(payload);

    const response = await PATCH(
      new Request("http://localhost/api/v1beta1/actors/1/schedules/job-1", {
        method: "PATCH",
        body: JSON.stringify({ prompt: "新正文" }),
      }),
      { params: Promise.resolve({ actorId: "1", scheduleId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(patchActorScheduleService).toHaveBeenCalledWith("1", "job-1", {
      prompt: "新正文",
    });
  });

  test("passes delete requests to schedule service", async () => {
    const payload = {
      apiVersion: "v1beta1",
      ok: true,
      actorId: "1",
    };
    deleteActorScheduleService.mockResolvedValueOnce(payload);

    const response = await DELETE(
      new Request("http://localhost/api/v1beta1/actors/1/schedules/job-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ actorId: "1", scheduleId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(deleteActorScheduleService).toHaveBeenCalledWith("1", "job-1");
  });

  test("maps mutation status codes", () => {
    expect(
      [
        { ok: true },
        { ok: false, error: { code: "SCHEDULE_NOT_FOUND" } },
        { ok: false, error: { code: "SCHEDULE_UPDATE_FAILED" } },
        { ok: false, error: { code: "SCHEDULE_DELETE_FAILED" } },
        { ok: false, error: { code: "UNSUPPORTED_FIELD" } },
      ].map(actorScheduleMutationStatus),
    ).toEqual([200, 404, 500, 500, 400]);
  });
});
