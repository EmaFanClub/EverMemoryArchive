import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Server } from "./server";
import { MemFs } from "./fs";
import type { RoleData } from "./db";
import { createMongo, type Mongo } from "./db";

describe("Server", () => {
  test("should return user on login", async () => {
    const server = await Server.create();
    const user = server.login();
    expect(user).toBeDefined();
    expect(user.id).toBe(1);
    expect(user.name).toBe("alice");
    expect(user.email).toBe("alice@example.com");
  });
});

describe("Server with MemFs and snapshot functions", () => {
  let fs: MemFs;
  let mongo: Mongo;

  beforeEach(async () => {
    fs = new MemFs();
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
  });

  afterEach(async () => {
    // Clean up: close MongoDB connection
    await mongo.close();
  });

  test("should start from empty db", async () => {
    const server = await Server.createWithMongo(fs, mongo);
    const roles = await server.listRoles();
    expect(roles).toEqual([]);
  });

  test("should insert roles", async () => {
    const server = await Server.createWithMongo(fs, mongo);

    const role1: RoleData = {
      name: "Role 1",
      description: "Description 1",
      prompt: "Prompt 1",
    };

    const id1 = await server.upsertRole(role1);
    expect(id1).toBe(1);

    const retrievedRole = await server.getRole(id1);
    expect(retrievedRole).toMatchObject(role1);

    const roles = await server.listRoles();
    expect(roles).toHaveLength(1);
  });

  test("should save snapshot with roles [r1]", async () => {
    const server = await Server.createWithMongo(fs, mongo);

    const role1: RoleData = {
      name: "Role 1",
      description: "Description 1",
      prompt: "Prompt 1",
    };

    await server.upsertRole(role1);

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
    const server = await Server.createWithMongo(fs, mongo);

    const role2: RoleData = {
      name: "Role 2",
      description: "Description 2",
      prompt: "Prompt 2",
    };

    const role3: RoleData = {
      name: "Role 3",
      description: "Description 3",
      prompt: "Prompt 3",
    };

    await server.upsertRole(role2);
    await server.upsertRole(role3);

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
    const server = await Server.createWithMongo(fs, mongo);

    const role1: RoleData = {
      name: "Role 1",
      description: "Description 1",
      prompt: "Prompt 1",
    };

    // Insert role and save snapshot
    await server.upsertRole(role1);
    await server.snapshot("test-snapshot-restore");

    // Verify db is empty initially after clearing
    await mongo.restoreFromSnapshot({ roles: [] });
    let roles = await server.listRoles();
    expect(roles).toEqual([]);

    // Restore from snapshot
    const restored = await server.restoreFromSnapshot("test-snapshot-restore");
    expect(restored).toBe(true);

    // Verify role was restored
    roles = await server.listRoles();
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject(role1);
  });

  test("should return false when restoring from non-existent snapshot", async () => {
    const server = await Server.createWithMongo(fs, mongo);
    const restored = await server.restoreFromSnapshot("non-existent-snapshot");
    expect(restored).toBe(false);
  });
});
