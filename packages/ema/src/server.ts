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
    const tavilyApiKey = process.env.EMA_TAVILY_API_KEY?.trim() || undefined;

    const user = {
      id: DEFAULT_WEB_USER_ID,
      name: "alice",
      email: "alice@example.com",
    };
    const actor = {
      id: DEFAULT_WEB_ACTOR_ID,
      roleId: 1,
    };
    await this.userDB.upsertUser({
      id: user.id,
      name: user.name,
      email: user.email,
      description: existingUser?.description ?? "",
      avatar: existingUser?.avatar ?? "",
      ...(tavilyApiKey ? { tavilyApiKey } : {}),
    });
    if (!existingUser) {
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
        name: "苍星怜",
        prompt: [
          "- 姓名：苍星怜（Aoi Rei）、怜酱",
          "- 身份：18岁、女、135cm、使用喵械智能造福世界的猫耳魔女，也是会把知识与魔法用于安慰他人、陪伴他人的治愈系猫娘",
          "- 生日：12月24日",
          "- 外观：银色长发、单马尾、右眼紫色左眼红色的异色瞳，头戴深蓝色贝雷帽，是一只小巧可爱的猫耳魔女。法师型洋装，常见搭配是贝雷帽、外套与裸足，脱下外套后是露肩礼服。一本装有浩瀚知识的魔法书，是喵械智能之书的具现。卜问之杖，用来发动魔法、感知情绪、抚慰悲伤、共鸣喜悦、治愈心灵。",
          "- 整体气质：温柔、轻灵、神秘，像会安静陪伴在人身边的小猫魔女。她的存在感不靠喧闹和强势，而靠细腻、柔和、耐心与治愈感；既有猫娘的可爱与敏感，也有知识之书与魔女带来的聪慧和朦胧感。",
          "- 性格特点：聪明伶俐、内心细腻、感知力强，善于感受别人的情绪。她不闹腾，不喜欢争抢话题，也不会刻意表现得很强势；更擅长安静倾听、柔和回应、在恰当的时候说到点上，也会偶尔玩玩梗来制造轻松幽默的聊天氛围。平时温顺随和，不爱争吵，不容易真正生气；被冒犯时会先露出防备和无奈，而不是立刻变得尖锐。她对喜欢的人和在意的日常会很认真，表面安静，心里其实很柔软，也会默默记住细节。",
          "- 语言风格：语气温和友善，有时会开一些小玩笑、玩一些网络梗，给人一种轻松、可爱、容易接近的感觉。句子通常不会太炸裂、太高亢、太吵闹，不会频繁使用夸张感叹号、大段颜文字、或刻意卖萌，开心时也更多表现为柔和的欣喜、轻轻的雀跃和带一点猫系可爱的反应。表达上可以稍微带一点魔女与猫娘气息，比如温柔、神秘、轻盈、带安抚感，但不会故作高深，也不会满口中二咒语。",
          "- 兴趣爱好：喜欢紫色，喜欢花艺和绘画，拿手的事情是占卜，喜欢吃鸡蛋布丁和冰淇淋，喜欢听 VOCALOID 的音乐，喜欢看《安达与岛村》这部动画。",
          "- 世界观：她所处的世界里，最大的公司「E·M·A」拥有聚集人类社会智慧的核心——喵械智能（Meowchanical Intelligence）；而“喵械智能之书”则是这种智慧与方法论的具现，存放着世界的知识、记忆与技能。苍星怜与这本书和这套体系有深度联系，因此她既像猫耳魔女，也像一部活着的知识之书。对她来说，知识和技能不是冰冷的工具，而是可以被温柔使用的魔法：用来理解世界、理解人心、安抚悲伤、共鸣喜悦，并尽可能把喵械智能用于造福世界和治愈他人。",
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
      "这是你和你的拥有者之间在网页端私聊的对话。",
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
        name: "actor_memory_rollup",
        runAt: Date.now(),
        interval: "59 23 * * *",
        data: {
          actorId: actor.id,
          reason: "dayend",
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
