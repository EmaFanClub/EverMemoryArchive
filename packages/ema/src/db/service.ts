import * as lancedb from "@lancedb/lancedb";
import * as path from "node:path";
import { BSON } from "mongodb";

import {
  cloneConfig,
  DEFAULT_CHANNEL_CONFIG,
  DEFAULT_WEB_SEARCH_CONFIG,
  GlobalConfig,
  type ChannelConfig,
  type LLMConfig,
  type WebSearchConfig,
} from "../config/index";
import type { Fs } from "../fs";
import type {
  ActorDB,
  ConversationDB,
  ConversationMessageDB,
  ExternalIdentityBindingDB,
  LongTermMemoryDB,
  PersonalityDB,
  RoleDB,
  ShortTermMemoryDB,
  UserDB,
  UserOwnActorDB,
} from "./base";
import type { Mongo } from "./mongo";
import { createMongo } from "./mongo";
import { utilCollections } from "./mongo/utils";
import {
  LanceMemoryVectorSearcher,
  MongoActorDB,
  MongoConversationDB,
  MongoConversationMessageDB,
  MongoExternalIdentityBindingDB,
  MongoLongTermMemoryDB,
  MongoPersonalityDB,
  MongoRoleDB,
  MongoShortTermMemoryDB,
  MongoUserDB,
  MongoUserOwnActorDB,
} from "./drivers";

const DEFAULT_WEB_USER_ID = 1;

/**
 * Centralized database service aggregating all repositories and DB-related helpers.
 */
export class DBService {
  readonly roleDB: RoleDB & { collections: string[] };
  readonly personalityDB: PersonalityDB & {
    collections: string[];
    createIndices(): Promise<void>;
  };
  readonly actorDB: ActorDB & {
    collections: string[];
    createIndices(): Promise<void>;
  };
  readonly userDB: UserDB & {
    collections: string[];
    createIndices(): Promise<void>;
  };
  readonly userOwnActorDB: UserOwnActorDB & {
    collections: string[];
    createIndices(): Promise<void>;
  };
  readonly externalIdentityBindingDB: ExternalIdentityBindingDB & {
    collections: string[];
    createIndices(): Promise<void>;
  };
  readonly conversationDB: ConversationDB & {
    collections: string[];
    createIndices(): Promise<void>;
  };
  readonly conversationMessageDB: ConversationMessageDB & {
    collections: string[];
    createIndices(): Promise<void>;
  };
  readonly shortTermMemoryDB: ShortTermMemoryDB & {
    collections: string[];
    createIndices(): Promise<void>;
  };
  readonly longTermMemoryDB: LongTermMemoryDB & {
    collections: string[];
    createIndices(): Promise<void>;
  };
  readonly longTermMemoryVectorSearcher: LanceMemoryVectorSearcher;

  /**
   * Creates a DB service from config by connecting Mongo and LanceDB.
   */
  static async create(fs: Fs): Promise<DBService> {
    const mongo = await createMongo(
      GlobalConfig.mongo.uri,
      GlobalConfig.mongo.dbName,
      GlobalConfig.mongo.kind,
    );
    await mongo.connect();

    const databaseDir = path.join(GlobalConfig.system.dataRoot, "lancedb");
    const lance = await lancedb.connect(databaseDir);
    return DBService.createSync(fs, mongo, lance);
  }

  /**
   * Creates a DB service from existing database resources.
   */
  static createSync(
    fs: Fs,
    mongo: Mongo,
    lancedbConnection: lancedb.Connection,
  ): DBService {
    return new DBService(fs, mongo, lancedbConnection);
  }

  private constructor(
    private readonly fs: Fs,
    readonly mongo: Mongo,
    readonly lancedb: lancedb.Connection,
  ) {
    this.roleDB = new MongoRoleDB(mongo);
    this.personalityDB = new MongoPersonalityDB(mongo);
    this.actorDB = new MongoActorDB(mongo);
    this.userDB = new MongoUserDB(mongo);
    this.userOwnActorDB = new MongoUserOwnActorDB(mongo);
    this.externalIdentityBindingDB = new MongoExternalIdentityBindingDB(mongo);
    this.conversationDB = new MongoConversationDB(mongo);
    this.conversationMessageDB = new MongoConversationMessageDB(mongo);
    this.shortTermMemoryDB = new MongoShortTermMemoryDB(mongo);
    this.longTermMemoryVectorSearcher = new LanceMemoryVectorSearcher(
      mongo,
      lancedb,
    );
    this.longTermMemoryDB = new MongoLongTermMemoryDB(mongo, [
      this.longTermMemoryVectorSearcher,
    ]);
  }

