import type { Server } from "../server";
import type {
  ActorRecurringScheduleItem,
  ActorScheduleItem,
} from "../scheduler";
import type { SleepScheduleInput } from "./types";

const DAY_MINUTES = 24 * 60;
const AXIS_TO_CLOCK_OFFSET_MINUTES = 12 * 60;
const MIN_SLEEP_DURATION_MINUTES = 6 * 60;
const MAX_SLEEP_DURATION_MINUTES = 12 * 60;

export class ScheduleController {
  constructor(private readonly server: Server) {}

  async updateSleepSchedule(
    actorId: number,
    schedule: SleepScheduleInput,
  ): Promise<{ updated: ActorScheduleItem[] }> {
    validateSleepSchedule(schedule);
    const scheduler = this.server.getActorScheduler(actorId);
    const result = await scheduler.add([
      {
        task: "sleep",
        interval: toDailyCron(schedule.startMinutes),
      },
      {
        task: "wake",
        interval: toDailyCron(schedule.endMinutes),
      },
    ]);
    return {
      updated: result.added,
    };
  }

  async getSleepSchedule(actorId: number): Promise<{
    wake: ActorRecurringScheduleItem | null;
    sleep: ActorRecurringScheduleItem | null;
  }> {
    const listed = await this.server.getActorScheduler(actorId).list();
    return {
      wake: listed.recurring.find((item) => item.task === "wake") ?? null,
      sleep: listed.recurring.find((item) => item.task === "sleep") ?? null,
    };
  }

  async getSleepScheduleInput(
    actorId: number,
  ): Promise<SleepScheduleInput | null> {
    const schedule = await this.getSleepSchedule(actorId);
    const startMinutes = parseDailyCronAxisMinutes(schedule.sleep?.interval);
    const endMinutes = parseDailyCronAxisMinutes(schedule.wake?.interval);
    if (startMinutes === null || endMinutes === null) {
      return null;
    }
    const normalizedEndMinutes =
      endMinutes <= startMinutes ? endMinutes + DAY_MINUTES : endMinutes;
    return {
      startMinutes,
      endMinutes: normalizedEndMinutes,
    };
  }
}

export function validateSleepSchedule(schedule: SleepScheduleInput): void {
  if (
    !Number.isInteger(schedule.startMinutes) ||
    !Number.isInteger(schedule.endMinutes) ||
    schedule.startMinutes < 0 ||
    schedule.endMinutes < 0 ||
    schedule.startMinutes > DAY_MINUTES ||
    schedule.endMinutes > DAY_MINUTES
  ) {
    throw new Error("sleepSchedule minutes must be integers on a 24h axis.");
  }
  const duration = schedule.endMinutes - schedule.startMinutes;
  if (
    duration < MIN_SLEEP_DURATION_MINUTES ||
    duration > MAX_SLEEP_DURATION_MINUTES
  ) {
    throw new Error("sleepSchedule duration must be between 6 and 12 hours.");
  }
}

function toDailyCron(axisMinutes: number): string {
  const clockMinutes =
    (axisMinutes + AXIS_TO_CLOCK_OFFSET_MINUTES) % DAY_MINUTES;
  const minute = clockMinutes % 60;
  const hour = Math.floor(clockMinutes / 60);
  return `${minute} ${hour} * * *`;
}

function parseDailyCronAxisMinutes(
  interval: ActorRecurringScheduleItem["interval"] | undefined,
): number | null {
  if (typeof interval !== "string") {
    return null;
  }
  const parts = interval.trim().split(/\s+/);
  if (
    parts.length !== 5 ||
    parts[2] !== "*" ||
    parts[3] !== "*" ||
    parts[4] !== "*"
  ) {
    return null;
  }
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (
    !Number.isInteger(minute) ||
    !Number.isInteger(hour) ||
    minute < 0 ||
    minute >= 60 ||
    hour < 0 ||
    hour >= 24
  ) {
    return null;
  }
  return (
    (hour * 60 + minute - AXIS_TO_CLOCK_OFFSET_MINUTES + DAY_MINUTES) %
    DAY_MINUTES
  );
}
