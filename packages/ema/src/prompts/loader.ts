import fs from "node:fs/promises";
import path from "node:path";

import { resolveEmaSourcePath } from "../shared/package_path";

export type SystemPromptName =
  | "foreground"
  | "background"
  | "background-conversation";

export type TaskPromptName =
  | "scheduled-chat"
  | "scheduled-activity"
  | "conversation-rollup"
  | "memory-rollup"
  | "wake"
  | "sleep";

export type PromptVariables = Record<
  string,
  string | number | boolean | null | undefined
>;

const INCLUDE_PATTERN = /^<!--[ \t]*@include[ \t]+(.+?)[ \t]*-->[ \t]*$/gm;

export class PromptStore {
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = path.resolve(rootDir ?? resolveEmaSourcePath("prompts"));
  }

  async loadSystemPrompt(
    name: SystemPromptName,
    variables: PromptVariables = {},
  ): Promise<string> {
    return this.loadPrompt(path.join("system_prompt", `${name}.md`), variables);
  }

  async loadTaskPrompt(
    name: TaskPromptName,
    variables: PromptVariables = {},
  ): Promise<string> {
    return this.loadPrompt(path.join("task_prompt", `${name}.md`), variables);
  }

  private async loadPrompt(
    relativePath: string,
    variables: PromptVariables,
  ): Promise<string> {
    const content = await this.loadPromptFile(relativePath, variables, []);
    return this.replaceVariables(content, variables);
  }

  private async loadPromptFile(
    relativePath: string,
    variables: PromptVariables,
    includeStack: string[],
  ): Promise<string> {
    const absolutePath = this.resolveInsideRoot(relativePath);
    if (includeStack.includes(absolutePath)) {
      const cycle = [...includeStack, absolutePath]
        .map((item) => path.relative(this.rootDir, item))
        .join(" -> ");
      throw new Error(`Prompt include cycle detected: ${cycle}`);
    }
    const nextIncludeStack = [...includeStack, absolutePath];
    const content = this.trimBoundaryBlankLines(
      await fs.readFile(absolutePath, "utf-8"),
    );
    return await this.resolveIncludes(content, variables, nextIncludeStack);
  }

  private async resolveIncludes(
    content: string,
    variables: PromptVariables,
    includeStack: string[],
  ): Promise<string> {
    const parts: string[] = [];
    let lastIndex = 0;
    for (const match of content.matchAll(INCLUDE_PATTERN)) {
      parts.push(content.slice(lastIndex, match.index));
      const includePath = this.replaceVariables(match[1], variables);
      parts.push(
        await this.loadPromptFile(includePath, variables, includeStack),
      );
      lastIndex = match.index + match[0].length;
    }
    parts.push(content.slice(lastIndex));
    return parts.join("");
  }

  private replaceVariables(
    content: string,
    variables: PromptVariables,
  ): string {
    let result = content;
    for (const [key, value] of Object.entries(variables)) {
      if (value === null || value === undefined) {
        continue;
      }
      result = result.replaceAll(`{${key}}`, String(value));
    }
    return result;
  }

  private resolveInsideRoot(relativePath: string): string {
    const absolutePath = path.resolve(this.rootDir, relativePath);
    const relativeToRoot = path.relative(this.rootDir, absolutePath);
    if (
      relativeToRoot === ".." ||
      relativeToRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToRoot)
    ) {
      throw new Error("Prompt include path escapes prompt root");
    }
    return absolutePath;
  }

  private trimBoundaryBlankLines(content: string): string {
    return content
      .replace(/^(?:[ \t]*\r?\n)+/, "")
      .replace(/(?:\r?\n[ \t]*)+$/, "");
  }
}
