import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Server } from "./server";
import { MemFs } from "./fs";
import type { RoleEntity } from "./db";
import { createMongo, type Mongo } from "./db";
import { AgendaScheduler } from "./scheduler";
import {
  Config,
  LLMConfig,
  OpenAIApiConfig,
  GoogleApiConfig,
  AgentConfig,
  ToolsConfig,
  MongoConfig,
  SystemConfig,
} from "./config";
import * as lancedb from "@lancedb/lancedb";

const createTestConfig = () =>
  new Config(
    new LLMConfig(
      new OpenAIApiConfig("test-openai-key", "https://example.com/openai/v1/"),
      new GoogleApiConfig("test-google-key", "https://example.com/google/v1/"),
    ),
    new AgentConfig(),
    new ToolsConfig(),
    new MongoConfig(),
    new SystemConfig(),
  );

describe("Server", () => {
  test("should return user on login", async () => {
    const previousQqUid = process.env.EMA_QQ_UID;
    const previousQqGroupId = process.env.EMA_QQ_GROUP_ID;
    process.env.EMA_QQ_UID = "10726371";
    process.env.EMA_QQ_GROUP_ID = "114514";
    const fs = new MemFs();
    const mongo = await createMongo("", "test_login", "memory");
    await mongo.connect();
    const lance = await lancedb.connect("memory://ema-login");
    const server = Server.createSync(fs, mongo, lance, createTestConfig());

    try {
      const user = await server.login();
      expect(user).toBeDefined();
      expect(user.id).toBe(1);
      expect(user.name).toBe("alice");
      expect(user.email).toBe("alice@example.com");
      const userBinding =
        await server.externalIdentityBindingDB.getExternalIdentityBindingByUid(
          "1",
        );
      expect(userBinding).toMatchObject({
        userId: 1,
        channel: "web",
        uid: "1",
      });
      const qqBinding =
        await server.externalIdentityBindingDB.getExternalIdentityBindingByUid(
          "10726371",
        );
      expect(qqBinding).toMatchObject({
        userId: 1,
        channel: "qq",
        uid: "10726371",
      });
      const qqConversation =
        await server.conversationDB.getConversationByActorAndSession(
          1,
          "qq-chat-10726371",
        );
      expect(qqConversation).toMatchObject({
        actorId: 1,
        session: "qq-chat-10726371",
      });
      const qqGroupConversation =
        await server.conversationDB.getConversationByActorAndSession(
          1,
          "qq-group-114514",
        );
      expect(qqGroupConversation).toMatchObject({
        actorId: 1,
        session: "qq-group-114514",
      });
    } finally {
      if (typeof previousQqUid === "undefined") {
        delete process.env.EMA_QQ_UID;
      } else {
        process.env.EMA_QQ_UID = previousQqUid;
      }
      if (typeof previousQqGroupId === "undefined") {
        delete process.env.EMA_QQ_GROUP_ID;
      } else {
        process.env.EMA_QQ_GROUP_ID = previousQqGroupId;
      }
      await mongo.close();
      await lance.close();
    }
  });

  test("login should schedule default recurring jobs only once", async () => {
    const fs = new MemFs();
    const mongo = await createMongo("", "test_login_jobs", "memory");
    await mongo.connect();
    const lance = await lancedb.connect("memory://ema-login-jobs");
    const server = Server.createSync(fs, mongo, lance, createTestConfig());
    server.scheduler = await AgendaScheduler.create(mongo, {
      processEvery: 20,
    });

    try {
      await server.login();
      await server.login();

      const conversation =
        await server.conversationDB.getConversationByActorAndSession(
          1,
          "web-chat-1",
        );
      expect(conversation).toMatchObject({
        actorId: 1,
        session: "web-chat-1",
        description: "这是你和你的拥有者之间在网页端进行的对话。",
      });

      const backgroundJobs = await server.scheduler.listJobs({
        name: "actor_calendar_rollup",
        "data.actorId": 1,
      });
      const foregroundJobs = await server.scheduler.listJobs({
        name: "actor_foreground",
        "data.actorId": 1,
      });
      expect(backgroundJobs).toHaveLength(1);
      expect(foregroundJobs).toHaveLength(0);
    } finally {
      await server.scheduler.stop();
      await mongo.close();
      await lance.close();
    }
  });
});

