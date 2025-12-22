import { OpenAIClient } from "./llm/openai_client";
import { Config } from "./config";
import type { Message } from "./schema";
import {
  createMongo,
  Mongo,
  MongoRoleDB,
  MongoActorDB,
  MongoUserDB,
  MongoUserOwnActorDB,
  MongoConversationDB,
  MongoConversationMessageDB,
  MongoShortTermMemoryDB,
  MongoLongTermMemoryDB,
  type MongoCollectionGetter,
} from "./db";
import { utilCollections } from "./db/mongo.util";
import type {
  RoleEntity,
  RoleDB,
  ActorDB,
  UserDB,
  UserOwnActorDB,
  ConversationDB,
  ConversationMessageDB,
  ShortTermMemoryDB,
  LongTermMemoryDB,
} from "./db/base";
import type { Fs } from "./fs";
import { RealFs } from "./fs";

/**
 * The server class for the EverMemoryArchive.
 */
export class Server {
  config: Config;
  private llmClient: OpenAIClient;
  mongo!: Mongo;
  roleDB!: RoleDB & MongoCollectionGetter;
  actorDB!: ActorDB & MongoCollectionGetter;
  userDB!: UserDB & MongoCollectionGetter;
  userOwnActorDB!: UserOwnActorDB & MongoCollectionGetter;
  conversationDB!: ConversationDB & MongoCollectionGetter;
  conversationMessageDB!: ConversationMessageDB & MongoCollectionGetter;
  shortTermMemoryDB!: ShortTermMemoryDB & MongoCollectionGetter;
  longTermMemoryDB!: LongTermMemoryDB & MongoCollectionGetter;

  private constructor(
    private readonly fs: Fs,
    config: Config,
  ) {
    this.config = config;
    const { apiKey, apiBase, model, retry } = config.llm;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY or GEMINI_API_KEY env is not set");
    }

    this.llmClient = new OpenAIClient(
      apiKey,
      apiBase,
      model,
      retry,
      config.system.httpsProxy,
    );
  }

  static async create(
    fs: Fs = new RealFs(),
    config: Config = Config.load(),
  ): Promise<Server> {
    const isDev = ["development", "test"].includes(process.env.NODE_ENV || "");

    // Initialize MongoDB asynchronously
    const mongo = await createMongo(
      config.mongo.uri,
      config.mongo.dbName,
      config.mongo.kind,
    );
    await mongo.connect();

    const server = Server.createWithMongo(fs, mongo, config);

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
   * Creates a Server instance with a pre-configured MongoDB instance for testing.
   * @param fs - File system implementation
   * @param mongo - MongoDB instance
   * @returns Promise resolving to the Server instance
   */
  static createWithMongo(
    fs: Fs,
    mongo: Mongo,
    config: Config = Config.load(),
  ): Server {
    const server = new Server(fs, config);
    server.mongo = mongo;
    server.roleDB = new MongoRoleDB(mongo);
    server.actorDB = new MongoActorDB(mongo);
    server.userDB = new MongoUserDB(mongo);
    server.userOwnActorDB = new MongoUserOwnActorDB(mongo);
    server.conversationDB = new MongoConversationDB(mongo);
    server.conversationMessageDB = new MongoConversationMessageDB(mongo);
    server.shortTermMemoryDB = new MongoShortTermMemoryDB(mongo);
    server.longTermMemoryDB = new MongoLongTermMemoryDB(mongo);
    return server;
  }

  private snapshotPath(name: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(
        `Invalid snapshot name: ${name}. Only letters, numbers, underscores, and hyphens are allowed.`,
      );
    }

    const dataRoot = this.config.system.dataRoot;
    return `${dataRoot}/mongo-snapshots/${name}.json`;
  }

  /**
   * Takes a snapshot of the MongoDB database and writes it to a file.
   * @param name - The name of the snapshot
   * @returns Promise<{ fileName: string }> The file name of the snapshot
   */
  async snapshot(name: string): Promise<{ fileName: string }> {
    const fileName = this.snapshotPath(name);

    const dbs = [
      utilCollections,
      this.roleDB,
      this.actorDB,
      this.userDB,
      this.userOwnActorDB,
      this.conversationDB,
      this.conversationMessageDB,
      this.shortTermMemoryDB,
      this.longTermMemoryDB,
    ];
    const collections = new Set<string>(dbs.flatMap((db) => db.collections));

    const snapshot = await this.mongo.snapshot(Array.from(collections));
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
}
