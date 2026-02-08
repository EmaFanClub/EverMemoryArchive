import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

const RUN_AT_FORMAT = "YYYY-MM-DD HH:mm:ss";

/**
 * Parses a runAt string in "YYYY-MM-DD HH:mm:ss" format into a timestamp.
 * @param runAt - RunAt string to parse.
 * @returns Unix timestamp in milliseconds.
 */
export function parseRunAt(runAt: string): number {
  const parsed = dayjs(runAt, RUN_AT_FORMAT, true);
  if (!parsed.isValid()) {
    throw new Error(`runAt must be in format "${RUN_AT_FORMAT}".`);
  }
  return parsed.valueOf();
}

/**
 * Formats a timestamp into "YYYY-MM-DD HH:mm:ss".
 * @param timestamp - Unix timestamp in milliseconds.
 * @returns Formatted runAt string.
 */
export function formatRunAt(timestamp: number): string {
  const parsed = dayjs(timestamp);
  if (!parsed.isValid()) {
    throw new Error("Invalid timestamp.");
  }
  return parsed.format(RUN_AT_FORMAT);
}
