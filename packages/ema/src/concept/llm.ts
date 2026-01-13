import type { EventEmitter } from "node:events";
import type { Message, LLMResponse } from "../schema";

/**
 * {@link EmaLLMClient} is a stateless client for the LLM, holding a physical network connection to the LLM.
 *
 * TODO: remove mini-agent's LLMClient definition.
 */
export interface EmaLLMClient {
  /**
   * Generates response from LLM.
   *
   * @param messages - List of conversation messages
   * @param tools - Optional list of Tool objects or dicts
   * @param systemPrompt - Optional system prompt to start with
   * @returns LLMResponse containing the generated content, thinking, and tool calls
   */
  generate(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string,
  ): Promise<LLMResponse>;
}

// TODO: definition of tools.
export type Tool = any;

/**
 * The state of the agent.
 * More state could be added for specific agents, e.g. `memoryBuffer` for agents who have long-term memory.
 */
export interface AgentState {
  /**
   * The system prompt of the agent.
   */
  systemPrompt: string;
  /**
   * The messages of the agent to start with.
   */
  messages: Message[];
  /**
   * The tools of the agent.
   */
  tools: Tool[];
}

export interface MutatableAgentState extends AgentState {
  /**
   * Replaces the state with a new state.
   * @param s - The state to replace with.
   */
  replace(s: AgentState): void;
}

/**
 * The state callback of the agent. You can visit the state in the callback,
 * and call the `next` function to continue to run the next callback.
 *
 * - The next function can only be called once.
 * - If the next is not called, the agent will keep state change but will not run.
 *
 * @param state - The state of the agent.
 * @param next - The next function to call.
 * @returns The state of the agent.
 *
 * @example
 * ```ts
 * // Runs with additional messages.
 * const agent = new AgentImpl();
 * agent.run(async (state, next) => {
 *   state.history.push({ type: "user", content: "Hello, World!" });
 *   await next();
 *   return state;
 * });
 * ```
 *
 * @example
 * ```ts
 * // Runs without saving history
 * const agent = new AgentImpl();
 * agent.run(async (state, next) => {
 *   const messages = state.history;
 *   state.history.push({ type: "user", content: "Hello, World!" });
 *   await next();
 *   state.history = messages;
 *   return state;
 * });
 * ```
 */
export type AgentStateCallback<S extends AgentState> = (
  state: S & MutatableAgentState,
  next: () => Promise<void>,
) => Promise<S>;

/**
 * {@link Agent} is a background-running thread that communicates with the actor.
 */
export abstract class Agent<S extends AgentState = AgentState> {
  /**
   * The event source of the agent. See {@link AgentEventSource} for more details.
   */
  abstract events: EventEmitter<AgentEventMap> & AgentEventSource;

  /**
   * Checks if the agent is running a LLM session.
   *
   * @returns Whether the agent is running.
   */
  abstract isRunning(): boolean;
  /**
   * Stops the running session unconditionally.
   *
   */
  abstract stop(): Promise<void>;

  /**
   * Runs the agent in stateless manner.
   *
   * @param state - The state to run the agent with.
   * @returns Promise resolving when the agent is idle.
   */
  execute(state: S): Promise<void> {
    return this.run(async (s, next) => {
      s.replace(state);
      await next();
      return s;
    });
  }

  /**
   * Runs the agent with an additional message in OpenAI format.
   *
   * @param message - The message to add.
   * @returns Promise resolving when the agent is idle.
   */
  runWithMessage(message: Message): Promise<void> {
    return this.run(async (s, next) => {
      s.messages.push(message);
      await next();
      return s;
    });
  }

  /**
   * Runs a state callback when the agent becomes idle. If the agent is running a LLM session, the callback will be
   * called after the session is finished.
   *
   * See {@link AgentStateCallback} for examples.
   *
   * @param stateCallback - The state callback to run the agent with.
   * @returns Promise resolving when the agent is idle.
   */
  abstract run(stateCallback: AgentStateCallback<S>): Promise<void>;
}

/**
 * The event map for the agent.
 */
export interface AgentEventMap {
  // todo: agent events. maybe:
  // 1. agent output
  // 2. special agent event, for example, we can define "memory:reorganize" to tell other components the agent is
  // reorganizing memory.
}

/** Following are extended friendly typings.  */

/**
 * The event source for the agent.
 */
export interface AgentEventSource {}
