import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

export const md = (strings: TemplateStringsArray, ...interp: any[]) => {
  const result = [];
  for (let i = 0; i < strings.length; i++) {
    result.push(strings[i]);
    if (interp[i]) {
      result.push(interp[i].toString());
    }
  }
  return result.join("");
};

/**
 * Formats a unix timestamp with the provided format string.
 * @param format - Dayjs-compatible format string.
 * @param timestamp - Unix timestamp in milliseconds.
 * @returns Formatted time string.
 */
export function formatTimestamp(format: string, timestamp: number): string {
  const parsed = dayjs(timestamp);
  if (!parsed.isValid()) {
    throw new Error("Invalid timestamp.");
  }
  return parsed.format(format);
}

/**
 * Parses a formatted time string into unix timestamp.
 * @param format - Dayjs-compatible format string.
 * @param timeString - Time string.
 * @returns Unix timestamp in milliseconds.
 */
export function parseTimestamp(format: string, timeString: string): number {
  const parsed = dayjs(timeString, format, true);
  if (!parsed.isValid()) {
    throw new Error(`Invalid time string for format "${format}".`);
  }
  return parsed.valueOf();
}
