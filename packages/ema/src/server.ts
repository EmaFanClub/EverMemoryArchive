import { OpenAIClient } from "./llm/openai_client";
import type { Message } from "./schema";
import {
  createMongo,
  Mongo,
  MongoRoleDB,
  type MongoCollectionGetter,
} from "./db";
import type { RoleData, RoleDB } from "./db/base";
import type { Fs } from "./fs";
import { RealFs } from "./fs";

/**
 * The server class for the EverMindAgent.
 * todo: document what specific env are read.
 * todo: read all of the env in config.ts
 */
export class Server {
  private llmClient: OpenAIClient;
  private mongo!: Mongo;
  private roleDB!: RoleDB & MongoCollectionGetter;
  private fs: Fs;

  private constructor() {
    this.fs = new RealFs();

    // Initialize OpenAI client with environment variables or defaults
    const apiKey =
      process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || "";
    const apiBase =
      process.env.OPENAI_API_BASE ||
      process.env.GEMINI_API_BASE ||
      "https://generativelanguage.googleapis.com/v1beta/openai/";
    const model =
      process.env.OPENAI_MODEL ||
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash";
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY or GEMINI_API_KEY env is not set");
    }

    this.llmClient = new OpenAIClient(apiKey, apiBase, model);
  }

  static async create(): Promise<Server> {
    const isDev = process.env.NODE_ENV === "development";

    const server = new Server();

    // Initialize MongoDB asynchronously
    // Use environment variables or defaults for MongoDB connection
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017";
    const mongoDbName = process.env.MONGO_DB_NAME || "ema";
    const mongoKind =
      (process.env.MONGO_KIND as "memory" | "remote") ||
      (isDev ? "memory" : "remote");

    await server.initializeDb(mongoUri, mongoDbName, mongoKind);

    if (isDev) {
      const restored = await server.restoreFromSnapshot("default");
      if (!restored) {
        console.error("Failed to restore snapshot 'default'");
      } else {
        console.log("Snapshot 'default' restored");
      }
    }

    return server;
  }

  /**
   * Initializes the MongoDB connection
   * @param uri - MongoDB connection string
   * @param dbName - MongoDB database name
   * @param kind - MongoDB implementation kind (memory or remote)
   */
  private async initializeDb(
    uri: string,
    dbName: string,
    kind: "memory" | "remote",
  ): Promise<void> {
    this.mongo = await createMongo(uri, dbName, kind);
    await this.mongo.connect();
    this.roleDB = new MongoRoleDB(this.mongo);
  }

  private snapshotPath(name: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(
        `Invalid snapshot name: ${name}. Only letters, numbers, underscores, and hyphens are allowed.`,
      );
    }

    return `.data/mongo-snapshots/${name}.json`;
  }

  /**
   * Takes a snapshot of the MongoDB database and writes it to a file.
   * @param name - The name of the snapshot
   * @returns Promise<{ fileName: string }> The file name of the snapshot
   */
  async snapshot(name: string): Promise<{ fileName: string }> {
    const fileName = this.snapshotPath(name);
    const snapshot = await this.mongo.snapshot([this.roleDB]);
    await this.fs.write(fileName, JSON.stringify(snapshot, null, 1));
    return {
      fileName,
    };
  }

  /**
   * Restores the MongoDB database from the snapshot file.
   * @param name - The name of the snapshot
   * @returns Promise<boolean> True if the snapshot was restored, false if not found
   */
  async restoreFromSnapshot(name: string): Promise<boolean> {
    const fileName = this.snapshotPath(name);
    if (!(await this.fs.exists(fileName))) {
      return false;
    }
    const snapshot = await this.fs.read(fileName);
    await this.mongo.restoreFromSnapshot(JSON.parse(snapshot));
    return true;
  }

  /**
   * Handles user login and returns a user object.
   *
   * Exposed as `GET /api/users/login`.
   *
   * @returns {{ id: number, name: string, email: string }} The logged-in user object.
   *
   * @example
   * // Example usage:
   * const user = server.login();
   * console.log(user.id); // 1
   */
  login() {
    return {
      id: 1,
      name: "alice",
      email: "alice@example.com",
    };
  }

  /**
   * Handles chat requests and returns LLM responses.
   *
   * Exposed as `POST /api/roles/chat`.
   *
   * @param messages - Array of conversation messages
   * @returns Promise<{ content: string, thinking?: string }> The LLM response
   *
   * @example
   * // Example usage:
   * const response = await server.chat([
   *   { role: "system", content: "You are a helpful assistant." },
   *   { role: "user", content: "Hello!" }
   * ]);
   * console.log(response.content);
   */
  async chat(messages: Message[]) {
    const response = await this.llmClient.generate(messages);
    return {
      content: response.content,
      thinking: response.thinking,
    };
  }

  /**
   * Lists all roles.
   *
   * Exposed as `GET /api/roles/list`.
   *
   * @returns Promise<RoleData[]> Array of all roles
   *
   * @example
   * // Example usage:
   * const roles = await server.listRoles();
   * console.log(roles);
   */
  async listRoles(): Promise<RoleData[]> {
    return this.roleDB.listRoles();
  }

  /**
   * Gets a specific role by ID.
   *
   * Exposed as `GET /api/roles?id={roleId}`.
   *
   * @param roleId - The unique identifier for the role
   * @returns Promise<RoleData | null> The role data or null if not found
   *
   * @example
   * // Example usage:
   * const role = await server.getRole("role1");
   * console.log(role);
   */
  async getRole(roleId: number): Promise<RoleData | null> {
    return this.roleDB.getRole(roleId);
  }

  /**
   * Creates or updates a role.
   *
   * Exposed as `POST /api/roles` for create and `PUT /api/roles` for update.
   *
   * @param roleData - The role data to create or update
   * @returns Promise<string> The ID of the created or updated role
   *
   * @example
   * // Example usage:
   * await server.upsertRole({ id: "role1", name: "Test Role", description: "A test role" });
   */
  async upsertRole(roleData: RoleData): Promise<number> {
    // Set createTime if not provided (for new roles)
    if (!roleData.createTime) {
      roleData.createTime = Date.now();
    }
    return this.roleDB.upsertRole(roleData);
  }

  /**
   * Deletes a role (soft delete).
   *
   * Exposed as `DELETE /api/roles`.
   *
   * @param roleId - The unique identifier for the role to delete
   * @returns Promise<boolean> True if deleted, false if not found
   *
   * @example
   * // Example usage:
   * const deleted = await server.deleteRole("role1");
   * console.log(deleted);
   */
  async deleteRole(roleId: number): Promise<boolean> {
    return this.roleDB.deleteRole(roleId);
  }
}
