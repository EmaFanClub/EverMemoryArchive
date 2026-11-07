/**
 * @prism-shadow/ema - Core Interface Contracts
 *
 * Defines the foundational primitives for EverMemoryArchive (EMA) runtime:
 * Worlds, Actors, Context, Routers, and Transactional Input.
 *
 * Conforms to RFC-0001 (Ema Worlds and Actors).
 */

export type Id = string;

/**
 * Handle returned by resources and lifecycle attachments that can be disposed.
 */
export interface Disposable {
  dispose(): void;
}

/**
 * The handle returned by Interface(): both an abstract class constructor and a class decorator.
 */
export type IfaceHandle<T> = (abstract new (...args: never[]) => T) &
  (<C extends abstract new (...args: any[]) => any>(
    target: C,
    context?: ClassDecoratorContext | unknown
  ) => C | void);

/**
 * Penguin Interface decorator handle.
 *
 * Marks an abstract class as a Penguin Interface contract.
 * At runtime, returns the target class untouched as a structural handle.
 */
export function Interface<T = unknown>(): IfaceHandle<T> {
  function handle(target?: unknown, _context?: unknown): unknown {
    return target;
  }
  return handle as unknown as IfaceHandle<T>;
}

/**
 * Actor identity representing an EMA companion agent within a session/world.
 */
export interface EmaActor {
  /** Unique actor identifier within EMA */
  readonly id: Id;
  /** Companion display name */
  readonly name: string;
  /** Bound Penguin session ID */
  readonly session: string;
  /** Bound Penguin Agent ID */
  readonly agentId: string;
}

/**
 * Metadata for a sender of an input event.
 */
export interface EmaSender {
  /** External or platform-specific sender ID */
  readonly id: string;
  /** Sender display name / nickname */
  readonly name: string;
  /** Whether the sender is the primary companion owner */
  readonly isOwner?: boolean;
}

/**
 * Normalized input event arriving from a part within an EmaWorld.
 */
export interface EmaInput {
  /** Unique message/event ID within the world */
  readonly id: Id;
  /** World identifier, e.g. "telegram", "qq", "channel" */
  readonly world: string;
  /** Specific part identifier within the world, e.g. "channel:1234", "group:567" */
  readonly partId: string;
  /** Sender metadata */
  readonly sender: EmaSender;
  /** Inbound text content */
  readonly content: string;
  /** Millisecond timestamp */
  readonly timestamp: number;
  /** Optional referenced/quoted message ID */
  readonly replyTo?: Id;
  /** Optional raw platform metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Context passed to route handlers when reading world resources.
 */
export interface EmaRouteContext {
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
}

export type EmaRouteHandler = (ctx: EmaRouteContext) => Promise<unknown> | unknown;

export interface EmaRouteEntry {
  readonly prefix: string;
  readonly worldName?: string;
  readonly description?: string;
}

/**
 * Unified resource router where worlds mount services and actors read state.
 */
export interface EmaRouter {
  /**
   * Mounts a route handler under the specified path prefix (e.g. `/world/telegram`).
   */
  serve(pathPrefix: string, handler: EmaRouteHandler, description?: string): Disposable;

  /**
   * Reads a resource from the router by URI path.
   */
  read<T = unknown>(uri: string): Promise<T>;

  /**
   * Lists all mounted route prefixes.
   */
  listRoutes(): ReadonlyArray<EmaRouteEntry>;
}

/**
 * Input batcher for coalescing rapid incoming inputs into atomic transactions.
 */
export interface EmaInputBatcher {
  /**
   * Pushes a normalized input into the queue.
   */
  push(input: EmaInput): void;

  /**
   * Subscribes to batched/transactional input emissions.
   */
  onBatch(listener: (batch: ReadonlyArray<EmaInput>) => void | Promise<void>): Disposable;
}

/**
 * Representation of a specific part within an EmaWorld.
 */
export interface EmaWorldPart {
  readonly id: Id;
  readonly type: "channel" | "group" | "dm" | "room" | "thread" | string;
  readonly name: string;
  readonly topic?: string;
  readonly memberCount?: number;
}

/**
 * Registry of active worlds in the EMA runtime.
 */
export interface EmaWorldRegistry {
  register(name: string, world: EmaWorld): Disposable;
  get(name: string): EmaWorld | undefined;
  list(): ReadonlyArray<{ name: string; world: EmaWorld }>;
}

/**
 * Runtime execution context provided to an EmaWorld on startup.
 */
export interface EmaCtx {
  /** Unified resource router */
  readonly router: EmaRouter;
  /** Input batcher queue */
  readonly inputBatcher: EmaInputBatcher;
  /** World registry */
  readonly registry: EmaWorldRegistry;
}

/**
 * Base abstract class for EverMemoryArchive Worlds.
 *
 * Declared with Penguin's @Interface() decorator.
 * Represents an external realm (Telegram, QQ, Penguin Channel, etc.)
 * with lifecycle control and actor interaction capabilities.
 */
@Interface()
export abstract class EmaWorld {
  /**
   * Starts the world lifecycle: initializes network listeners,
   * mounts resource routes on ctx.router, and connects input ingestion.
   */
  abstract start(ctx: EmaCtx): Disposable;

  /**
   * Interacts with a specific part of the world on behalf of an EMA Actor.
   */
  abstract interact(
    ctx: EmaCtx,
    actor: EmaActor,
    id: Id,
    ...args: unknown[]
  ): Disposable;
}
