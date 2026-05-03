import type { IndexableDB } from "../base";
import type { MongoCollectionGetter } from "../mongo";

/**
 * Shared typing for concrete DB driver implementations backed by Mongo collections.
 */
export type MongoDriver<T> = T & MongoCollectionGetter;

/**
 * Shared typing for concrete DB driver implementations that also manage indices.
 */
export type IndexedMongoDriver<T> = T & MongoCollectionGetter & IndexableDB;
