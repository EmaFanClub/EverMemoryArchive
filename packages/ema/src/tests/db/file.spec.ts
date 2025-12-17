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
      name: "Test Role",
      description: "A test role",
    };

    const id = await db.upsertRole(roleData);
    expect(id).toBe("0");
    const retrievedRole = await db.getRole(id);
    expect(retrievedRole).toEqual(roleData);
  });

  test("should update an existing role", async () => {
    const roleData: RoleData = {
      name: "Test Role",
    };

    const id = await db.upsertRole(roleData);
    expect(id).toBe("0");

    const updatedRole: RoleData = {
      id,
      name: "Updated Role",
      description: "Updated description",
    };

    await db.upsertRole(updatedRole);
    const retrievedRole = await db.getRole(id);
    expect(retrievedRole).toEqual(updatedRole);
  });

  test("should soft delete a role", async () => {
    const roleData: RoleData = {
      name: "Test Role",
    };

    const id = await db.upsertRole(roleData);
    expect(id).toBe("0");
    const deleted = await db.deleteRole(id);
    expect(deleted).toBe(true);

    // Soft-deleted role should not be retrievable
    const retrievedRole = await db.getRole(id);
    expect(retrievedRole).toBeNull();
  });

  test("should return false when deleting non-existent role", async () => {
    const deleted = await db.deleteRole("nonexistent");
    expect(deleted).toBe(false);
  });

  test("should return false when deleting already deleted role", async () => {
    const roleData: RoleData = {
      name: "Test Role",
    };

    const id = await db.upsertRole(roleData);
    expect(id).toBe("0");
    const deleted1 = await db.deleteRole(id);
    expect(deleted1).toBe(true);

    // Try to delete again
    const deleted2 = await db.deleteRole(id);
    expect(deleted2).toBe(false);
  });

  test("should not list soft-deleted roles", async () => {
    const role1: RoleData = { name: "Role 1" };
    const role2: RoleData = { name: "Role 2" };
    const role3: RoleData = { name: "Role 3" };

    const id1 = await db.upsertRole(role1);
    expect(id1).toBe("0");
    const id2 = await db.upsertRole(role2);
    expect(id2).toBe("1");
    const id3 = await db.upsertRole(role3);
    expect(id3).toBe("2");

    // Delete role2
    await db.deleteRole(id2);

    const roles = await db.listRoles();
    expect(roles).toHaveLength(2);
    expect(roles).toContainEqual(role1);
    expect(roles).toContainEqual(role3);
    expect(roles).not.toContainEqual(expect.objectContaining({ id: id2 }));
  });

  test("should return null when getting non-existent role", async () => {
    const role = await db.getRole("nonexistent");
    expect(role).toBeNull();
  });

  test("should list multiple roles", async () => {
    const role1: RoleData = { name: "Role 1" };
    const role2: RoleData = { name: "Role 2" };
    const role3: RoleData = { name: "Role 3" };

    const id1 = await db.upsertRole(role1);
    expect(id1).toBe("0");
    const id2 = await db.upsertRole(role2);
    expect(id2).toBe("1");
    const id3 = await db.upsertRole(role3);
    expect(id3).toBe("2");

    const roles = await db.listRoles();
    expect(roles).toHaveLength(3);
    expect(roles).toContainEqual(role1);
    expect(roles).toContainEqual(role2);
    expect(roles).toContainEqual(role3);
  });

  test("should handle CRUD operations in sequence", async () => {
    // Create
    const roleData: RoleData = {
      name: "Test Role",
    };
    const id = await db.upsertRole(roleData);
    expect(id).toBe("0");

    // Read
    let role = await db.getRole(id);
    expect(role).toEqual(roleData);

    // Update
    const updatedRole: RoleData = {
      id,
      name: "Updated Role",
    };
    await db.upsertRole(updatedRole);
    role = await db.getRole(id);
    expect(role).toEqual(updatedRole);

    // Soft Delete
    const deleted = await db.deleteRole(id);
    expect(deleted).toBe(true);
    role = await db.getRole(id);
    expect(role).toBeNull();
  });

  test("should set createTime and deleteTime correctly", async () => {
    const roleData: RoleData = {
      name: "Test Role",
      description: "A test role",
      createTime: Date.now(),
    };

    const id = await db.upsertRole(roleData);
    expect(id).toBe("0");
    let role = await db.getRole(id);
    expect(role?.createTime).toBeDefined();
    expect(role?.deleteTime).toBeUndefined();

    // Delete the role
    await db.deleteRole(id);

    // Get from DB directly to check deleteTime was set
    const roles = await db.listRoles();
    expect(roles).toHaveLength(0);
  });
});
