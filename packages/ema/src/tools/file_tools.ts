/** File operation tools. */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { get_encoding, Tiktoken } from "@dqbd/tiktoken";

import { Tool, ToolResult } from "./base";

const DEFAULT_MAX_TOKENS = 32000;

export function truncateTextByTokens(text: string, maxTokens: number): string {
  /** Truncate text by token count if it exceeds the limit.
   *
   * When text exceeds the specified token limit, performs intelligent truncation
   * by keeping the front and back parts while truncating the middle.
   *
   * Args:
   *     text: Text to be truncated
   *     maxTokens: Maximum token limit
   *
   * Returns:
   *     str: Truncated text if it exceeds the limit, otherwise the original text.
   *
   * Example:
   *     >>> text = "very long text..." * 10000
   *     >>> truncated = truncate_text_by_tokens(text, 64000)
   *     >>> print(truncated)
   */
  const encoding: Tiktoken = get_encoding("cl100k_base");

  try {
    const tokenCount = encoding.encode(text).length;

    // Return original text if under limit
    if (tokenCount <= maxTokens) {
      return text;
    }

    // Calculate token/character ratio for approximation
    const charCount = text.length || 1;
    const ratio = tokenCount / charCount;

    // Keep head and tail mode: allocate half space for each (with 5% safety margin)
    const charsPerHalf = Math.floor((maxTokens / 2 / ratio) * 0.95);

    // Truncate front part: find nearest newline
    let headPart = text.slice(0, charsPerHalf);
    const lastNewlineHead = headPart.lastIndexOf("\n");
    if (lastNewlineHead > 0) {
      headPart = headPart.slice(0, lastNewlineHead);
    }

    // Truncate back part: find nearest newline
    let tailPart = text.slice(-charsPerHalf);
    const firstNewlineTail = tailPart.indexOf("\n");
    if (firstNewlineTail > 0) {
      tailPart = tailPart.slice(firstNewlineTail + 1);
    }

    // Combine result
    const truncationNote = `\n\n... [Content truncated: ${tokenCount} tokens -> ~${maxTokens} tokens limit] ...\n\n`;
    return headPart + truncationNote + tailPart;
  } finally {
    encoding.free();
  }
}

export class ReadTool extends Tool {
  workspaceDir: string;

  constructor(workspaceDir: string = ".") {
    /**
     * Initialize ReadTool with workspace directory.
     *
     * Args:
     *     workspaceDir: Base directory for resolving relative paths
     */
    super();
    this.workspaceDir = path.resolve(workspaceDir);
  }

  get name(): string {
    return "read_file";
  }

  get description(): string {
    return (
      "Read file contents from the filesystem. Output always includes line numbers " +
      "in format 'LINE_NUMBER|LINE_CONTENT' (1-indexed). Supports reading partial content " +
      "by specifying line offset and limit for large files. " +
      "You can call this tool multiple times in parallel to read different files simultaneously."
    );
  }

  get parameters(): Record<string, any> {
    return {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to the file",
        },
        offset: {
          type: "integer",
          description:
            "Starting line number (1-indexed). Use for large files to read from specific line",
        },
        limit: {
          type: "integer",
          description:
            "Number of lines to read. Use with offset for large files to read in chunks",
        },
      },
      required: ["path"],
    };
  }

  async execute(
    pathInput: string,
    offset?: number | null,
    limit?: number | null,
  ): Promise<ToolResult> {
    /** Execute read file. */
    try {
      const resolvedPath = path.isAbsolute(pathInput)
        ? pathInput
        : path.resolve(this.workspaceDir, pathInput);

      if (!fs.existsSync(resolvedPath)) {
        return new ToolResult({
          success: false,
          content: "",
          error: `File not found: ${pathInput}`,
        });
      }

      const rawContent = await fsp.readFile(resolvedPath, "utf-8");
      const lines = rawContent.split("\n");

      // Apply offset and limit
      let start = offset ? offset - 1 : 0;
      let end = limit ? start + limit : lines.length;
      if (start < 0) {
        start = 0;
      }
      if (end > lines.length) {
        end = lines.length;
      }

      const selectedLines = lines.slice(start, end);

      // Format with line numbers (1-indexed)
      const numberedLines: string[] = [];
      selectedLines.forEach((line, index) => {
        const lineContent = line.replace(/\r$/, "");
        const lineNumber = (start + index + 1).toString().padStart(6, " ");
        numberedLines.push(`${lineNumber}|${lineContent}`);
      });

      let content = numberedLines.join("\n");

      // Apply token truncation if needed
      content = truncateTextByTokens(content, DEFAULT_MAX_TOKENS);

      return new ToolResult({ success: true, content });
    } catch (error) {
      return new ToolResult({
        success: false,
        content: "",
        error: (error as Error).message,
      });
    }
  }
}

