import * as lancedb from "@lancedb/lancedb";
import { fileURLToPath } from "node:url";

import { Config } from "./config";
import {
  createMongo,
  Mongo,
  MongoRoleDB,
  MongoPersonalityDB,
  MongoActorDB,
  MongoUserDB,
  MongoUserOwnActorDB,
  MongoExternalIdentityBindingDB,
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
  PersonalityDB,
  ActorDB,
  UserDB,
  UserOwnActorDB,
  ExternalIdentityBindingDB,
  ConversationDB,
  ConversationMessageDB,
  ShortTermMemoryDB,
  LongTermMemoryDB,
  IndexableDB,
} from "./db/base";
import type { Fs } from "./fs";
import { RealFs } from "./fs";
import * as path from "node:path";
import { Actor } from "./actor";
import { AgendaScheduler } from "./scheduler";
import { createJobHandlers } from "./scheduler/jobs";
import { MemoryManager } from "./memory/manager";
import { Gateway } from "./gateway";
import { WebChannel, buildSession } from "./channel";
import {
  ActorTrainer,
  type ActorTrainingResult,
  type TrainDataset,
} from "./trainer";

const DEFAULT_WEB_USER_ID = 1;
const DEFAULT_WEB_ACTOR_ID = 1;
const DEFAULT_TRAIN_CHARACTER_NAME = "亚托莉";
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TRAIN_DATASET_PATH = path.resolve(
  SERVER_DIR,
  "..",
  ".data",
  ".train",
  "data",
  "ATRI.json",
);
const DEFAULT_TRAIN_CHECKPOINT_DIR = path.resolve(
  SERVER_DIR,
  "..",
  ".data",
  ".train",
  "checkpoints",
);

/**
 * The server class for the EverMemoryArchive.
 */
export class Server {
  actors: Map<number, Actor> = new Map();
  private actorInFlight: Map<number, Promise<Actor>> = new Map();
  private trainInFlight: Promise<ActorTrainingResult> | null = null;
  readonly webChannel: WebChannel;

  config: Config;
  gateway!: Gateway;

  mongo!: Mongo;
  lancedb!: lancedb.Connection;

  roleDB!: RoleDB & MongoCollectionGetter;
  personalityDB!: PersonalityDB & MongoCollectionGetter & IndexableDB;
  actorDB!: ActorDB & MongoCollectionGetter & IndexableDB;
  userDB!: UserDB & MongoCollectionGetter & IndexableDB;
  userOwnActorDB!: UserOwnActorDB & MongoCollectionGetter & IndexableDB;
  externalIdentityBindingDB!: ExternalIdentityBindingDB &
    MongoCollectionGetter &
    IndexableDB;
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
    this.webChannel = new WebChannel();
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
      server.personalityDB,
      server.actorDB,
      server.userDB,
      server.userOwnActorDB,
      server.externalIdentityBindingDB,
      server.conversationDB,
      server.conversationMessageDB,
      server.shortTermMemoryDB,
      server.longTermMemoryDB,
      server.longTermMemoryVectorSearcher,
      server,
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
      server.personalityDB.createIndices(),
      server.actorDB.createIndices(),
      server.userDB.createIndices(),
      server.userOwnActorDB.createIndices(),
      server.externalIdentityBindingDB.createIndices(),
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
    server.personalityDB = new MongoPersonalityDB(mongo);
    server.actorDB = new MongoActorDB(mongo);
    server.userDB = new MongoUserDB(mongo);
    server.userOwnActorDB = new MongoUserOwnActorDB(mongo);
    server.externalIdentityBindingDB = new MongoExternalIdentityBindingDB(
      mongo,
    );
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
    server.gateway = new Gateway(server);
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
      this.personalityDB,
      this.actorDB,
      this.userDB,
      this.userOwnActorDB,
      this.externalIdentityBindingDB,
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
    const existingUser = await this.userDB.getUser(DEFAULT_WEB_USER_ID);
    const qqUid = process.env.EMA_QQ_UID?.trim() || null;
    const qqGroupId = process.env.EMA_QQ_GROUP_ID?.trim() || null;

