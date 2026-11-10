/**
 * @prism-shadow/ema - Actor Router & Session Coordinator
 *
 * Implements the Actor Router layer for EverMemoryArchive:
 * 1. Single-session actor: Direct dispatch to a configured or dedicated session.
 * 2. Multiple-agent actor with router session: The router session serves as the
 *    sole entrypoint for the actor, created on receiving message and initialized.
 */

import type {
  EmaActor,
  EmaActorConfig,
  EmaActorKind,
  EmaMultipleAgentActor,
  EmaSingleSessionActor,
} from "./interfaces.js";
import { getActorKind } from "./interfaces.js";

export { getActorKind, getActorEntrySession } from "./interfaces.js";

/**
 * Standard default initialization prompt for multiple-agent router sessions.
 */
export const DEFAULT_ROUTER_INIT_PROMPT =
  "You are the primary Router Session for the multiple-agent companion actor. " +
  "You serve as the sole entrypoint for incoming inputs across all worlds. " +
  "Your duties are: coordinate specialized sub-agents, maintain conversational continuity, " +
  "and dispatch responses back to the origin channel.";

/**
 * Minimal host interface required to manage sessions and run turns.
 */
export interface ActorSessionHost {
  createSession(options?: { agentId?: string }): Promise<{ sessionId: string }>;
  run(
    sessionId: string,
    inputs: Array<{ text: string }>,
  ): Promise<{ sessionId: string; queued: boolean } | unknown>;
  sessionStatus?(sessionId: string): string;
}

export interface ActorSessionResolutionResult {
  sessionId: string;
  isNew: boolean;
  isRouter: boolean;
  initialized: boolean;
  actor: EmaActor;
}

/**
 * Manages the lifecycle and routing contracts for EMA Actors.
 */
export class EmaActorRouter {
  private initLocks = new Map<string, Promise<string>>();

  /**
   * Resolves or dynamically provisions the active entrypoint session for an actor.
   *
   * Invariants:
   * 1. If kind is "single-session": returns preconfigured sessionId or creates a single session.
   * 2. If kind is "multiple-agent": lazy-creates and initializes the unique router session
   *    upon receiving the first message. Subsequent messages route to the same unique router session.
   */
  async resolveActorSession(
    actorConfig: EmaActorConfig,
    host: ActorSessionHost,
    options: {
      onMessageReceived?: boolean;
      defaultAgentId?: string;
    } = {},
  ): Promise<ActorSessionResolutionResult> {
    const kind = getActorKind(actorConfig);
    const actorId = actorConfig.id || "actor-default";
    const actorName = actorConfig.name || "Ema Companion";
    const agentId = actorConfig.agentId || options.defaultAgentId || "emafanclub_ema_dev";

    // 1. Single-session Actor
    if (kind === "single-session") {
      const singleConfig = actorConfig as { sessionId?: string };
      let sessionId = singleConfig.sessionId;
      let isNew = false;

      if (!sessionId) {
        const created = await host.createSession({ agentId });
        sessionId = created.sessionId;
        isNew = true;
      }

      const actor: EmaSingleSessionActor = {
        id: actorId,
        name: actorName,
        kind: "single-session",
        agentId,
        session: sessionId,
        sessionId,
      };

      return {
        sessionId,
        isNew,
        isRouter: false,
        initialized: true,
        actor,
      };
    }

    // 2. Multiple-agent Actor with Router Session
    const multiConfig = actorConfig as {
      routerSessionId?: string;
      routerAgentId?: string;
      routerInitPrompt?: string;
      isInitialized?: boolean;
      agents?: EmaMultipleAgentActor["agents"];
    };

    const routerAgentId = multiConfig.routerAgentId || agentId;
    const initPrompt = multiConfig.routerInitPrompt || DEFAULT_ROUTER_INIT_PROMPT;

    // Fast-path: Router session already provisioned and initialized
    if (multiConfig.routerSessionId) {
      const actor: EmaMultipleAgentActor = {
        id: actorId,
        name: actorName,
        kind: "multiple-agent",
        agentId,
        routerAgentId,
        routerSessionId: multiConfig.routerSessionId,
        session: multiConfig.routerSessionId,
        routerInitPrompt: initPrompt,
        isInitialized: multiConfig.isInitialized ?? true,
        agents: multiConfig.agents,
      };

      return {
        sessionId: multiConfig.routerSessionId,
        isNew: false,
        isRouter: true,
        initialized: actor.isInitialized ?? true,
        actor,
      };
    }

    // Router session must be created on receiving message and initialized.
    // Use lock to coalesce concurrent arrivals into the single unique router session.
    let initPromise = this.initLocks.get(actorId);
    let isNew = false;

    if (!initPromise) {
      initPromise = (async () => {
        isNew = true;
        const created = await host.createSession({ agentId: routerAgentId });
        const routerSessionId = created.sessionId;

        // Initialize router session
        await host.run(routerSessionId, [{ text: initPrompt }]);

        return routerSessionId;
      })();

      this.initLocks.set(actorId, initPromise);
    }

    let routerSessionId: string;
    try {
      routerSessionId = await initPromise;
    } finally {
      this.initLocks.delete(actorId);
    }

    const actor: EmaMultipleAgentActor = {
      id: actorId,
      name: actorName,
      kind: "multiple-agent",
      agentId,
      routerAgentId,
      routerSessionId,
      session: routerSessionId,
      routerInitPrompt: initPrompt,
      isInitialized: true,
      agents: multiConfig.agents,
    };

    return {
      sessionId: routerSessionId,
      isNew,
      isRouter: true,
      initialized: true,
      actor,
    };
  }
}