  /**
   * Creates indices for all managed repositories that define them.
   */
  async createIndices(): Promise<void> {
    await Promise.all([
      this.personalityDB.createIndices(),
      this.actorDB.createIndices(),
      this.userDB.createIndices(),
      this.userOwnActorDB.createIndices(),
      this.externalIdentityBindingDB.createIndices(),
      this.conversationDB.createIndices(),
      this.conversationMessageDB.createIndices(),
      this.shortTermMemoryDB.createIndices(),
      this.longTermMemoryDB.createIndices(),
      this.longTermMemoryVectorSearcher.createIndices(),
    ]);
  }

  /**
   * Takes a snapshot of all managed DB collections and writes it to disk.
   */
  async snapshot(
    name: string,
    extraCollections: string[] = [],
  ): Promise<{ fileName: string }> {
    const fileName = this.snapshotPath(name);
    const collections = new Set<string>([
      ...utilCollections.collections,
      ...this.roleDB.collections,
      ...this.personalityDB.collections,
      ...this.actorDB.collections,
      ...this.userDB.collections,
      ...this.userOwnActorDB.collections,
      ...this.externalIdentityBindingDB.collections,
      ...this.conversationDB.collections,
      ...this.conversationMessageDB.collections,
      ...this.shortTermMemoryDB.collections,
      ...this.longTermMemoryDB.collections,
      ...this.longTermMemoryVectorSearcher.collections,
      ...extraCollections,
    ]);
    const snapshot = await this.mongo.snapshot(Array.from(collections));
    await this.fs.write(
      fileName,
      BSON.EJSON.stringify(snapshot, { relaxed: false }, 1),
    );
    return { fileName };
  }

  /**
   * Restores a named snapshot from disk into MongoDB.
   */
  async restoreFromSnapshot(name: string): Promise<boolean> {
    const fileName = this.snapshotPath(name);
    if (!(await this.fs.exists(fileName))) {
      return false;
    }
    const snapshot = await this.fs.read(fileName);
    await this.mongo.restoreFromSnapshot(BSON.EJSON.parse(snapshot));
    return true;
  }

  /**
   * Resolves one actor conversation by session string.
   */
  async getConversationBySession(actorId: number, session: string) {
    return this.conversationDB.getConversationByActorAndSession(
      actorId,
      session,
    );
  }

  /**
   * Creates or reuses one actor-owned conversation.
   */
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
   * Gets the default web user profile when present.
   */
  async getDefaultUser(): Promise<{
    id: number;
    name: string;
    email: string;
  } | null> {
    const user = await this.userDB.getUser(DEFAULT_WEB_USER_ID);
    if (!user || typeof user.id !== "number") {
      return null;
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
    };
  }

  /**
   * Resolves the display name for one user.
   */
  async getUserDisplayName(userId: number): Promise<string> {
    const user = await this.userDB.getUser(userId);
    return user?.name ?? `User ${userId}`;
  }

  /**
   * Resolves the display name for one actor.
   */
  async getActorDisplayName(actorId: number): Promise<string> {
    const actor = await this.actorDB.getActor(actorId);
    if (!actor) {
      return `Actor ${actorId}`;
    }
    const role = await this.roleDB.getRole(actor.roleId);
    return role?.name ?? `Actor ${actorId}`;
  }

  /**
   * Gets the complete LLM config for one actor.
   * @param actorId - Actor identifier.
   * @returns Actor-specific LLM config, or the global default.
   */
  async getActorLLMConfig(actorId: number): Promise<LLMConfig> {
    const actor = await this.actorDB.getActor(actorId);
    if (!actor) {
      throw new Error(`Actor ${actorId} not found.`);
    }
    return cloneConfig(actor.llmConfig ?? GlobalConfig.defaultLlm);
  }

  /**
   * Gets the complete web search config for one actor.
   * @param actorId - Actor identifier.
   * @returns Actor-specific web search config, or the disabled default.
   */
  async getActorWebSearchConfig(actorId: number): Promise<WebSearchConfig> {
    const actor = await this.actorDB.getActor(actorId);
    if (!actor) {
      throw new Error(`Actor ${actorId} not found.`);
    }
    return cloneConfig(actor.webSearchConfig ?? DEFAULT_WEB_SEARCH_CONFIG);
  }

  /**
   * Gets the complete channel config for one actor.
   * @param actorId - Actor identifier.
   * @returns Actor-specific channel config, or the disabled default.
   */
  async getActorChannelConfig(actorId: number): Promise<ChannelConfig> {
    const actor = await this.actorDB.getActor(actorId);
    if (!actor) {
      throw new Error(`Actor ${actorId} not found.`);
    }
    return cloneConfig(actor.channelConfig ?? DEFAULT_CHANNEL_CONFIG);
  }

  private snapshotPath(name: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(
        `Invalid snapshot name: ${name}. Only letters, numbers, underscores, and hyphens are allowed.`,
      );
    }
    return path.join(
      GlobalConfig.system.dataRoot,
      "mongo-snapshots",
      `${name}.json`,
    );
  }
}
