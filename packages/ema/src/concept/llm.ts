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
   * @returns LLMResponse containing the generated content, thinking, and tool calls
   */
  generate(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;
}

// TODO: definition of tools.
export type Tool = any;

/**
 * The state of the agent.
 * More state could be added for specific agents, e.g. `memoryBuffer` for agents who have long-term memory.
 */
interface AgentState {
  /**
   * The history of the agent.
   */
  history: Message[];
  /**
   * The tools of the agent.
   */
  tools: Tool[];
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
 * // Run with additional messages.
 * const agent = new Agent();
 * agent.run((state, next) => {
 *   state.history.push(new Message("user", "Hello, world!"));
 *   next();
 *   return state;
 * });
 * ```
 *
 * @example
 * ```ts
 * // Run without saving history
 * const agent = new Agent();
 * agent.run((state, next) => {
 *   const messages = state.history;
 *   state.history.push(new Message("user", "Hello, world!"));
 *   next();
 *   state.history = messages;
 *   return state;
 * });
 * ```
 */
export type AgentStateCallback<S extends AgentState> = (
  state: S,
  next: () => void,
) => S;

/**
 * {@link Agent} is a background-running thread that communicates with the actor.
 */
export abstract class Agent<S extends AgentState = AgentState> {
  /**
   * Runs the agent with a state callback.
   *
   * See {@link AgentStateCallback} for examples.
   *
   * @param stateCallback - The state callback to run the agent with.
   * @returns void
   */
  abstract run(stateCallback: AgentStateCallback<S>): Promise<void>;

  /**
   * Runs the agent with a user message.
   *
   * @param message - The message to run the agent with.
   * @returns void
   */
  runWithMessage(message: Message): Promise<void> {
    return this.run((s, next) => {
      s.history.push(message);
      next();
      return s;
    });
  }
}
