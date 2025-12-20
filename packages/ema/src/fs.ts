import fs from "fs/promises";
import { dirname } from "path";
import tmp from "tmp";

/**
 * File system interface
 */
export interface Fs {
  /**
   * Checks if a file exists
   * @param path - Path to the file to check
   * @returns Promise resolving to true if the file exists, false otherwise
   */
  exists(path: string): Promise<boolean>;

  /**
   * Reads content from a file atomically
   * @param path - Path to the file to read
   * @returns Promise resolving to the file content as string
   */
  read(path: string): Promise<string>;

  /**
   * Writes content to a file atomically
   * @param path - Path to the file to write
   * @param content - Content to write to the file
   * @returns Promise resolving when the write completes
   */
  write(path: string, content: string): Promise<void>;
}

/**
 * Real file system implementation
 * Uses Node.js fs/promises for actual file operations
 */
export class RealFs implements Fs {
  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string): Promise<string> {
    return await fs.readFile(path, "utf-8");
  }

  /**
   * Writes content to a file atomically
   * @param path - Path to the file to write
   * @param content - Content to write to the file
   */
  async write(path: string, content: string): Promise<void> {
    const dir = dirname(path);
    await fs.mkdir(dir, { recursive: true });
    const tmpFileName = `${path}.tmp`;
    await fs.writeFile(tmpFileName, content, "utf-8");
    await fs.rename(tmpFileName, path);
  }
}

/**
 * In-memory file system implementation
 * Stores files in memory for testing purposes
 */
export class MemFs implements Fs {
  private files: Map<string, string> = new Map();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}
