import { describe, expect, test } from "vitest";
import { RemoteMongo } from "../remote";

describe("RemoteMongo getUri", () => {
  test("adds db name when uri has no database path", () => {
    const mongo = new RemoteMongo({
      uri: "mongodb://localhost:27017",
      dbName: "ema_test",
    });
    expect(mongo.getUri()).toBe("mongodb://localhost:27017/ema_test");
  });

  test("adds authSource admin when adding a database path to credential uris", () => {
    const mongo = new RemoteMongo({
      uri: "mongodb://user:pass@localhost:27017",
      dbName: "ema_test",
    });
    expect(mongo.getUri()).toBe(
      "mongodb://user:pass@localhost:27017/ema_test?authSource=admin",
    );
  });

  test("adds db name and preserves query parameters", () => {
    const mongo = new RemoteMongo({
      uri: "mongodb://localhost:27017/?retryWrites=true&replicaSet=rs0",
      dbName: "ema_test",
    });
    expect(mongo.getUri()).toBe(
      "mongodb://localhost:27017/ema_test?retryWrites=true&replicaSet=rs0",
    );
  });

  test("preserves explicit authSource when adding a database path", () => {
    const mongo = new RemoteMongo({
      uri: "mongodb://user:pass@localhost:27017/?authSource=users&retryWrites=true",
      dbName: "ema_test",
    });
    expect(mongo.getUri()).toBe(
      "mongodb://user:pass@localhost:27017/ema_test?authSource=users&retryWrites=true",
    );
  });

  test("keeps existing database path", () => {
    const mongo = new RemoteMongo({
      uri: "mongodb://localhost:27017/existing_db?retryWrites=true",
      dbName: "ema_test",
    });
    expect(mongo.getUri()).toBe(
      "mongodb://localhost:27017/existing_db?retryWrites=true",
    );
  });

  test("supports replica set connection strings", () => {
    const mongo = new RemoteMongo({
      uri: "mongodb://h1:27017,h2:27017/?replicaSet=rs0",
      dbName: "ema_test",
    });
    expect(mongo.getUri()).toBe(
      "mongodb://h1:27017,h2:27017/ema_test?replicaSet=rs0",
    );
  });
});
