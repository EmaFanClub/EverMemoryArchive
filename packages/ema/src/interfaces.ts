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

import { Interface } from "@prismshadow/penguin-core/plugin";

export type IfaceHandle<T = unknown> = ReturnType<typeof Interface<T>>;
export { Interface };

/**
 * Actor kinds supported by EverMemoryArchive runtime.
 * - "single-session": Dispatches all turns to a single dedicated session.
 * - "multiple-agent": Dispatches turns through a unique router session acting as the sole entrypoint.
 */
export type EmaActorKind = "single-session" | "multiple-agent";

/**
 * Base actor fields common across all actor topologies.
 */
export interface EmaActorBase {
  /** Unique actor identifier within EMA */
  readonly id: Id;
  /** Companion display name */
  readonly name: string;
  /** Bound Penguin Agent ID */
  readonly agentId: string;
}

/**
 * Single-session actor: directly dispatches to a single configured or created session.
 */
export interface EmaSingleSessionActor extends EmaActorBase {
  readonly kind?: "single-session";
  /** Bound Penguin session ID */
  readonly session: string;
  /** Optional explicit session ID configuration */
  readonly sessionId?: string;
}

/**
 * Multiple-agent actor: dispatches through a unique router session created and initialized
 * upon receiving the first message, serving as the sole entrypoint.
 */
export interface EmaMultipleAgentActor extends EmaActorBase {
  readonly kind: "multiple-agent";
  /** Router session ID (sole entrypoint for this multiple-agent actor) */
  readonly routerSessionId?: string;
  /** Primary session pointer (aliases routerSessionId once created) */
  readonly session: string;
  /** Agent ID that runs the router session (defaults to agentId) */
  readonly routerAgentId?: string;
  /** Initialization prompt for the router session */
  readonly routerInitPrompt?: string;
  /** Whether the router session has been created and initialized */
  readonly isInitialized?: boolean;
  /** Sub-agents / specialist workers associated with this actor */
  readonly agents?: ReadonlyArray<{
    readonly agentId: string;
    readonly role?: string;
    readonly title?: string;
  }>;
}

/**
 * Actor identity representing an EMA companion agent within a session/world.
 * Supports both single-session and multiple-agent topologies.
 */
export type EmaActor = EmaSingleSessionActor | EmaMultipleAgentActor;

/**
 * Configuration schema for initializing or customizing an actor.
 */
export interface EmaSingleSessionActorConfig {
  id?: string;
  name?: string;
  agentId?: string;
  kind?: "single-session";
  sessionId?: string;
}

export interface EmaMultipleAgentActorConfig {
  id?: string;
  name?: string;
  agentId?: string;
  kind: "multiple-agent";
  routerSessionId?: string;
  routerAgentId?: string;
  routerInitPrompt?: string;
  isInitialized?: boolean;
  agents?: ReadonlyArray<{
    readonly agentId: string;
    readonly role?: string;
    readonly title?: string;
  }>;
}

export type EmaActorConfig = EmaSingleSessionActorConfig | EmaMultipleAgentActorConfig;

/**
 * Resolves the kind of an actor, defaulting to "single-session".
 */
export function getActorKind(actor?: Partial<EmaActor> | EmaActorConfig | null): EmaActorKind {
  return actor?.kind === "multiple-agent" ? "multiple-agent" : "single-session";
}

/**
 * Resolves the active entry session ID for an actor.
 */
export function getActorEntrySession(actor?: Partial<EmaActor> | EmaActorConfig | null): string | undefined {
  if (!actor) return undefined;
  if (actor.kind === "multiple-agent") {
    return actor.routerSessionId || ("session" in actor ? (actor as EmaMultipleAgentActor).session : undefined);
  }
  return ("sessionId" in actor && actor.sessionId)
    ? actor.sessionId
    : ("session" in actor ? (actor as EmaSingleSessionActor).session : undefined);
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
  readonly body?: unknown;
  readonly method?: string;
  readonly headers?: Headers;
  readonly req?: Request;
  readonly raw?: unknown;
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
  read<T = unknown>(uri: string, init?: RequestInit): Promise<T>;

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
  abstract interact(ctx: EmaCtx, actor: EmaActor, id: Id, ...args: unknown[]): Disposable;
}
