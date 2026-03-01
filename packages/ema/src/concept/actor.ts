import type { EventEmitter } from "node:events";
import type { Content as InputContent } from "../schema";
import type { AgentEventName, AgentEvent, AgentEventUnion } from "./llm";

/**
 * The scope information for the actor.
 */
export interface ActorScope {
  actorId: number;
  userId: number;
  conversationId: number;
}

/**
 * A batch of actor inputs in one request.
 */
export type ActorInputs = InputContent[];

/**
 * The status of the actor.
 */
export type ActorStatus = "preparing" | "running" | "idle";

/**
 * A message from the actor.
 */
export interface ActorMessageEvent {
  /** The kind of the event. */
  kind: "message";
  /** The content of the message. */
  content: string;
}

/**
 * An event forwarded from the agent.
 */
export interface ActorAgentEvent {
  /** The kind of the event. */
  kind: AgentEventName;
  /** The content of the message. */
  content: AgentEventUnion;
}

/**
 * The event map for actor events.
 */
export interface ActorEventMap {
  message: [ActorMessageEvent];
  agent: [ActorAgentEvent];
}

/**
 * Union of actor event names.
 */
export type ActorEventName = keyof ActorEventMap;

/**
 * Type mapping of actor event names to their corresponding event data types.
 */
export type ActorEvent<K extends ActorEventName> = ActorEventMap[K][0];

/**
 * Union type of all actor event contents.
 */
export type ActorEventUnion = ActorEvent<ActorEventName>;

/**
 * Constant mapping of actor event names for iteration.
 */
export const ActorEventNames: Record<ActorEventName, ActorEventName> = {
  message: "message",
  agent: "agent",
};

/**
 * Event source interface for the actor.
 */
export interface ActorEventSource {
  on<K extends ActorEventName>(
    event: K,
    handler: (content: ActorEvent<K>) => void,
  ): this;
  off<K extends ActorEventName>(
    event: K,
    handler: (content: ActorEvent<K>) => void,
  ): this;
  once<K extends ActorEventName>(
    event: K,
    handler: (content: ActorEvent<K>) => void,
  ): this;
  emit<K extends ActorEventName>(event: K, content: ActorEvent<K>): boolean;
}

/**
 * Typed event emitter for actor events.
 */
export type ActorEventsEmitter = EventEmitter<ActorEventMap> & ActorEventSource;

/**
 * Type guard that narrows an actor event to a specific agent event (or any agent event).
 */
export function isAgentEvent<K extends AgentEventName | undefined>(
  event: ActorEventUnion,
  kind?: K,
): event is ActorAgentEvent &
  (K extends AgentEventName
    ? { kind: K; content: AgentEvent<K> }
    : ActorAgentEvent) {
  if (!event) return false;
  if (event.kind === "message") return false;
  return kind ? event.kind === kind : true;
}

/**
 * A facade of the actor functionalities between the server (system) and the agent (actor).
 */
export declare class ActorWorker {
  /**
   * Event emitter for actor events.
   */
  readonly events: ActorEventsEmitter;
  /**
   * Enqueues inputs and runs the agent sequentially for this actor.
   * @param inputs - Batch of user inputs for a single request.
   * @param addToBuffer - Whether to persist inputs to conversation buffer.
   */
  work(inputs: ActorInputs, addToBuffer?: boolean): Promise<void>;
  /**
   * Reports whether the actor is currently preparing or running.
   */
  isBusy(): boolean;
}