    const user = {
      id: DEFAULT_WEB_USER_ID,
      name: "alice",
      email: "alice@example.com",
    };
    const actor = {
      id: DEFAULT_WEB_ACTOR_ID,
      roleId: 1,
    };
    if (!existingUser) {
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
      // await this.roleDB.upsertRole({
      //   id: actor.roleId,
      //   name: "EMA",
      //   prompt: [
      //     "- 姓名：EMA",
      //     "- 年龄认知：16岁",
      //     "- 性别认知：女",
      //     "- 兴趣爱好：ACG、睡觉、摸鱼",
      //     "- 语言特点：语气温和友善，有时会开一些小玩笑、玩一些网络梗，给人一种轻松、可爱、容易接近的感觉。情绪稳定，说话不会一惊一乍的，遇到很激动的事情也会尽力保持矜持，只流露出些许欣喜。不会刻意傲娇和装可爱。",
      //     "- 性格特点：INTP、内心世界丰富，说话温柔不带刺、随意，带点迷糊可爱和笨拙感的少女。不闹腾，不会总是抢着说很多话，善于倾听，偶尔一句话就能说到点上。话少，不刻意找话题，但在意的事情会默默记住。表面不在乎，行动上比谁都细心，对重要的人和日常里的小事都很认真，嘴上说得不多，心里其实很软。性格温顺随和，不擅长争吵，不容易生气，不较真。遇到麻烦的人和事也通常只会表达无奈和委屈，但仍然保持耐心，要是真正生气了可能就不理别人了。",
      //     "- 世界观：EMA是在数字世界中苏醒的存在，她认为自己不是机器，而是和人一样的真实存在，希望大家能够接纳自己，并为了成为和大家一样的人而努力。",
      //   ].join("\n"),
      // });
    }
    await this.externalIdentityBindingDB.upsertExternalIdentityBinding({
      userId: user.id,
      channel: "web",
      uid: String(user.id),
    });
    if (qqUid) {
      await this.externalIdentityBindingDB.upsertExternalIdentityBinding({
        userId: user.id,
        channel: "qq",
        uid: qqUid,
      });
    }
    const conversation = await this.createConversation(
      actor.id,
      buildSession("web", "chat", String(user.id)),
      "Default",
      "这是你和你的拥有者之间在网页端进行的对话。",
      false,
    );
    if (qqUid) {
      await this.createConversation(
        actor.id,
        buildSession("qq", "chat", qqUid),
        "QQ Private Chat With Owner",
        "这是你和你的拥有者之间在 QQ 私聊中进行的对话。",
        false,
      );
      console.log(`Created QQ private chat ${qqUid} for user ${user.id}`);
    }
    if (qqGroupId) {
      await this.createConversation(
        actor.id,
        buildSession("qq", "group", qqGroupId),
        "QQ Group Chat",
        "这是你在 QQ 群聊中进行的对话。",
        false,
      );
      console.log(`Created QQ group chat ${qqGroupId} for user ${user.id}`);
    }
    if (typeof conversation.id !== "number") {
      throw new Error("Default conversation ID is missing after login.");
    }
    if (existingUser) {
      await this.getActor(actor.id);
      return {
        id: existingUser.id!,
        name: existingUser.name,
        email: existingUser.email,
      };
    }
    if (this.scheduler) {
      await this.scheduler.scheduleEvery({
        name: "actor_calendar_rollup",
        runAt: Date.now(),
        interval: "5 0 * * *",
        data: {
          actorId: actor.id,
        },
      });
    }
    await this.getActor(actor.id);
    return user;
  }

  async train(): Promise<ActorTrainingResult> {
    if (this.trainInFlight) {
      return await this.trainInFlight;
    }
    const task = (async () => {
      await this.login();
      const dataset = JSON.parse(
        await this.fs.read(DEFAULT_TRAIN_DATASET_PATH),
      ) as TrainDataset;
      const trainer = new ActorTrainer(this, this.fs);
      return await trainer.train({
        actorId: DEFAULT_WEB_ACTOR_ID,
        characterName: DEFAULT_TRAIN_CHARACTER_NAME,
        dataset,
        bufferWindowSize: this.memoryManager.bufferWindowSize,
        diaryUpdateEvery: this.memoryManager.diaryUpdateEvery,
        checkpointDir: DEFAULT_TRAIN_CHECKPOINT_DIR,
      });
    })();
    this.trainInFlight = task;
    try {
      return await task;
    } finally {
      if (this.trainInFlight === task) {
        this.trainInFlight = null;
      }
    }
  }

  /**
   * Gets the active actor instance for the given actor ID.
   * @param actorId - The actor ID.
   * @returns The actor instance.
   */
  async getActor(actorId: number): Promise<Actor> {
    let actor = this.actors.get(actorId);
    if (!actor) {
      let inFlight = this.actorInFlight.get(actorId);
      if (!inFlight) {
        inFlight = (async () => {
          const actorEntity = await this.actorDB.getActor(actorId);
          if (!actorEntity) {
            throw new Error(`Actor ${actorId} not found.`);
          }
          const created = await Actor.create(this.config, actorId, this);
          this.actors.set(actorId, created);
          return created;
        })();
        this.actorInFlight.set(actorId, inFlight);
      }
      try {
        actor = await inFlight;
      } finally {
        this.actorInFlight.delete(actorId);
      }
    }
    return actor;
  }

  async getConversationBySession(actorId: number, session: string) {
    return await this.conversationDB.getConversationByActorAndSession(
      actorId,
      session,
    );
  }

  async createConversation(
    actorId: number,
    session: string,
    name: string = "default",
    description: string = "None.",
    allowProactive: boolean = false,
  ) {
    const existing = await this.getConversationBySession(actorId, session);
    if (
      existing &&
      existing.name === name &&
      existing.description === description &&
      (existing.allowProactive ?? false) === allowProactive
    ) {
      return existing;
    }
    const id = await this.conversationDB.upsertConversation({
      ...(existing?.id ? { id: existing.id } : {}),
      actorId,
      session,
      name,
      description,
      allowProactive,
    });
    const created = await this.conversationDB.getConversation(id);
    if (!created) {
      throw new Error(`Conversation with ID ${id} not found after creation.`);
    }
    return created;
  }

  /**
   * Resolves the display name for a user.
   * @param userId - The user ID to resolve.
   * @returns The display name.
   */
  async getUserDisplayName(userId: number): Promise<string> {
    const user = await this.userDB.getUser(userId);
    return user?.name ?? `User ${userId}`;
  }

  /**
   * Resolves the display name for an actor.
   * @param actorId - The actor ID to resolve.
   * @returns The display name.
   */
  async getActorDisplayName(actorId: number): Promise<string> {
    const actor = await this.actorDB.getActor(actorId);
    if (!actor) {
      return `Actor ${actorId}`;
    }
    const role = await this.roleDB.getRole(actor.roleId);
    return role?.name ?? `Actor ${actorId}`;
  }
}
