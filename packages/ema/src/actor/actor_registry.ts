import type { Server } from "../server";
import { Actor } from "./actor";

/**
 * Manages runtime actor instances for one server.
 */
export class ActorRegistry {
  private readonly actors = new Map<number, Actor>();
  private readonly actorInFlight = new Map<number, Promise<Actor>>();

  constructor(private readonly server: Server) {}

  /**
   * Gets one loaded actor runtime from the in-memory cache.
   * @param actorId - The actor identifier.
   * @returns Loaded runtime actor, or null when not loaded yet.
   */
  get(actorId: number): Actor | null {
    return this.actors.get(actorId) ?? null;
  }

  /**
   * Ensures one actor runtime exists and returns it.
   * @param actorId - The actor identifier.
   * @returns Loaded runtime actor instance.
   */
  async ensure(actorId: number): Promise<Actor> {
    let actor = this.actors.get(actorId);
    if (!actor) {
      let inFlight = this.actorInFlight.get(actorId);
      if (!inFlight) {
        inFlight = (async () => {
          const actorEntity = await this.server.dbService.actorDB.getActor(
            actorId,
          );
          if (!actorEntity) {
            throw new Error(`Actor ${actorId} not found.`);
          }
          const created = await Actor.create(
            this.server.config,
            actorId,
            this.server,
          );
          this.actors.set(actorId, created);
          return created;
        })();
        this.actorInFlight.set(actorId, inFlight);
      }
      try {
        actor = await inFlight;
      } finally {
        this.actorInFlight.delete(actorId);
      }
    }
    return actor;
  }

  /**
   * Restores all persisted actors into runtime memory.
   */
  async restoreAll(): Promise<void> {
    const actors = await this.server.dbService.actorDB.listActors();
    await Promise.all(
      actors
        .map((actor) => actor.id)
        .filter((id): id is number => typeof id === "number")
        .map((actorId) => this.ensure(actorId)),
    );
  }

  /**
   * Starts boot initialization for all loaded actors.
   */
  startBootInitAll(): void {
    for (const actor of this.actors.values()) {
      actor.startBootInit();
    }
  }
}
