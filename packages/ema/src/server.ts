import * as lancedb from "@lancedb/lancedb";

import { LLMClient } from "./llm";
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
  MongoMemorySearchAdaptor,
  LanceMemoryVectorSearcher,
} from "./db";
import { utilCollections } from "./db/mongo.util";
import type {
  RoleDB,
  ActorDB,
  UserDB,
  UserOwnActorDB,
  ConversationDB,
  ConversationMessageDB,
  ShortTermMemoryDB,
  LongTermMemoryDB,
  IndexableDB,
} from "./db/base";
import type { Fs } from "./fs";
import { RealFs } from "./fs";
import * as path from "node:path";
import { ActorWorker } from "./actor";

/**
 * The server class for the EverMemoryArchive.
 */
export class Server {
  actors: Map<string, ActorWorker> = new Map();
  private actorInFlight: Map<string, Promise<ActorWorker>> = new Map();

  config: Config;
  private llmClient: LLMClient;

  mongo!: Mongo;
  lancedb!: lancedb.Connection;

  roleDB!: RoleDB & MongoCollectionGetter;
  actorDB!: ActorDB & MongoCollectionGetter & IndexableDB;
  userDB!: UserDB & MongoCollectionGetter & IndexableDB;
  userOwnActorDB!: UserOwnActorDB & MongoCollectionGetter & IndexableDB;
  conversationDB!: ConversationDB & MongoCollectionGetter & IndexableDB;
  conversationMessageDB!: ConversationMessageDB &
    MongoCollectionGetter &
    IndexableDB;
  shortTermMemoryDB!: ShortTermMemoryDB & MongoCollectionGetter & IndexableDB;
  longTermMemoryDB!: LongTermMemoryDB & MongoCollectionGetter & IndexableDB;
  longTermMemoryVectorSearcher!: MongoMemorySearchAdaptor &
    MongoCollectionGetter;

  private constructor(
    private readonly fs: Fs,
    config: Config,
  ) {
    this.config = config;
    this.llmClient = new LLMClient(config.llm);
  }

  private actorKey(userId: number, actorId: number, conversationId: number) {
    return `${userId}:${actorId}:${conversationId}`;
  }

  static async create(
    fs: Fs = new RealFs(),
    config: Config = Config.load(),
  ): Promise<Server> {
    const isDev = ["development", "test"].includes(process.env.NODE_ENV || "");

    // Initialize MongoDB asynchronously
    const mongo = await createMongo(
      config.mongo.uri,
      config.mongo.db_name,
      config.mongo.kind,
    );
    await mongo.connect();

    const databaseDir = path.join(process.env.DATA_ROOT || ".data", "lancedb");
    const lance = await lancedb.connect(databaseDir);

    const server = Server.createSync(fs, mongo, lance, config);

    if (isDev) {
      const restored = await server.restoreFromSnapshot("default");
      if (!restored) {
        console.error("Failed to restore snapshot 'default'");
      } else {
        console.log("Snapshot 'default' restored");
      }
    }

    await Promise.all([
      server.actorDB.createIndices(),
      server.userDB.createIndices(),
      server.userOwnActorDB.createIndices(),
      server.conversationDB.createIndices(),
      server.conversationMessageDB.createIndices(),
      server.shortTermMemoryDB.createIndices(),
      server.longTermMemoryDB.createIndices(),
      server.longTermMemoryVectorSearcher.createIndices(),
    ]);

    return server;
  }

  /**
   * Creates a Server instance with a pre-configured MongoDB instance for testing.
   * @param fs - File system implementation
   * @param mongo - MongoDB instance
   * @param lance - LanceDB instance
   * @returns The Server instance
   */
  static createSync(
    fs: Fs,
    mongo: Mongo,
    lance: lancedb.Connection,
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
    server.longTermMemoryVectorSearcher = new LanceMemoryVectorSearcher(
      mongo,
      lance,
    );
    server.longTermMemoryDB = new MongoLongTermMemoryDB(mongo, [
      server.longTermMemoryVectorSearcher,
    ]);
    return server;
  }

  private snapshotPath(name: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(
        `Invalid snapshot name: ${name}. Only letters, numbers, underscores, and hyphens are allowed.`,
      );
    }

    const dataRoot = this.config.system.data_root;
    return `${dataRoot}/mongo-snapshots/${name}.json`;
  }

  /**
   * Takes a snapshot of the MongoDB database and writes it to a file.
   * @param name - The name of the snapshot
   * @returns The file name of the snapshot
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
      this.longTermMemoryVectorSearcher,
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
   * @returns True if the snapshot was restored, false if not found
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
   * @returns The logged-in user object.
   *
   * @example
   * // Example usage:
   * const user = await server.login();
   * console.log(user.id); // 1
   */
  async login(): Promise<{ id: number; name: string; email: string }> {
    const user = {
      id: 1,
      name: "alice",
      email: "alice@example.com",
    };
    const actor = {
      id: 1,
      roleId: 1,
    };
    await this.userDB.upsertUser({
      id: user.id,
      name: user.name,
      email: user.email,
      description: "",
      avatar: "",
    });
    await this.actorDB.upsertActor({
      id: actor.id,
      roleId: actor.roleId,
    });
    await this.userOwnActorDB.addActorToUser({
      userId: user.id,
      actorId: actor.id,
    });
    return user;
  }

  /**
   * Gets an actor by user ID, actor ID, and conversation ID.
   * @param userId - The user ID
   * @param actorId - The actor ID
   * @param conversationId - The conversation ID
   * @returns The actor
   */
  async getActor(
    userId: number,
    actorId: number,
    conversationId: number,
  ): Promise<ActorWorker> {
    // todo: use userId to authorize request.
    const key = this.actorKey(userId, actorId, conversationId);
    let actor = this.actors.get(key);
    if (!actor) {
      let inFlight = this.actorInFlight.get(key);
      if (!inFlight) {
        inFlight = (async () => {
          const user = await this.userDB.getUser(userId);
          const actorName = "EMA";
          const userName = user?.name || "User";
          await this.conversationDB.upsertConversation({
            id: conversationId,
            name: "default",
            actorId,
            userId,
          });
          const created = new ActorWorker(
            this.config,
            userId,
            userName,
            actorId,
            actorName,
            conversationId,
            this.actorDB,
            this.conversationMessageDB,
            this.shortTermMemoryDB,
            this.longTermMemoryDB,
            this.longTermMemoryVectorSearcher,
          );
          this.actors.set(key, created);
          return created;
        })();
        this.actorInFlight.set(key, inFlight);
      }
      try {
        actor = await inFlight;
      } finally {
        this.actorInFlight.delete(key);
      }
    }
    return actor;
  }

  /**
   * Handles chat requests and returns LLM responses.
   *
   * Exposed as `POST /api/roles/chat`.
   *
   * @param messages - Array of conversation messages
   * @returns The LLM response
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
    return response;
  }
}
