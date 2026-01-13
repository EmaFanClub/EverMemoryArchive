/**
 * This module defines the concept of the EverMemoryArchive.
 *
 * - UI is the user interface. Users can interacts with ema using WebUI, NapCatQQ, or TUI.
 * - Ema Actor is the actor that takes user inputs and generates outputs.
 *   - Visit an actor instance using {@link ActorClient}, implemented by `ActorHttpClient` and `ActorWorker`.
 *   - In frontend, an `ActorHttpClient` connects to some actor in remote server.
 *   - In frontend or backend, an `ActorWorker` uses LLM to implement the actor logic.
 * - LLM is the LLM that is responsible for the generation of the response.
 *   - Visit LLM providers using {@link EmaLLMClient}.
 *   - Create a stateful agent by extending {@link Agent}.
 * - Task is the unit of work that can be scheduled and run. A task can implements one or multiple interfaces:
 *   - Run an agent task with {@link AgentTaskScheduler} by providing {@link AgentTask}.
 *   - Run a cron task with {@link TimedTaskScheduler} by providing {@link TimedTask}.
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

export type { EmaLLMClient, Agent } from "./llm";
export * from "./llm";

export * from "./storage";

export type {
  AgentTask,
  AgentTaskScheduler,
  TimedTask,
  TimedTaskScheduler,
} from "./task";
export * from "./task";
