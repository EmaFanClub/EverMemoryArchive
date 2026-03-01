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
import { AgendaScheduler } from "./scheduler";
import { createJobHandlers } from "./scheduler/jobs";
import { MemoryManager } from "./memory/manager";

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
  scheduler!: AgendaScheduler;
  memoryManager!: MemoryManager;

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
    server.scheduler = await AgendaScheduler.create(mongo);
    server.memoryManager = new MemoryManager(
      server.roleDB,
      server.actorDB,
      server.userDB,
      server.userOwnActorDB,
      server.conversationDB,
      server.conversationMessageDB,
      server.shortTermMemoryDB,
      server.longTermMemoryDB,
      server.longTermMemoryVectorSearcher,
      server.scheduler,
    );

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

    await server.scheduler.start(createJobHandlers(server));

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
    if (this.scheduler) {
      collections.add(this.scheduler.collectionName);
    }
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
        inFlight = this.createNewActor(userId, actorId, conversationId);
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

  private async createNewActor(
    userId: number,
    actorId: number,
    conversationId: number,
  ): Promise<ActorWorker> {
    await this.conversationDB.upsertConversation({
      id: conversationId,
      name: "default",
      actorId,
      userId,
    });
    const created = new ActorWorker(
      this.config,
      userId,
      actorId,
      conversationId,
      this,
    );
    this.actors.set(this.actorKey(userId, actorId, conversationId), created);
    const prompt = [
      "<task>",
      "这是一个由定时任务触发的记忆更新任务：每天 0 点执行。你的目标是更新周记(Week)，并在满足条件时连带更新月记(Month)与年记(Year)。",
      "</task>",
      "",
      "<instructions>",
      "1) 调用 get_skill 读取技能说明，并严格按其要求执行。",
      "2) 基于当前已有的短期记忆（Day/Week/Month/Year）和对话历史（Recent Conversation，如有），生成更新后的周记(Week)内容。",
      "3) 更新完周记后，检查当前日期：",
      "   - 如果今天是周一：在保持周记已更新的基础上，进一步生成并更新月记(Month)。",
      "   - 如果今天是 1 号：在保持周记（以及可能的月记）已更新的基础上，进一步生成并更新年记(Year)。",
      "4) 每次生成记忆都必须是“全量新版本”（覆盖旧记忆），不要只写新增/追加部分。",
      "5) 这是一个后台任务。更新完成后不要产生任何额外的回复和输出。",
      "</instructions>",
      "",
      "<constraints>",
      "- 必须先更新 Week，再按条件更新 Month、Year；不得跳过 Week 直接更新 Month/Year。",
      "- 仅允许更新 Week / Month / Year，不得修改 Day。",
      "- 不得编造不存在于短期记忆或对话历史中的事实；如缺少信息应保持模糊而非杜撰。",
      "- 若对话历史为空或信息不足，允许更多依赖已有短期记忆进行归纳，但不得虚构细节。",
      "</constraints>",
    ].join("\n");
    this.scheduler.scheduleEvery({
      name: "actor_background",
      runAt: Date.now(),
      interval: "0 0 * * *", // every day at midnight
      data: {
        actorScope: {
          userId,
          actorId,
          conversationId,
        },
        prompt: prompt,
      },
    });
    this.scheduler.scheduleEvery({
      name: "actor_foreground",
      runAt: Date.now(),
      interval: 60_000, // every 60 seconds
      data: {
        actorScope: {
          userId,
          actorId,
          conversationId,
        },
        prompt:
          "系统提示：考虑是否要主动向用户对话。如果最近一条用户消息距现在不足 60 秒，请无视此提示。否则参考下面的规则：" +
          "1. 请根考虑当前对话历史分析对话语境、消息间隔等，尤其需要考虑上一条消息的时间，综合判断是否要主动和用户说话。需要时可以读取长期记忆。" +
          "2. 如果你决定不和用户说话，调用 `ema_reply` 工具输出空字符串即可（可以有心理活动）。" +
          "3. 如果你决定要主动和用户说话，考虑好内容后，调用 `ema_reply` 工具进行对话。" +
          "4. 这条提示是定时产生的，与用户无关，不要在对话和记忆中提及它。",
      },
    });
    return created;
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
