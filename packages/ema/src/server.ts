import { GlobalConfig } from "./config/index";
import { DBService } from "./db";
import type { Fs } from "./shared/fs";
import { RealFs } from "./shared/fs";
import { ActorRegistry } from "./actor";
import { ActorScheduler, AgendaScheduler } from "./scheduler";
import { createJobHandlers } from "./scheduler/jobs";
import { MemoryManager } from "./memory/manager";
import { Gateway } from "./gateway";
import { buildSession } from "./channel";
import { Logger } from "./shared/logger";

/**
 * Top-level server container that wires and starts the core runtime services.
 */
export class Server {
  /**
   * Filesystem abstraction used for startup config, seed, and snapshot files.
   */
  private fs!: Fs;

  /**
   * Registry that owns all loaded actor runtime instances.
   */
  actorRegistry!: ActorRegistry;

  /**
   * Message routing entrypoint for inbound channel events and outbound actor
   * responses.
   */
  gateway!: Gateway;

  /**
   * Aggregated database service exposing all persistence drivers.
   */
  dbService!: DBService;

  /**
   * Process-wide scheduler used for foreground and background jobs.
   */
  scheduler!: AgendaScheduler;

  /**
   * Memory coordinator that persists chat/activity data and builds prompts.
   */
  memoryManager!: MemoryManager;

  /**
   * System-level logger for server lifecycle and infrastructure events.
   */
  logger!: Logger;

  /**
   * Creates an uninitialized server container.
   *
   * Use {@link Server.create} for normal startup so all dependencies are wired
   * and started in the expected order.
   *
   */
  private constructor() {}

  /**
   * Creates and starts a fully initialized server instance.
   *
   * This method restores optional development snapshots, creates indices,
   * constructs runtime services, restores actor runtimes, starts the scheduler,
   * and finally triggers actor boot initialization.
   *
   * @param fs - Filesystem abstraction used for snapshot loading.
   * @returns Fully initialized server instance ready to serve requests.
   */
  static async create(fs: Fs = new RealFs()): Promise<Server> {
    await GlobalConfig.load(fs);

    const server = new Server();
    server.fs = fs;
    server.logger = Logger.create({
      name: "server",
      context: {
        mode: GlobalConfig.system.mode,
      },
      outputs: [
        { type: "console", level: "info" },
        { type: "file", level: "debug" },
      ],
    });
    server.logger.info("Server starting");
    server.dbService = await DBService.create(fs);
    server.logger.info("Database service initialized", {
      mongo: GlobalConfig.mongo,
      dataRoot: GlobalConfig.system.dataRoot,
    });

    let restored = false;
    if (
      GlobalConfig.system.mode === "dev" &&
      GlobalConfig.system.dev.restoreDefaultSnapshot
    ) {
      restored = await server.dbService.restoreFromSnapshot("default");
      if (!restored) {
        server.logger.warn("Failed to restore snapshot", { name: "default" });
      } else {
        server.logger.info("Snapshot restored", { name: "default" });
      }
    }

    await server.dbService.createIndices();
    server.logger.info("Database indices created");

    server.gateway = new Gateway(server);
    server.actorRegistry = new ActorRegistry(server);
    server.memoryManager = new MemoryManager(server);
    server.scheduler = await AgendaScheduler.create(server.dbService.mongo);
    server.logger.info("Scheduler initialized");

    if (
      GlobalConfig.system.mode === "dev" &&
      GlobalConfig.system.dev.requireDevSeed &&
      !restored
    ) {
      await server.createInitialCharacters();
    }
    await server.actorRegistry.restoreAll();
    server.logger.info("Actors restored");

    await server.scheduler.start(createJobHandlers(server));
    server.logger.info("Scheduler started");
    server.actorRegistry.startBootInitAll();
    server.logger.info("Server ready");

    return server;
  }

  /**
   * Creates an actor-scoped scheduler facade bound to the shared scheduler.
   *
   * The returned wrapper automatically scopes schedule operations to the
   * specified actor id while still using the single process-wide scheduler
   * instance.
   *
   * @param actorId - Actor identifier.
   * @returns Actor-scoped scheduler wrapper.
   */
  getActorScheduler(actorId: number): ActorScheduler {
    return new ActorScheduler(this.scheduler, actorId);
  }

  /**
   * Ensures the current development bootstrap dataset exists.
   *
   * This method is intentionally idempotent. It reads config/dev.seed.json and
   * applies the declared users, roles, actors, ownership relations, identity
   * bindings, and conversations to the database.
   *
   * The method only touches persistent data. Runtime actor restoration,
   * channel startup, scheduler startup, and boot initialization are handled by
   * the caller after bootstrap data has been ensured.
   *
   * @returns Promise that resolves after the default bootstrap data is ready.
   */
  private async createInitialCharacters(): Promise<void> {
    let seed;
    try {
      seed = await GlobalConfig.loadDevSeed(this.fs);
    } catch (error) {
      this.logger?.warn("Failed to load development seed", {
        path: GlobalConfig.devSeedPath,
        error,
      });
      return;
    }
    if (!seed) {
      this.logger?.warn("Development seed not found, skipped bootstrap", {
        path: GlobalConfig.devSeedPath,
      });
      return;
    }
    this.logger?.info("Development seed loaded", {
      path: GlobalConfig.devSeedPath,
    });

    for (const user of seed.users) {
      await this.dbService.userDB.upsertUser({ ...user });
    }
    for (const role of seed.roles) {
      await this.dbService.roleDB.upsertRole({ ...role });
    }
    for (const actor of seed.actors) {
      await this.dbService.actorDB.upsertActor({ ...actor });
    }
    for (const relation of seed.userOwnActors) {
      await this.dbService.userOwnActorDB.addActorToUser({ ...relation });
    }
    for (const binding of seed.identityBindings) {
      await this.dbService.externalIdentityBindingDB.upsertExternalIdentityBinding(
        { ...binding },
      );
    }
    for (const conversation of seed.conversations) {
      await this.dbService.createConversation(
        conversation.actorId,
        buildSession(conversation.channel, conversation.type, conversation.uid),
        conversation.name,
        conversation.description,
        conversation.allowProactive,
      );
    }
    this.logger?.info("Development seed applied", {
      users: seed.users.length,
      roles: seed.roles.length,
      actors: seed.actors.length,
      conversations: seed.conversations.length,
    });
  }
}
