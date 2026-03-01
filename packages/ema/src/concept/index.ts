/**
 * Conceptual architecture of EverMemoryArchive (aligned with memory runtime design).
 *
 * High-level flow:
 * 1. UI sends user input to server APIs.
 * 2. Server resolves `(user, actor, conversation)` and routes to an `ActorWorker`.
 * 3. `ActorWorker` serializes buffer writes, queues inputs, and may interrupt an in-flight run.
 * 4. `Agent` executes an LLM+tool loop and emits structured events.
 * 5. `MemoryManager` persists conversation buffer and memory records, then injects memory into prompts.
 * 6. `Scheduler` drives foreground/background jobs (for reminders and memory organization).
 *
 * ```mermaid
 * graph TD
 *   subgraph UI["UI Layer"]
 *     WebUI["Web UI"]
 *     Clients["Other Clients"]
 *   end
 *
 *   subgraph Runtime["EMA Runtime"]
 *     Server["Server"]
 *     Actor["ActorWorker"]
 *     Agent["Agent (LLM + Tools Loop)"]
 *     Memory["MemoryManager"]
 *     Scheduler["Scheduler"]
 *   end
 *
 *   subgraph Storage["Storage Layer"]
 *     Mongo["MongoDB"]
 *     Lance["LanceDB (Vector Search)"]
 *   end
 *
 *   subgraph LLM["LLM Providers"]
 *     OpenAI["OpenAI-Compatible"]
 *     Google["Google GenAI"]
 *   end
 *
 *   UI --> Server
 *   Server --> Actor
 *   Actor --> Agent
 *   Agent --> LLM
 *   Actor --> Memory
 *   Memory --> Storage
 *   Server --> Scheduler
 *   Scheduler --> Actor
 * ```
 *
 * @module @internals/concept
 */

export * from "./actor";
export * from "./llm";
export * from "./storage";
