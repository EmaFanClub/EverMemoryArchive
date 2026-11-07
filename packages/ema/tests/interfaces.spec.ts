import { describe, it, expect } from "vitest";
import {
  Interface,
  EmaWorld,
  type EmaCtx,
  type EmaActor,
  type EmaInput,
  type Disposable,
  type EmaRouter,
  type EmaInputBatcher,
  type EmaWorldRegistry,
} from "../src/interfaces.js";

describe("Ema Interfaces and Contracts", () => {
  it("decorates abstract class with Interface() decorator correctly", () => {
    @Interface()
    abstract class CustomWorld extends EmaWorld {}

    expect(CustomWorld).toBeDefined();
    expect(typeof CustomWorld).toBe("function");
  });

  it("allows implementing a concrete EmaWorld", () => {
    class MockTelegramWorld extends EmaWorld {
      public started = false;
      public interacted = false;

      start(_ctx: EmaCtx): Disposable {
        this.started = true;
        return {
          dispose: () => {
            this.started = false;
          },
        };
      }

      interact(
        _ctx: EmaCtx,
        _actor: EmaActor,
        id: string,
        ...args: unknown[]
      ): Disposable {
        this.interacted = true;
        expect(id).toBe("channel:1234");
        expect(args[0]).toBe("reply");
        return {
          dispose: () => {},
        };
      }
    }

    const world = new MockTelegramWorld();
    expect(world.started).toBe(false);

    const mockRouter: EmaRouter = {
      serve: () => ({ dispose: () => {} }),
      read: async () => ({}),
      listRoutes: () => [],
    };

    const mockBatcher: EmaInputBatcher = {
      push: () => {},
      onBatch: () => ({ dispose: () => {} }),
    };

    const mockRegistry: EmaWorldRegistry = {
      register: () => ({ dispose: () => {} }),
      get: () => undefined,
      list: () => [],
    };

    const ctx: EmaCtx = {
      router: mockRouter,
      inputBatcher: mockBatcher,
      registry: mockRegistry,
    };

    const handle = world.start(ctx);
    expect(world.started).toBe(true);
    handle.dispose();
    expect(world.started).toBe(false);

    const actor: EmaActor = {
      id: "actor-001",
      name: "Ema",
      session: "session-123",
      agentId: "emafanclub_ema_dev",
    };

    world.interact(ctx, actor, "channel:1234", "reply", "hello");
    expect(world.interacted).toBe(true);
  });

  it("verifies EmaInput shape", () => {
    const input: EmaInput = {
      id: "msg-001",
      world: "telegram",
      partId: "channel:1234",
      sender: {
        id: "user:1",
        name: "TestUser",
        isOwner: true,
      },
      content: "Hello Ema",
      timestamp: Date.now(),
    };

    expect(input.world).toBe("telegram");
    expect(input.partId).toBe("channel:1234");
    expect(input.sender.isOwner).toBe(true);
  });
});
