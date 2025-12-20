import type { Mongo, MongoCollectionGetter } from "./mongo";

const counterCollectionName = "counters";
export const utilCollections: MongoCollectionGetter = {
  collections: [counterCollectionName],
};

/**
 * Counter document interface for MongoDB
 */
interface CounterDocument {
  _id: string;
  seq: number;
}

/**
 * Gets the next ID for a given kind using MongoDB's counter pattern
 * @param mongo - MongoDB instance to use for database operations
 * @param kind - The kind of entity (e.g., "role", "actor", "user")
 * @returns Promise resolving to the next ID as a number
 */
export async function getNextId(mongo: Mongo, kind: string): Promise<number> {
  const db = mongo.getDb();
  const counters = db.collection<CounterDocument>(counterCollectionName);

  const result = await counters.findOneAndUpdate(
    { _id: kind },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );

  if (!result || result.seq == null) {
    throw new Error(`Failed to generate next ID for kind "${kind}"`);
  }

  return result.seq;
}

/**
 * Upserts an entity in a MongoDB collection
 * Generates an ID if not provided
 * @param mongo - MongoDB instance to use for database operations
 * @param collectionName - The name of the collection
 * @param entity - The entity to upsert (must have an id field)
 * @param kind - The kind of entity for ID generation (e.g., "role", "actor")
 * @returns Promise resolving to the ID of the created or updated entity
 */
export async function upsertEntity<T extends { id?: number }>(
  mongo: Mongo,
  collectionName: string,
  entity: T,
  kind: string,
): Promise<number> {
  const db = mongo.getDb();
  const collection = db.collection<T>(collectionName);

  // Generate ID if not provided
  if (!entity.id) {
    entity.id = await getNextId(mongo, kind);
  }

  // Upsert the entity (update if exists, insert if not)
  await collection.updateOne(
    { id: entity.id } as any,
    { $set: entity },
    { upsert: true },
  );

  return entity.id;
}

/**
 * Deletes an entity from a MongoDB collection
 * Checks that ID is defined and valid to avoid accidental deletion of all entities
 * @param mongo - MongoDB instance to use for database operations
 * @param collectionName - The name of the collection
 * @param id - The ID of the entity to delete
 * @returns Promise resolving to true if deleted, false if not found or invalid ID
 */
export async function deleteEntity(
  mongo: Mongo,
  collectionName: string,
  id: number | undefined,
): Promise<boolean> {
  // Check if ID is defined and valid to avoid accidental deletion
  if (id === undefined || id === null || typeof id !== "number") {
    return false;
  }

  const db = mongo.getDb();
  const collection = db.collection(collectionName);

  // Delete the entity and check if any document was deleted
  const result = await collection.deleteOne({ id });

  return result.deletedCount > 0;
}
