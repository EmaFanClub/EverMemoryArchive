import type { Server } from "../server";
import type { ActorEntity } from "../db";
import type {
  ActorRuntimeSnapshot,
  ActorRuntimeStatus,
  ActorRuntimeTransition,
} from "./types";

type PersistedActor = ActorEntity & { id: number };

export class RuntimeController {
  private readonly runtimeOperations = new Map<
    number,
    Promise<ActorRuntimeSnapshot>
  >();
  private readonly manualTransitions = new Map<
    number,
    Exclude<ActorRuntimeTransition, null | "waking" | "sleeping">
  >();

  constructor(private readonly server: Server) {}

  async getSnapshot(actorId: number): Promise<ActorRuntimeSnapshot> {
    const actorEntity = await this.server.dbService.actorDB.getActor(actorId);
    const runtime = this.server.actorRegistry?.get(actorId) ?? null;
    const enabled = actorEntity?.enabled === true;
    return {
      actorId,
      enabled,
      ...toRuntimeState(
        enabled,
        runtime,
        this.manualTransitions.get(actorId) ?? null,
      ),
      updatedAt: Date.now(),
    };
  }

  async getStatus(actorId: number): Promise<ActorRuntimeStatus> {
    return (await this.getSnapshot(actorId)).status;
  }

  async enable(actorId: number): Promise<ActorRuntimeSnapshot> {
    return await this.runLocked(actorId, async () => {
      const actor = await this.requireActor(actorId);
      const current = await this.getSnapshot(actorId);
      if (current.status !== "offline" || current.transition !== null) {
        throw new Error(
          `Actor ${actorId} runtime cannot be enabled from ${formatRuntimeState(current)}.`,
        );
      }

      this.manualTransitions.set(actorId, "booting");

      try {
        await this.server.dbService.actorDB.upsertActor({
          ...actor,
          enabled: true,
        });
        await this.publishStatus(actorId, "enable:start");
        const runtime = await this.server.actorRegistry.ensure(actorId);
        await this.server.gateway.channelRegistry.refreshActorChannels(actorId);
        await runtime.startBootInit();
        this.manualTransitions.delete(actorId);
        const snapshot = await this.getSnapshot(actorId);
        await this.publishStatus(actorId, "enable:accepted");
        return snapshot;
      } catch (error) {
        await this.rollbackEnable(actor);
        throw error;
      }
    });
  }

  async disable(actorId: number): Promise<ActorRuntimeSnapshot> {
    return await this.runLocked(actorId, async () => {
      const actor = await this.requireActor(actorId);
      const current = await this.getSnapshot(actorId);
      if (current.status === "offline" || current.transition !== null) {
        throw new Error(
          `Actor ${actorId} runtime cannot be disabled from ${formatRuntimeState(current)}.`,
        );
      }

      this.manualTransitions.set(actorId, "shutting_down");

      try {
        await this.server.dbService.actorDB.upsertActor({
          ...actor,
          enabled: false,
        });
        await this.publishStatus(actorId, "disable:start", current.status);
        await this.server.actorRegistry.unload(actorId);
        await this.server.gateway.channelRegistry.removeActorChannels(actorId);
        this.manualTransitions.delete(actorId);
        const snapshot = await this.getSnapshot(actorId);
        await this.publishStatus(actorId, "disable:complete");
        return {
          ...snapshot,
          enabled: false,
          status: "offline",
          transition: null,
        };
      } catch (error) {
        await this.rollbackDisable(actor);
        throw error;
      }
    });
  }

  async publishStatus(
    actorId: number,
    reason?: string,
    explicitStatus?: ActorRuntimeStatus,
    explicitTransition?: ActorRuntimeTransition,
  ): Promise<void> {
    const snapshot =
      explicitStatus !== undefined || explicitTransition !== undefined
        ? {
            ...(await this.getSnapshot(actorId)),
            ...(explicitStatus !== undefined ? { status: explicitStatus } : {}),
            ...(explicitTransition !== undefined
              ? { transition: explicitTransition }
              : {}),
          }
        : await this.getSnapshot(actorId);
    this.server.bus.publish(
      this.server.bus.createEvent({
        type: "actor.runtime.changed",
        actorId,
        data: {
          ...snapshot,
          reason: reason ?? null,
        },
      }),
    );
  }

  private async requireActor(actorId: number) {
    const actor = await this.server.dbService.actorDB.getActor(actorId);
    if (!actor || typeof actor.id !== "number") {
      throw new Error(`Actor ${actorId} not found.`);
    }
    return actor as PersistedActor;
  }

  private async runLocked(
    actorId: number,
    run: () => Promise<ActorRuntimeSnapshot>,
  ): Promise<ActorRuntimeSnapshot> {
    const current = this.runtimeOperations.get(actorId);
    if (current) {
      throw new Error(`Actor ${actorId} runtime operation is in progress.`);
    }
    const task = run().finally(() => {
      if (this.runtimeOperations.get(actorId) === task) {
        this.runtimeOperations.delete(actorId);
      }
    });
    this.runtimeOperations.set(actorId, task);
    return await task;
  }

  private async rollbackEnable(actor: PersistedActor): Promise<void> {
    await this.server.dbService.actorDB.upsertActor({
      ...actor,
      enabled: false,
    });
    await this.server.actorRegistry.unload(actor.id);
    await this.server.gateway.channelRegistry.removeActorChannels(actor.id);
    this.manualTransitions.delete(actor.id);
    await this.publishStatus(actor.id, "enable:rollback");
  }

  private async rollbackDisable(actor: PersistedActor): Promise<void> {
    await this.server.dbService.actorDB.upsertActor({
      ...actor,
      enabled: true,
    });
    try {
      await this.server.actorRegistry.ensure(actor.id);
      await this.server.gateway.channelRegistry.refreshActorChannels(actor.id);
    } finally {
      this.manualTransitions.delete(actor.id);
      await this.publishStatus(actor.id, "disable:rollback");
    }
  }
}

function toRuntimeState(
  enabled: boolean,
  runtime: ReturnType<Server["actorRegistry"]["get"]> | null,
  manualTransition: ActorRuntimeTransition,
): Pick<ActorRuntimeSnapshot, "status" | "transition"> {
  if (!enabled || !runtime) {
    return {
      status: "offline",
      transition: manualTransition,
    };
  }
  const status = runtime.getStatus();
  const actorTransition = runtime.getTransition();
  const transition = manualTransition ?? actorTransition;
  if (status === "sleep") {
    return { status: "sleep", transition };
  }
  if (status === "switching" && actorTransition === "waking") {
    return { status: "sleep", transition };
  }
  return { status: "online", transition };
}

function formatRuntimeState(snapshot: ActorRuntimeSnapshot): string {
  return snapshot.transition
    ? `${snapshot.status}/${snapshot.transition}`
    : snapshot.status;
}
