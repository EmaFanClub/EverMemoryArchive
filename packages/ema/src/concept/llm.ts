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
export interface AgentState {
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
  state: S,
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
   * Runs the agent with a user message.
   *
   * @param message - The message to add.
   * @returns void
   */
  runWithMessage(message: Message): Promise<void> {
    return this.run(async (s, next) => {
      s.history.push(message);
      await next();
      return s;
    });
  }

  /**
   * Runs the agent with a state callback. The agent will ensure that it is idle when the callback is called.
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
  // 2. special agent event, for example, we can define "memory:reorgnize" to tell other components the agent is reorgnizing memory.
}

export interface AgentTask<S extends AgentState = AgentState> {
  /**
   * A human-readable name of the task.
   */
  name: string;

  /**
   * The agent to run the task with.
   * If not provided, the task will run with a new agent.
   */
  agent?: Agent<S>;

  /**
   * Runs the task with the agent and schedule context.
   *
   * @param agent - The agent to run the task with. *Note that the agent may be running when it is scheduled.*
   * @param scheduler - The scheduler to run the task with.
   * @returns Promise resolving when the task is completed.
   *
   * @example
   * ```ts
   * // Runs the task every day at midnight forever.
   * const cronTab: CronTab = {
   *   name: "daily-task",
   *   cron: "0 0 * * *",
   * };
   * scheduler.schedule({
   *   name: "daily-task",
   *   async run(agent, scheduler) {
   *     while(nextTick(cronTab)) {
   *       await agent.runWithMessage({ type: "user", content: "Hello, World!" });
   *     }
   *   },
   * });
   * ```
   */
  run(agent: Agent<S>, scheduler: AgentScheduler): Promise<void>;
}

/**
 * The scheduler of the agent. A scheduler manages multiple llm sessions with a sensible resource limits.
 */
export interface AgentScheduler {
  /**
   * Runs a one-shot task.
   *
   * @param cb - The callback to run the task.
   * @returns Promise resolving when the task is completed.
   */
  run<S extends AgentState = AgentState>(
    cb: (agent: Agent<S>) => Promise<void>,
  ): Promise<void>;
  /**
   * Schedules a task to run.
   *
   * @param task - The task to schedule.
   * @returns Promise resolving when the task is scheduled.
   */
  schedule(task: AgentTask): Promise<void>;
  /**
   * Waits for the agent to be idle.
   *
   * @param agent - The agent to wait for.
   * @param timeout - The timeout in milliseconds. If not provided, the agent will wait indefinitely.
   * @returns Promise resolving when the agent is idle or the timeout is reached.
   */
  waitForIdle(agent: Agent, timeout?: number): Promise<void>;
}

/** Following are extended friendly typings.  */

/**
 * The event source for the agent.
 */
export interface AgentEventSource {}
