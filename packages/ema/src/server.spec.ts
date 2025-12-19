import { expect, test, describe } from "vitest";
import { Server } from "./server";

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
