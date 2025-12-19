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
    const tempFile = tmp.fileSync();
    try {
      // todo: The temporary file is not being created in the same directory as the target file.
      // The tmp.fileSync() creates the temporary file in the system's temp directory,
      // which could be on a different filesystem.
      // This violates the atomic rename operation requirement since rename() is only atomic
      // when both files are on the same filesystem.
      await fs.writeFile(tempFile.name, content, "utf-8");
      await fs.rename(tempFile.name, path);
    } finally {
      tempFile.removeCallback();
    }
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
    return this.files.get(path) ?? "{}";
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}
