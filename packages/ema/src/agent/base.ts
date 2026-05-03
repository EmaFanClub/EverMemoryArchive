import { EventEmitter } from "node:events";

import type { Message } from "../shared/schema";
import type { Tool, ToolContext } from "../tools/base";
import type { EmaReply } from "../tools/ema_reply_tool";

/** Event emitted when the agent finishes a run. */
export interface RunFinishedEvent {
  ok: boolean;
  msg: string;
  error?: Error;
}

/* Emitted when the ema_reply tool is called successfully. */
export interface EmaReplyReceivedEvent {
  reply: EmaReply;
}

/** Map of agent event names to their corresponding event data types. */
export interface AgentEventMap {
  runFinished: [RunFinishedEvent];
  emaReplyReceived: [EmaReplyReceivedEvent];
}

/** Union type of all agent event names. */
export type AgentEventName = keyof AgentEventMap;

/** Type mapping of agent event names to their corresponding event data types. */
export type AgentEvent<K extends AgentEventName> = AgentEventMap[K][0];

/** Union type of all agent event contents. */
export type AgentEventUnion = AgentEvent<AgentEventName>;

/** Constant mapping of agent event names for iteration */
export const AgentEventNames: Record<AgentEventName, AgentEventName> = {
  runFinished: "runFinished",
  emaReplyReceived: "emaReplyReceived",
};

/** Event source interface for the agent. */
export interface AgentEventSource {
  on<K extends AgentEventName>(
    event: K,
    handler: (content: AgentEvent<K>) => void,
  ): this;
  off<K extends AgentEventName>(
    event: K,
    handler: (content: AgentEvent<K>) => void,
  ): this;
  once<K extends AgentEventName>(
    event: K,
    handler: (content: AgentEvent<K>) => void,
  ): this;
  emit<K extends AgentEventName>(event: K, content: AgentEvent<K>): boolean;
}

export type AgentEventsEmitter = EventEmitter<AgentEventMap> & AgentEventSource;

/** The state of the agent. */
export type AgentState = {
  systemPrompt: string;
  messages: Message[];
  tools: Tool[];
  toolContext?: ToolContext;
};

/** Callback type for running the agent with a given state. */
export type AgentStateCallback = (
  next: (state: AgentState) => Promise<void>,
) => Promise<void>;
