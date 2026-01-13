import type { Agent, AgentState } from "./llm";

/**
 * A task is a unit of work that can be scheduled and run.
 */
export interface Task {
  /**
   * A human-readable name of the task.
   */
  name: string;

  /**
   * An interface to format task in debug consoles.
   * If not provided, the task will be formatted as `[Task: <name>]` in debug consoles.
   */
  describe?(): string;
}

/**
 * An agent task is a task that runs with an agent.
 * - For a timed agent task, use {@link TimedTaskScheduler.iterateTimed}.
 *
 * @example
 * ```ts
 * // Runs an agent task every day at midnight forever.
 * const dailyTask: CronTask & AgentTask = {
 *   name: "daily-task",
 *   cron: "0 0 * * *",
 *   async work(agent) {
 *     for await (const date of scheduler.iterateTimed(this)) {
 *       await agent.runWithMessage({ type: "user", content: `Today is ${date}`});
 *     }
 *   },
 * };
 * scheduler.schedule(dailyTask);
 * ```
 */
export interface AgentTask<S extends AgentState = AgentState> extends Task {
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
   */
  work(agent: Agent<S>, scheduler: AgentTaskScheduler): Promise<void>;
}

/**
 * The scheduler of the agent. A scheduler manages multiple llm sessions established by agents with a sensible resource
 * limits.
 */
export interface AgentTaskScheduler {
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

/**
 * A timed task is a descriptor of a function that runs deferred or periodically.
 * ```
 */
export type TimedTask = CronTask | TickTask;

/**
 * A descriptor to run a timed task according to a cron expression.
 * - See {@link https://en.wikipedia.org/wiki/Cron} for more details.
 * - Use {@link https://crontab.guru/} to create cron expressions.
 *
 * @example
 * ```ts
 * // Runs a cron task every day at midnight forever.
 * const cronTask: CronTask = {
 *   name: "daily-task",
 *   cron: "0 0 * * *",
 * };
 * scheduler.startTimed(cronTask, (date) => {
 *   console.log(`Today is ${date}`);
 * });
 * ```
 */
export interface CronTask extends Task {
  /**
   * A cron expression of the task.
   */
  cron: string;
  /**
   * Whether the task should run only once.
   */
  once?: boolean;
}

export interface TickTask extends Task {
  /**
   * A tick interval in milliseconds.
   */
  tick: number;
  /**
   * Whether the task should run only once.
   */
  once?: boolean;
}

/**
 * A table to control a timed task.
 */
interface TimedTab {
  /**
   * Whether the timed task is cancelled.
   */
  cancelled: boolean;
  /**
   * Cancels the timed task. This function can be called multiple times safely.
   */
  cancel(): void;
}

/**
 * The scheduler of the cron task.
 */
export abstract class TimedTaskScheduler {
  /**
   * Starts a timed task to run.
   *
   * @param task - The timed task to schedule.
   * @param cb - The callback to run the timed task.
   * @returns A table to control the timed task.
   */
  abstract startTimed(
    task: CronTask,
    cb: (
      /**
       * The date of the next tick.
       */
      date: Date,
      /**
       * A table to control the timed task.
       */
      cancel: TimedTab,
    ) => void,
  ): TimedTab;

  /**
   * Returns an async generator that yields the next tick of the task.
   * todo: move implementation out of abstract `TimedTaskScheduler`
   *
   * @param task - The task to schedule.
   * @returns An async generator that yields the next tick of the task.
   *
   * @example
   * ```ts
   * // Runs a cron task every day at midnight forever.
   * const cronTask: CronTask = {
   *   name: "daily-task",
   *   cron: "0 0 * * *",
   * };
   * for await (const date of scheduler.iterateTimed(cronTask)) {
   *   console.log(`Today is ${date}`);
   * }
   */
  iterateTimed(task: CronTask): AsyncIterable<Date> {
    return {
      [Symbol.asyncIterator]: () => {
        /**
         * There are two callback that consumes each other.
         *
         * If an iterator callback is first call, `resolveResult` is set.
         * Then, the timed callback will call `resolveResult` with the date of the next tick.
         *
         * If a timed callback is first call, the date is pushed to a linked list with the date.
         * Then, the iterator callback will return the date of the next tick.
         */
        let resolveResult: ((date: Date) => void) | undefined;

        /**
         * A linked list to store the dates of the next ticks.
         */
        interface TimedList {
          /**
           * The date of the next tick.
           */
          date: Date;
          /**
           * The next node in the linked list.
           */
          next?: TimedList;
        }
        let head: TimedList | undefined;
        let tail: TimedList | undefined;

        // Starts a timed task to run.
        const tab = this.startTimed(task, (date) => {
          if (resolveResult) {
            resolveResult(date);
            resolveResult = undefined;
          } else {
            const node: TimedList = { date };
            if (head) {
              tail!.next = node;
            } else {
              head = node;
            }
            tail = node;
          }
        });

        return {
          next: async () => {
            if (tab.cancelled) {
              return { value: undefined, done: true };
            }
            if (head) {
              const node = head;
              head = node.next;
              if (!head) {
                tail = undefined;
              }
              return { value: node.date, done: false };
            }
            return new Promise((resolve) => {
              resolveResult = (value) => resolve({ value, done: false });
            });
          },
          return: async () => {
            tab.cancel();
            return { value: undefined, done: true };
          },
        };
      },
    };
  }
}
