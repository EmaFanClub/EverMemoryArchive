import type { Entity } from "./base";
import type { Mongo, MongoCollectionGetter } from "./mongo";

const counterCollectionName = "counters";
export const utilCollections: MongoCollectionGetter = {
  collections: [counterCollectionName],
};

/**
 * Omits the MongoDB _id field from an entity
 * @param entity - The entity to omit the _id field from
 * @returns The entity with the _id field omitted
 */
export function omitMongoId<T extends { _id?: any }>(
  entity: T,
): Omit<T, "_id"> {
  const { _id, ...rest } = entity;
  return rest;
}

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
 * Generates an ID based on the collection name if not provided
 * @param mongo - MongoDB instance to use for database operations
 * @param collectionName - The name of the collection
 * @param entity - The entity to upsert (must have an id field)
 * @returns Promise resolving to the ID of the created or updated entity
 */
export async function upsertEntity<T extends Entity>(
  mongo: Mongo,
  collectionName: string,
  entity: T,
): Promise<number> {
  const db = mongo.getDb();
  const collection = db.collection<T>(collectionName);

  // Generate ID if not provided
  if (entity.id === undefined || entity.id === null) {
    entity.id = await getNextId(mongo, collectionName);
    // Set create time if not provided
    if (!entity.createdAt) {
      entity.createdAt = Date.now();
    }
  } else if (typeof entity.id !== "number") {
    throw new Error("id must be a number");
  } else if (entity.id <= 0) {
    throw new Error("id must be a positive number");
  } else {
    if (!entity.createdAt) {
      // todo: as any?
      const existingEntity = await collection.findOne({ id: entity.id } as any);
      entity.createdAt = existingEntity?.createdAt ?? Date.now();
    }
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
