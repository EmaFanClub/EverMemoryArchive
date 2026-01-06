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
 * // Runs with additional messages.
 * const agent = new AgentImpl();
 * agent.run(async (state, next) => {
 *   state.history.push(new Message("user", "Hello, world!"));
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
 *   state.history.push(new Message("user", "Hello, world!"));
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
    return this.run(async (s, next) => {
      s.history.push(message);
      await next();
      return s;
    });
  }
}

interface AgentTask<S extends AgentState = AgentState> {
  /**
   * A human-readable name of the task.
   */
  name: string;
  /**
   * A cron expression of the task.
   * - See {@link https://en.wikipedia.org/wiki/Cron} for more details.
   * - Use {@link https://crontab.guru/} to create cron expressions.
   *
   * If this is not provided, the task will run once.
   */
  cron?: string;

  /**
   * Runs the task with the agent and scheduler.
   *
   * @param agent - The agent to run the task with. *Note that the agent may be running when it is scheduled.*
   * @param scheduler - The scheduler to run the task with.
   * @returns Promise resolving when the task is completed.
   *
   * @example
   * ```ts
   * // Runs the task every day at midnight forever.
   * scheduler.schedule({
   *   name: "daily-task",
   *   cron: "0 0 * * *",
   *   async run(agent, scheduler) {
   *     await agent.runWithMessage(new Message("user", "Hello, world!"));
   *   },
   * });
   * ```
   *
   * @example
   * ```ts
   * // Cancels the task.
   * scheduler.schedule({
   *   name: "daily-task",
   *   cron: "0 0 * * *",
   *   async run(agent, scheduler) {
   *     await scheduler.cancel(this);
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
   * Schedules a task to run.
   *
   * @param task - The task to schedule.
   * @returns Promise resolving when the task is scheduled.
   */
  schedule(task: AgentTask): Promise<void>;
  /**
   * Cancels a task to run.
   *
   * @param task - The task to cancel.
   * @returns Promise resolving when the task is canceled.
   */
  cancel(task: AgentTask): Promise<void>;
}