export class WriteTool extends Tool {
  workspaceDir: string;

  constructor(workspaceDir: string = ".") {
    /**
     * Initialize WriteTool with workspace directory.
     *
     * Args:
     *     workspaceDir: Base directory for resolving relative paths
     */
    super();
    this.workspaceDir = path.resolve(workspaceDir);
  }

  get name(): string {
    return "write_file";
  }

  get description(): string {
    return (
      "Write content to a file. Will overwrite existing files completely. " +
      "For existing files, you should read the file first using read_file. " +
      "Prefer editing existing files over creating new ones unless explicitly needed."
    );
  }

  get parameters(): Record<string, any> {
    return {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to the file",
        },
        content: {
          type: "string",
          description:
            "Complete content to write (will replace existing content)",
        },
      },
      required: ["path", "content"],
    };
  }

  async execute(pathInput: string, content: string): Promise<ToolResult> {
    /** Execute write file. */
    try {
      const resolvedPath = path.isAbsolute(pathInput)
        ? pathInput
        : path.resolve(this.workspaceDir, pathInput);

      await fsp.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fsp.writeFile(resolvedPath, content, "utf-8");

      return new ToolResult({
        success: true,
        content: `Successfully wrote to ${resolvedPath}`,
      });
    } catch (error) {
      return new ToolResult({
        success: false,
        content: "",
        error: (error as Error).message,
      });
    }
  }
}

export class EditTool extends Tool {
  workspaceDir: string;

  constructor(workspaceDir: string = ".") {
    /**
     * Initialize EditTool with workspace directory.
     *
     * Args:
     *     workspaceDir: Base directory for resolving relative paths
     */
    super();
    this.workspaceDir = path.resolve(workspaceDir);
  }

  get name(): string {
    return "edit_file";
  }

  get description(): string {
    return (
      "Perform exact string replacement in a file. The old_str must match exactly " +
      "and appear uniquely in the file, otherwise the operation will fail. " +
      "You must read the file first before editing. Preserve exact indentation from the source."
    );
  }

  get parameters(): Record<string, any> {
    return {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to the file",
        },
        old_str: {
          type: "string",
          description:
            "Exact string to find and replace (must be unique in file)",
        },
        new_str: {
          type: "string",
          description:
            "Replacement string (use for refactoring, renaming, etc.)",
        },
      },
      required: ["path", "old_str", "new_str"],
    };
  }

  async execute(
    pathInput: string,
    oldStr: string,
    newStr: string,
  ): Promise<ToolResult> {
    /** Execute edit file. */
    try {
      const resolvedPath = path.isAbsolute(pathInput)
        ? pathInput
        : path.resolve(this.workspaceDir, pathInput);

      if (!fs.existsSync(resolvedPath)) {
        return new ToolResult({
          success: false,
          content: "",
          error: `File not found: ${pathInput}`,
        });
      }

      const content = await fsp.readFile(resolvedPath, "utf-8");

      if (!content.includes(oldStr)) {
        return new ToolResult({
          success: false,
          content: "",
          error: `Text not found in file: ${oldStr}`,
        });
      }

      const newContent = content.replaceAll(oldStr, newStr);
      await fsp.writeFile(resolvedPath, newContent, "utf-8");

      return new ToolResult({
        success: true,
        content: `Successfully edited ${resolvedPath}`,
      });
    } catch (error) {
      return new ToolResult({
        success: false,
        content: "",
        error: (error as Error).message,
      });
    }
  }
}
