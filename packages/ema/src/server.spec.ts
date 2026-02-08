import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Server } from "./server";
import { MemFs } from "./fs";
import type { RoleEntity } from "./db";
import { createMongo, type Mongo } from "./db";
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
    const server = await Server.create(new MemFs(), createTestConfig());
    const user = await server.login();
    expect(user).toBeDefined();
    expect(user.id).toBe(1);
    expect(user.name).toBe("alice");
    expect(user.email).toBe("alice@example.com");
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
      description: "Description 1",
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
      description: "Description 1",
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
      description: "Description 2",
      prompt: "Prompt 2",
    };

    const role3: RoleEntity = {
      name: "Role 3",
      description: "Description 3",
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
      description: "Description 1",
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
});
