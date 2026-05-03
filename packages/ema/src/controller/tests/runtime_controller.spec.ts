import { describe, expect, test, vi } from "vitest";

import { EmaBus, type EmaEvent } from "../../bus";
import type { ActorEntity } from "../../db";
import { RuntimeController } from "../runtime_controller";

type PersistedActor = ActorEntity & { id: number };

function createRuntime(
  options: {
    status?: "sleep" | "awake" | "switching";
    transition?: "waking" | "sleeping" | null;
    busy?: boolean;
    startBootInit?: () => Promise<void>;
  } = {},
) {
  return {
    getStatus: vi.fn(() => options.status ?? "sleep"),
    getTransition: vi.fn(() => options.transition ?? null),
    isBusy: vi.fn(() => options.busy ?? false),
    startBootInit: vi.fn(options.startBootInit ?? (async () => {})),
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createFixture({
  enabled,
  runtime: initialRuntime = null,
  refreshActorChannels,
  unload,
}: {
  enabled: boolean;
  runtime?: ReturnType<typeof createRuntime> | null;
  refreshActorChannels?: () => Promise<void>;
  unload?: () => Promise<void>;
}) {
  const actors = new Map<number, PersistedActor>([
    [1, { id: 1, roleId: 1, enabled }],
  ]);
  let runtime = initialRuntime;
  const events: EmaEvent[] = [];
  const bus = new EmaBus();
  bus.subscribe((event) => events.push(event));

  const actorDB = {
    getActor: vi.fn(async (actorId: number) => actors.get(actorId) ?? null),
    upsertActor: vi.fn(async (actor: PersistedActor) => {
      actors.set(actor.id, { ...actor });
      return actor.id;
    }),
  };
  const actorRegistry = {
    get: vi.fn(() => runtime),
    ensure: vi.fn(async () => {
      if (!runtime) {
        runtime = createRuntime();
      }
      return runtime;
    }),
    unload: vi.fn(async () => {
      if (unload) {
        await unload();
        return;
      }
      runtime = null;
    }),
  };
  const channelRegistry = {
    refreshActorChannels: vi.fn(refreshActorChannels ?? (async () => {})),
    removeActorChannels: vi.fn(async () => {}),
  };
  const server = {
    dbService: { actorDB },
    actorRegistry,
    gateway: { channelRegistry },
    bus,
  };

  return {
    controller: new RuntimeController(server as never),
    actors,
    actorDB,
    actorRegistry,
    channelRegistry,
    events,
    get runtime() {
      return runtime;
    },
  };
}

describe("RuntimeController", () => {
  test("enables only offline actors and publishes the final runtime status", async () => {
    const runtime = createRuntime({ status: "sleep" });
    const fixture = createFixture({ enabled: false, runtime });

    const snapshot = await fixture.controller.enable(1);

    expect(fixture.actors.get(1)?.enabled).toBe(true);
    expect(fixture.actorRegistry.ensure).toHaveBeenCalledWith(1);
    expect(fixture.channelRegistry.refreshActorChannels).toHaveBeenCalledWith(
      1,
    );
    expect(runtime.startBootInit).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      actorId: 1,
      enabled: true,
      status: "sleep",
      transition: null,
    });
    expect(fixture.events.map((event) => event.data)).toEqual([
      expect.objectContaining({
        reason: "enable:start",
        transition: "booting",
      }),
      expect.objectContaining({
        reason: "enable:accepted",
        status: "sleep",
        transition: null,
      }),
    ]);
  });

  test("rejects enable unless the current status is offline", async () => {
    const fixture = createFixture({
      enabled: true,
      runtime: createRuntime({ status: "awake" }),
    });

    await expect(fixture.controller.enable(1)).rejects.toThrow(
      "cannot be enabled from online",
    );

    expect(fixture.actorDB.upsertActor).not.toHaveBeenCalled();
    expect(fixture.actorRegistry.ensure).not.toHaveBeenCalled();
  });

  test("maps awake actors to online even while their worker is busy", async () => {
    const runtime = createRuntime({ status: "awake", busy: true });
    const fixture = createFixture({
      enabled: true,
      runtime,
    });

    const snapshot = await fixture.controller.getSnapshot(1);

    expect(snapshot.status).toBe("online");
    expect(snapshot.transition).toBeNull();
    expect(runtime.isBusy).not.toHaveBeenCalled();
  });

  test("maps actor switching direction and rejects runtime switches during it", async () => {
    const fixture = createFixture({
      enabled: true,
      runtime: createRuntime({ status: "switching", transition: "waking" }),
    });

    await expect(fixture.controller.getSnapshot(1)).resolves.toMatchObject({
      status: "sleep",
      transition: "waking",
    });
    await expect(fixture.controller.enable(1)).rejects.toThrow(
      "cannot be enabled from sleep/waking",
    );
    await expect(fixture.controller.disable(1)).rejects.toThrow(
      "cannot be disabled from sleep/waking",
    );

    expect(fixture.actorDB.upsertActor).not.toHaveBeenCalled();
  });

  test("rejects concurrent runtime operations instead of joining the in-flight task", async () => {
    const bootInit = createDeferred();
    const runtime = createRuntime({ startBootInit: () => bootInit.promise });
    const fixture = createFixture({ enabled: false, runtime });

    const firstEnable = fixture.controller.enable(1);
    await Promise.resolve();

    await expect(fixture.controller.disable(1)).rejects.toThrow(
      "operation is in progress",
    );

    bootInit.resolve();
    await firstEnable;
  });

  test("disables active actors and unloads their runtime channels", async () => {
    const fixture = createFixture({
      enabled: true,
      runtime: createRuntime({ status: "awake" }),
    });

    const snapshot = await fixture.controller.disable(1);

    expect(fixture.actors.get(1)?.enabled).toBe(false);
    expect(fixture.actorRegistry.unload).toHaveBeenCalledWith(1);
    expect(fixture.channelRegistry.removeActorChannels).toHaveBeenCalledWith(1);
    expect(fixture.runtime).toBeNull();
    expect(snapshot).toMatchObject({
      actorId: 1,
      enabled: false,
      status: "offline",
      transition: null,
    });
    expect(fixture.events.map((event) => event.data)).toEqual([
      expect.objectContaining({
        reason: "disable:start",
        status: "online",
        transition: "shutting_down",
      }),
      expect.objectContaining({
        reason: "disable:complete",
        status: "offline",
        transition: null,
      }),
    ]);
  });

  test("rolls back enabled=false when enable fails after the database write", async () => {
    const fixture = createFixture({
      enabled: false,
      runtime: createRuntime(),
      refreshActorChannels: async () => {
        throw new Error("channel failed");
      },
    });

    await expect(fixture.controller.enable(1)).rejects.toThrow(
      "channel failed",
    );

    expect(fixture.actors.get(1)?.enabled).toBe(false);
    expect(fixture.actorRegistry.unload).toHaveBeenCalledWith(1);
    expect(fixture.channelRegistry.removeActorChannels).toHaveBeenCalledWith(1);
    expect(fixture.events.at(-1)?.data).toEqual(
      expect.objectContaining({
        reason: "enable:rollback",
        status: "offline",
        transition: null,
      }),
    );
  });

  test("rolls back enabled=true when disable fails after the database write", async () => {
    const fixture = createFixture({
      enabled: true,
      runtime: createRuntime({ status: "awake" }),
      unload: async () => {
        throw new Error("unload failed");
      },
    });

    await expect(fixture.controller.disable(1)).rejects.toThrow(
      "unload failed",
    );

    expect(fixture.actors.get(1)?.enabled).toBe(true);
    expect(fixture.actorRegistry.ensure).toHaveBeenCalledWith(1);
    expect(fixture.channelRegistry.refreshActorChannels).toHaveBeenCalledWith(
      1,
    );
    expect(fixture.events.at(-1)?.data).toEqual(
      expect.objectContaining({
        reason: "disable:rollback",
        status: "online",
        transition: null,
      }),
    );
  });
});
