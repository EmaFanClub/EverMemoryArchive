import { formatTimestamp, parseTimestamp } from "../../utils";

const RUN_AT_FORMAT = "YYYY-MM-DD HH:mm:ss";

/**
 * Parses a runAt string in "YYYY-MM-DD HH:mm:ss" format into a timestamp.
 * @param runAt - RunAt string to parse.
 * @returns Unix timestamp in milliseconds.
 */
export function parseRunAt(runAt: string): number {
  try {
    return parseTimestamp(RUN_AT_FORMAT, runAt);
  } catch {
    throw new Error(`runAt must be in format "${RUN_AT_FORMAT}".`);
  }
}

/**
 * Formats a timestamp into "YYYY-MM-DD HH:mm:ss".
 * @param timestamp - Unix timestamp in milliseconds.
 * @returns Formatted runAt string.
 */
export function formatRunAt(timestamp: number): string {
  return formatTimestamp(RUN_AT_FORMAT, timestamp);
}
