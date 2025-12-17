/**
 * Database interface for role management.
 * This interface defines the contract for CRUD operations on roles.
 */

/**
 * Represents role data structure
 */
export interface RoleData {
  id: string;
  description?: string;
  createTime?: number;
  deleteTime?: number;
  [key: string]: unknown;
}

/**
 * Interface for role database operations
 */
export interface RoleDB {
  /**
   * Lists all roles in the database
   * @returns Promise resolving to an array of role data
   */
  listRoles(): Promise<RoleData[]>;

  /**
   * Gets a specific role by ID
   * @param roleId - The unique identifier for the role
   * @returns Promise resolving to the role data or null if not found
   */
  getRole(roleId: string): Promise<RoleData | null>;

  /**
   * Inserts or updates a role in the database
   * @param roleData - The role data to upsert
   * @returns Promise resolving when the operation completes
   */
  upsertRole(roleData: RoleData): Promise<void>;

  /**
   * Deletes a role from the database
   * @param roleId - The unique identifier for the role to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  deleteRole(roleId: string): Promise<boolean>;
}
