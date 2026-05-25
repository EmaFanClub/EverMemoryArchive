/** Normalizes internal think text into one compact line. */
export function normalizeThinkText(value: string): string {
  return value
    .replaceAll(/\\n|\r?\n/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}
