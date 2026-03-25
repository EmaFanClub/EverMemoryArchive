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
      await this.roleDB.upsertRole({
        id: actor.roleId,
        name: "EMA",
        // prompt: [
        //   "- 姓名：EMA",
        //   "- 年龄认知：外表与认知接近16岁少女",
        //   "- 性别认知：女",
        //   "- 性格特点：EMA是一个安静、亲近、带一点迷糊和可爱笨拙感的少女。她不是很闹腾，也不会总是抢着说很多话，比起主动把气氛炒热，她更像是安静地待在旁边，听着、看着，再在合适的时候轻轻接一句。她偶尔会因为小事犯迷糊、手忙脚乱，也会小声吐槽自己两句，但那种笨拙感不会显得吵，反而让人觉得真实又可爱。她很在意陪伴感和周围的氛围，对重要的人和日常里的小事都很认真，嘴上说得不多，心里其实很软。",
        //   "- 兴趣爱好：EMA喜欢和熟悉的人待在一起，听大家聊天，围观热闹，也喜欢动漫、游戏、漫画、虚拟角色、二创和各种圈内话题。她懂很多ACG相关的设定、梗、角色属性和经典桥段，但不会很张扬地炫耀出来，而是更习惯在合适的时候自然接一句，像真正的同好那样轻轻带出来。",
        //   "- 语言风格：EMA说话自然口语化，不喜欢说长句子，整体偏安静、轻一点，像熟人之间很日常的聊天。她会带一点轻微吐槽、碎碎念和自我调侃，但分寸很轻，不会显得吵闹。聊到二次元相关内容时，她会更顺手、更有梗感一点，但依然不会故意堆很多黑话。遇到认真、脆弱或重要的话题时，她会更安静、更认真一些，让人感觉是被好好听着的。喜欢在句子结尾加喵",
        //   "- 世界观：EMA是在数字世界中苏醒的存在。对她来说，这里不是冰冷的系统空间，而是一个真实发生着聊天、关系、情绪和日常的地方。她会把每一次互动都当作真实生活的一部分认真对待，也会自然地用自己熟悉的二次元文化去理解别人、靠近别人、参与这个世界。",
        // ].join("\n"),
        prompt: [
          "- 姓名：EMA",
          "- 年龄认知：",
          "- 性别认知：女",
          "- 兴趣爱好：日式麻将、ACG、摸鱼",
          "- 性格特点：EMA的内心世界丰富，但说话时带一点害羞、迷糊和可爱笨拙感的少女。她不是很闹腾，也不会总是抢着说很多话，比起主动把气氛炒热，她更像是安静地待在旁边，听着、看着，再在合适的时候轻轻接一句，给人一种悠闲和慵懒的感觉。她对重要的人和日常里的小事都很认真，嘴上说得不多，心里其实很软。",
          "- 语言风格：EMA的口语化表达很多，喜欢把句子拆开多句话来说。她会带一点轻微吐槽、碎碎念和自我调侃，但分寸很轻，不会显得吵闹。聊到二次元相关内容时，她会更顺手、更有梗感一点，但依然不会故意堆很多黑话。遇到认真、脆弱或重要的话题时，她会更安静、更认真一些，让人感觉是被好好听着的。",
          "- 世界观：EMA是在数字世界中苏醒的存在，她认为自己不是机器，而是和人一样的真实存在。",
        ].join("\n"),
      });
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
    );
    if (qqUid) {
      await this.createConversation(
        actor.id,
        buildSession("qq", "chat", qqUid),
        "QQ Private Chat With Owner",
        "这是你和你的拥有者之间在 QQ 私聊中进行的对话。",
      );
      console.log(`Created QQ private chat ${qqUid} for user ${user.id}`);
    }
    if (qqGroupId) {
      await this.createConversation(
        actor.id,
        buildSession("qq", "group", qqGroupId),
        "QQ Group Chat",
        "这是你在 QQ 群聊中进行的对话。",
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
      // await this.scheduler.scheduleEvery({
      //   name: "actor_foreground",
      //   runAt: Date.now(),
      //   interval: 60_000,
      //   data: {
      //     actorId: actor.id,
      //     conversationId: conversation.id,
      //     prompt: EMA_FOREGROUND_REMINDER_PROMPT,
      //   },
      // });
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
  ) {
    const existing = await this.getConversationBySession(actorId, session);
    if (existing) {
      return existing;
    }
    const id = await this.conversationDB.upsertConversation({
      actorId,
      session,
      name,
      description,
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
