import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
);
const templateCache = new Map<string, string>();

/**
 * Loads one or more prompt templates from the built-in templates directory.
 * @param names - Template file names to load.
 * @returns Joined template text.
 */
export async function loadPromptTemplate(...names: string[]): Promise<string> {
  const parts = await Promise.all(
    names.map((name) => loadPromptTemplatePart(name)),
  );
  return parts.join("\n---\n");
}

async function loadPromptTemplatePart(name: string): Promise<string> {
  const cacheKey = path.normalize(name);
  const cached = templateCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const filePath = path.join(TEMPLATE_DIR, name);
  const content = await fs.readFile(filePath, "utf-8");
  templateCache.set(cacheKey, content);
  return content;
}
