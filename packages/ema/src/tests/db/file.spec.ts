import { expect, test, describe, beforeEach } from "vitest";
import { FileDB, MemFs } from "../../db/file";
import type { RoleData } from "../../db/base";

describe("MemFs", () => {
  test("should read empty object when file doesn't exist", async () => {
    const fs = new MemFs();
    const content = await fs.read("nonexistent.json");
    expect(content).toBe("{}");
  });

  test("should write and read file content", async () => {
    const fs = new MemFs();
    await fs.write("test.json", '{"key": "value"}');
    const content = await fs.read("test.json");
    expect(content).toBe('{"key": "value"}');
  });
});

describe("FileDB with MemFs", () => {
  let db: FileDB;

  beforeEach(() => {
    const memFs = new MemFs();
    db = new FileDB("test-db.json", memFs);
  });

  test("should list empty roles initially", async () => {
    const roles = await db.listRoles();
    expect(roles).toEqual([]);
  });

  test("should create a role", async () => {
    const roleData: RoleData = {
      id: "role1",
      name: "Test Role",
      description: "A test role",
    };

    await db.upsertRole(roleData);
    const retrievedRole = await db.getRole("role1");
    expect(retrievedRole).toEqual(roleData);
  });

  test("should update an existing role", async () => {
    const roleData: RoleData = {
      id: "role1",
      name: "Test Role",
    };

    await db.upsertRole(roleData);

    const updatedRole: RoleData = {
      id: "role1",
      name: "Updated Role",
      description: "Updated description",
    };

    await db.upsertRole(updatedRole);
    const retrievedRole = await db.getRole("role1");
    expect(retrievedRole).toEqual(updatedRole);
  });

  test("should delete a role", async () => {
    const roleData: RoleData = {
      id: "role1",
      name: "Test Role",
    };

    await db.upsertRole(roleData);
    const deleted = await db.deleteRole("role1");
    expect(deleted).toBe(true);

    const retrievedRole = await db.getRole("role1");
    expect(retrievedRole).toBeNull();
  });

  test("should return false when deleting non-existent role", async () => {
    const deleted = await db.deleteRole("nonexistent");
    expect(deleted).toBe(false);
  });

  test("should return null when getting non-existent role", async () => {
    const role = await db.getRole("nonexistent");
    expect(role).toBeNull();
  });

  test("should list multiple roles", async () => {
    const role1: RoleData = { id: "role1", name: "Role 1" };
    const role2: RoleData = { id: "role2", name: "Role 2" };
    const role3: RoleData = { id: "role3", name: "Role 3" };

    await db.upsertRole(role1);
    await db.upsertRole(role2);
    await db.upsertRole(role3);

    const roles = await db.listRoles();
    expect(roles).toHaveLength(3);
    expect(roles).toContainEqual(role1);
    expect(roles).toContainEqual(role2);
    expect(roles).toContainEqual(role3);
  });

  test("should handle CRUD operations in sequence", async () => {
    // Create
    const roleData: RoleData = {
      id: "role1",
      name: "Test Role",
    };
    await db.upsertRole(roleData);

    // Read
    let role = await db.getRole("role1");
    expect(role).toEqual(roleData);

    // Update
    const updatedRole: RoleData = {
      id: "role1",
      name: "Updated Role",
    };
    await db.upsertRole(updatedRole);
    role = await db.getRole("role1");
    expect(role).toEqual(updatedRole);

    // Delete
    const deleted = await db.deleteRole("role1");
    expect(deleted).toBe(true);
    role = await db.getRole("role1");
    expect(role).toBeNull();
  });
});
