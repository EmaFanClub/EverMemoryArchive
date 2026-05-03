import {
  CREATE_ACTOR_SLEEP_AXIS_MINUTES,
  CREATE_ACTOR_SLEEP_STEP_MINUTES,
  type MbtiAxis,
} from "./constants";

export function clampAxisMinutes(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > CREATE_ACTOR_SLEEP_AXIS_MINUTES)
    return CREATE_ACTOR_SLEEP_AXIS_MINUTES;
  return value;
}

export function snapAxisMinutes(value: number) {
  const clamped = clampAxisMinutes(value);
  return (
    Math.round(clamped / CREATE_ACTOR_SLEEP_STEP_MINUTES) *
    CREATE_ACTOR_SLEEP_STEP_MINUTES
  );
}

export function axisMinutesToClockLabel(value: number) {
  const axis =
    ((value % CREATE_ACTOR_SLEEP_AXIS_MINUTES) +
      CREATE_ACTOR_SLEEP_AXIS_MINUTES +
      12 * 60) %
    CREATE_ACTOR_SLEEP_AXIS_MINUTES;
  const hh = Math.floor(axis / 60);
  const mm = axis % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function formatSleepDuration(startMin: number, endMin: number) {
  const total = Math.max(0, endMin - startMin);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

export function computeCurrentAxisMinutes() {
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  return (
    (m - 12 * 60 + CREATE_ACTOR_SLEEP_AXIS_MINUTES) %
    CREATE_ACTOR_SLEEP_AXIS_MINUTES
  );
}

export function createActorNameInitial(name: string) {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "";
  const chars = Array.from(trimmed);
  return chars[0] ?? "";
}

export function formatCreateActorBirthday(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year} / ${month} / ${day}`;
}

export function buildMbtiCode(axes: Record<MbtiAxis, string>) {
  return `${axes.EI}${axes.SN}${axes.TF}${axes.JP}`;
}
