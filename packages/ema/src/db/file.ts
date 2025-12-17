/**
 * File system interface and implementations for database storage.
 * Provides both real file system and in-memory file system implementations.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RoleDB, RoleData } from "./base";

/**
 * File system interface for reading and writing files
 */
export interface Fs {
  /**
   * Reads content from a file
   * @param path - Path to the file to read
   * @returns Promise resolving to the file content as string
   */
  read(path: string): Promise<string>;

  /**
   * Writes content to a file
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
  async read(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "{}";
      }
      throw error;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
    await writeFile(path, content, "utf-8");
  }
}

/**
 * In-memory file system implementation
 * Stores files in memory for testing purposes
 */
export class MemFs implements Fs {
  private files: Map<string, string> = new Map();

  async read(path: string): Promise<string> {
    return this.files.get(path) ?? "{}";
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

/**
 * Database structure stored in JSON file
 */
interface DatabaseSchema {
  roles?: Record<string, RoleData>;
}

/**
 * File-based database implementation
 * Stores data in a JSON file with atomic read/write operations
 */
export class FileDB implements RoleDB {
  /**
   * Creates a new FileDB instance
   * @param dbPath - Path to the database JSON file (default: .data/db.json)
   * @param fs - File system implementation to use (default: RealFs)
   */
  constructor(
    private readonly dbPath: string = ".data/db.json",
    private readonly fs: Fs = new RealFs(),
  ) {}

  /**
   * Reads the database file atomically
   * @returns Promise resolving to the database schema
   */
  private async readDb(): Promise<DatabaseSchema> {
    const content = await this.fs.read(this.dbPath);
    try {
      return JSON.parse(content) as DatabaseSchema;
    } catch {
      return {};
    }
  }

  /**
   * Writes the database file atomically
   * @param db - Database schema to write
   * @returns Promise resolving when write completes
   */
  private async writeDb(db: DatabaseSchema): Promise<void> {
    const content = JSON.stringify(db, null, 2);
    await this.fs.write(this.dbPath, content);
  }

  async listRoles(): Promise<RoleData[]> {
    const db = await this.readDb();
    return Object.values(db.roles ?? {});
  }

  async getRole(roleId: string): Promise<RoleData | null> {
    const db = await this.readDb();
    return db.roles?.[roleId] ?? null;
  }

  async upsertRole(roleData: RoleData): Promise<void> {
    const db = await this.readDb();
    if (!db.roles) {
      db.roles = {};
    }
    db.roles[roleData.id] = roleData;
    await this.writeDb(db);
  }

  async deleteRole(roleId: string): Promise<boolean> {
    const db = await this.readDb();
    if (!db.roles || !db.roles[roleId]) {
      return false;
    }
    delete db.roles[roleId];
    await this.writeDb(db);
    return true;
  }
}