// TODO: There's no test coverage for error cases in the snapshot/restore functionality, such as invalid snapshot names, I/O errors, or corrupt snapshot files.
describe("Server with MemFs and snapshot functions", () => {
  let fs: MemFs;
  let mongo: Mongo;
  let lance: lancedb.Connection;
  let server: Server;

  beforeEach(async () => {
    fs = new MemFs();
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();

    lance = await lancedb.connect("memory://ema");
    server = Server.createSync(fs, mongo, lance, createTestConfig());
  });

  afterEach(async () => {
    await mongo.close();
    await lance.close();
  });

  test("should start from empty db", async () => {
    const roles = await server.roleDB.listRoles();
    expect(roles).toEqual([]);
  });

  test("should insert roles", async () => {
    const role1: RoleEntity = {
      name: "Role 1",
      prompt: "Prompt 1",
    };

    const id1 = await server.roleDB.upsertRole(role1);
    expect(id1).toBe(1);

    const retrievedRole = await server.roleDB.getRole(id1);
    expect(retrievedRole).toMatchObject(role1);

    const roles = await server.roleDB.listRoles();
    expect(roles).toHaveLength(1);
  });

  test("should save snapshot with roles [r1]", async () => {
    const role1: RoleEntity = {
      name: "Role 1",
      prompt: "Prompt 1",
    };

    await server.roleDB.upsertRole(role1);

    const result = await server.snapshot("test-snapshot-r1");
    expect(result.fileName).toBe(".data/mongo-snapshots/test-snapshot-r1.json");

    // Verify snapshot file was created
    const snapshotExists = await fs.exists(result.fileName);
    expect(snapshotExists).toBe(true);

    // Verify snapshot content
    const snapshotContent = await fs.read(result.fileName);
    const snapshot = JSON.parse(snapshotContent);
    expect(snapshot).toHaveProperty("roles");
    expect(snapshot.roles).toHaveLength(1);
    expect(snapshot.roles[0]).toMatchObject(role1);
  });

  test("should save snapshot with roles [r2, r3]", async () => {
    const role2: RoleEntity = {
      name: "Role 2",
      prompt: "Prompt 2",
    };

    const role3: RoleEntity = {
      name: "Role 3",
      prompt: "Prompt 3",
    };

    await server.roleDB.upsertRole(role2);
    await server.roleDB.upsertRole(role3);

    const result = await server.snapshot("test-snapshot-r2r3");
    expect(result.fileName).toBe(
      ".data/mongo-snapshots/test-snapshot-r2r3.json",
    );

    // Verify snapshot file was created
    const snapshotExists = await fs.exists(result.fileName);
    expect(snapshotExists).toBe(true);

    // Verify snapshot content
    const snapshotContent = await fs.read(result.fileName);
    const snapshot = JSON.parse(snapshotContent);
    expect(snapshot).toHaveProperty("roles");
    expect(snapshot.roles).toHaveLength(2);
    expect(snapshot.roles[0]).toMatchObject(role2);
    expect(snapshot.roles[1]).toMatchObject(role3);
  });

  test("should restore from snapshot containing roles [r1]", async () => {
    const role1: RoleEntity = {
      name: "Role 1",
      prompt: "Prompt 1",
    };

    // Insert role and save snapshot
    await server.roleDB.upsertRole(role1);
    await server.snapshot("test-snapshot-restore");

    // Verify db is empty initially after clearing
    await mongo.restoreFromSnapshot({ roles: [] });
    let roles = await server.roleDB.listRoles();
    expect(roles).toEqual([]);

    // Restore from snapshot
    const restored = await server.restoreFromSnapshot("test-snapshot-restore");
    expect(restored).toBe(true);

    // Verify role was restored
    roles = await server.roleDB.listRoles();
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject(role1);
  });

  test("should return false when restoring from non-existent snapshot", async () => {
    const restored = await server.restoreFromSnapshot("non-existent-snapshot");
    expect(restored).toBe(false);
  });

  test("getActor should only load actors that already exist in database", async () => {
    await expect(server.getActor(1)).rejects.toThrow("Actor 1 not found.");

    await server.login();

    const actor = await server.getActor(1);
    const actorAgain = await server.getActor(1);
    expect(actor).toBe(actorAgain);

    const conversation =
      await server.conversationDB.getConversationByActorAndSession(
        1,
        "web-chat-1",
      );
    expect(conversation?.description).toBe(
      "这是你和你的拥有者之间在网页端进行的对话。",
    );
  });
});
