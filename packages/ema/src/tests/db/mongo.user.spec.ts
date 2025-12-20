import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoUserDB } from "../../db";
import type { Mongo, UserEntity } from "../../db";

describe("MongoUserDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoUserDB;

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoUserDB(mongo);
  });

  afterEach(async () => {
    // Clean up: close MongoDB connection
    await mongo.close();
  });

  test("should create a user", async () => {
    const userData: UserEntity = {
      name: "Test User",
      description: "A test user",
      avatar: "https://example.com/avatar.png",
      email: "test@example.com",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertUser(userData);
    const retrievedUser = await db.getUser(1);
    expect(retrievedUser).toEqual(userData);
  });

  test("should update an existing user", async () => {
    const userData: UserEntity = {
      name: "Test User",
      description: "A test user",
      avatar: "https://example.com/avatar.png",
      email: "test@example.com",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const id = await db.upsertUser(userData);
    expect(id).toBe(1);

    const updatedUser: UserEntity = {
      id,
      ...userData,
      name: "Updated User",
      description: "Updated description",
      updatedAt: Date.now(),
    };

    await db.upsertUser(updatedUser);
    const retrievedUser = await db.getUser(1);
    expect(retrievedUser).toEqual(updatedUser);
  });

  test("should delete a user", async () => {
    const userData: UserEntity = {
      name: "Test User",
      description: "A test user",
      avatar: "https://example.com/avatar.png",
      email: "test@example.com",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertUser(userData);
    const deleted = await db.deleteUser(1);
    expect(deleted).toBe(true);

    const retrievedUser = await db.getUser(1);
    expect(retrievedUser).toBeNull();
  });

  test("should return false when deleting non-existent user", async () => {
    const deleted = await db.deleteUser(999);
    expect(deleted).toBe(false);
  });

  test("should return false when deleting already deleted user", async () => {
    const userData: UserEntity = {
      name: "Test User",
      description: "A test user",
      avatar: "https://example.com/avatar.png",
      email: "test@example.com",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertUser(userData);
    const deleted1 = await db.deleteUser(1);
    expect(deleted1).toBe(true);

    // Try to delete again
    const deleted2 = await db.deleteUser(1);
    expect(deleted2).toBe(false);
  });

  test("should return null when getting non-existent user", async () => {
    const user = await db.getUser(999);
    expect(user).toBeNull();
  });

  test("should handle CRUD operations in sequence", async () => {
    // Create
    const userData: UserEntity = {
      name: "Test User",
      description: "A test user",
      avatar: "https://example.com/avatar.png",
      email: "test@example.com",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.upsertUser(userData);

    // Read
    let user = await db.getUser(1);
    expect(user).toEqual(userData);

    // Update
    const updatedUser: UserEntity = {
      ...userData,
      name: "Updated User",
      updatedAt: Date.now(),
    };
    await db.upsertUser(updatedUser);
    user = await db.getUser(1);
    expect(user).toEqual(updatedUser);

    // Delete
    const deleted = await db.deleteUser(1);
    expect(deleted).toBe(true);
    user = await db.getUser(1);
    expect(user).toBeNull();
  });
});
