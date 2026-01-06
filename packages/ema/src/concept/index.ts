/**
 * This module defines the concept of the EverMemoryArchive.
 *
 * - UI is the user interface. Users can interacts with ema using WebUI, NapCatQQ, or TUI.
 * - Ema Actor is the actor that takes user inputs and generates outputs.
 *   - Visit an actor instance using {@link ActorClient}.
 * - LLM is the LLM that is responsible for the generation of the response.
 *   - Visit llm providers using {@link EmaLLMClient}.
 *   - Create a stateful agent by extending {@link Agent}.
 *   - Run a task with {@link AgentScheduler} by providing {@link AgentTask}.
 * - Storage is the storage that is responsible for the storage of the data.
 *
 * ```mermaid
 * graph TD
 *     %% UI Layer
 *     subgraph ui_layer ["UI Layer"]
 *         direction TB
 *         WebUI[Web UI]
 *         NapCat[NapCatQQ]
 *         TUI[Terminal UI]
 *     end
 *
 *     %% Ema Actor
 *     Actor[Ema Actor]
 *
 *     %% Storage Layer
 *     subgraph storage_group ["Storage Layer"]
 *         direction TB
 *         MongoDB[MongoDB]
 *         LanceDB[LanceDB]
 *     end
 *
 *     %% LLM Layer
 *     subgraph llm_group ["LLM Layer"]
 *         direction TB
 *         OpenAI[OpenAI]
 *         Google[Google GenAI]
 *     end
 *
 *     %% Relationships - vertical flow
 *     ui_layer <--> Actor
 *     Actor --> storage_group
 *     Actor --> llm_group
 * ```
 *
 * @module @internals/concept
 */

export { type ActorClient } from "./actor";
export * from "./actor";

export type { EmaLLMClient, Agent, AgentTask, AgentScheduler } from "./llm";
export * from "./llm";

export * from "./storage";

// todo: move me to a separate file.
/**
 * A cron tab is a descriptor of a cron job.
 *
 * @example
 * ```ts
 * const cronTab: CronTab = {
 *   name: "daily-task",
 *   cron: "0 0 * * *",
 * };
 * ```
 */
export interface CronTab {
  /**
   * A human-readable name of the cron tab.
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
}
