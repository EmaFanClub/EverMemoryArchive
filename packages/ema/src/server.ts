import { GlobalConfig, type BootstrapConfig } from "./config/index";
import { DBService, getLanceDbDirectory } from "./db";
import type { Fs } from "./shared/fs";
import { RealFs } from "./shared/fs";
import { ActorRegistry } from "./actor";
import { ActorScheduler, AgendaScheduler } from "./scheduler";
import { createJobHandlers } from "./scheduler/jobs";
import { MemoryManager } from "./memory/manager";
import { Gateway } from "./gateway";
import { Logger } from "./shared/logger";
import { EmaBus } from "./bus";
import { EmaController } from "./controller";

export interface ServerCreateOptions {
  readonly bootstrap?: BootstrapConfig;
  readonly start?: boolean;
}

/**
 * Top-level server container that wires and starts the core runtime services.
 */
export class Server {
  /**
   * Filesystem abstraction used for startup config and snapshot files.
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
   * Process-wide business event bus for dashboard/sidebar/settings updates.
   */
  bus!: EmaBus;

  /**
   * Business controller entrypoint used by UI adapters and other consumers.
   */
  controller!: EmaController;

  private runtimeStarted = false;

  /**
   * Creates an uninitialized server container.
   *
   * Use {@link Server.create} for normal startup so all dependencies are wired
   * and started in the expected order.
   *
   */
  private constructor() {}

  /**
   * Creates a server container, initializes storage, and starts runtime by
   * default for backwards compatibility.
   *
   * @param fs - Filesystem abstraction used for snapshot files.
   * @param options - Optional bootstrap and lifecycle controls.
   * @returns Server instance with storage initialized.
   */
  static async create(
    fs: Fs = new RealFs(),
    options: ServerCreateOptions = {},
  ): Promise<Server> {
    await GlobalConfig.load(fs, { bootstrap: options.bootstrap });

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
    server.bus = new EmaBus();
    server.controller = new EmaController(server);

    await server.initializeStorage();
    await server.restoreDevelopmentDataIfNeeded();
    await server.dbService.createIndices();
    server.logger.info("Database indices created");

    const hasGlobalConfig = await server.loadGlobalConfig();

    if ((options.start ?? true) && hasGlobalConfig) {
      await server.start();
    } else if (options.start ?? true) {
      server.logger.warn(
        "Global config missing, runtime not started until setup completes",
      );
    }

    return server;
  }

  /** Connects database resources and prepares the storage service. */
  async initializeStorage(): Promise<void> {
    if (this.dbService) {
      return;
    }
    this.dbService = await DBService.create(this.fs);
    this.logger.info("Database service initialized", {
      mongo: GlobalConfig.mongo,
      dataRoot: GlobalConfig.system.dataRoot,
      lancedb: {
        mode: GlobalConfig.system.mode,
        path: getLanceDbDirectory(),
        resetOnStart: GlobalConfig.system.mode === "dev",
      },
    });
  }

  /**
   * Restores the default development snapshot when using dev memory Mongo.
   *
   * @returns true when a snapshot was restored.
   */
  async restoreDevelopmentDataIfNeeded(): Promise<boolean> {
    if (!GlobalConfig.bootstrapConfig.devBootstrap.restoreDefaultSnapshot) {
      return false;
    }
    const restored = await this.dbService.restoreFromSnapshot("default");
    if (!restored) {
      this.logger.warn("Failed to restore snapshot", { name: "default" });
      return false;
    }
    this.logger.info("Snapshot restored", { name: "default" });
    return true;
  }

  /** Returns whether owner and database-backed global config both exist. */
  async hasRequiredSetup(): Promise<boolean> {
    const [owner, globalConfig] = await Promise.all([
      this.dbService.getDefaultUser(),
      this.dbService.globalConfigDB.getGlobalConfig(),
    ]);
    return Boolean(owner && globalConfig);
  }

  /**
   * Loads database-backed GlobalConfig into the process singleton.
   *
   * @returns true when a database record was found.
   */
  async loadGlobalConfig(): Promise<boolean> {
    const record = await this.dbService.globalConfigDB.getGlobalConfig();
    if (record) {
      GlobalConfig.applyRecord(record);
      this.logger.info("Global config loaded from database");
      return true;
    }
    this.logger.warn("Global config missing");
    return false;
  }

  /** Reloads database-backed GlobalConfig after setup or settings updates. */
  async reloadGlobalConfig(): Promise<boolean> {
    return await this.loadGlobalConfig();
  }

  /** Starts the actor runtime services. */
  async start(): Promise<void> {
    if (this.runtimeStarted) {
      return;
    }
    await this.dbService.createIndices();
    this.startLongTermMemoryVectorIndex();
    this.gateway = new Gateway(this);
    this.actorRegistry = new ActorRegistry(this);
    this.memoryManager = new MemoryManager(this);
    this.scheduler = await AgendaScheduler.create(this.dbService.mongo);
    this.logger.info("Scheduler initialized");

    await this.actorRegistry.restoreAll();
    this.logger.info("Actors restored");

    await this.scheduler.start(createJobHandlers(this));
    this.logger.info("Scheduler started");
    this.actorRegistry.startBootInitAll();
    this.runtimeStarted = true;
    this.logger.info("Server ready");
  }

  private startLongTermMemoryVectorIndex(): void {
    const config = GlobalConfig.defaultEmbedding;
    const selected =
      config.provider === "openai" ? config.openai : config.google;
    this.logger.info("Long term memory vector index started", {
      provider: config.provider,
      model: selected.model,
    });
    void this.dbService.longTermMemoryDB
      .ensureVectorIndex(config)
      .then((status) => {
        if (status.state === "ready") {
          this.logger.info("Long term memory vector index ready", status);
          return;
        }
        if (status.state === "degraded") {
          this.logger.warn("Long term memory vector index degraded", status);
          return;
        }
        this.logger.warn("Long term memory vector index failed", status);
      })
      .catch((error) => {
        this.logger.error(
          "Failed to start long term memory vector index, continuing runtime",
          error,
        );
      });
  }

  /** Stops runtime and database resources owned by this server. */
  async stop(): Promise<void> {
    if (this.scheduler) {
      await this.scheduler.stop();
    }
    if (this.dbService) {
      await this.dbService.mongo.close();
      await this.dbService.lancedb.close();
    }
    this.runtimeStarted = false;
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
}
