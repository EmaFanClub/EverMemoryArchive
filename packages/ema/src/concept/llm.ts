import type { EventEmitter } from "node:events";
import type { Message, LLMResponse } from "../schema";
import type { Tool } from "../tools/base";
import type { EmaReply } from "../tools/ema_reply_tool";

/**
 * LLM providers supported by EMA runtime.
 */
export enum LLMProvider {
  GOOGLE = "google",
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
}

/**
 * Stateless LLM client abstraction used by agent runtime.
 */
export declare class LLMClient {
  /**
   * Generates one model turn from current context.
   *
   * @param messages - Conversation history in EMA schema.
   * @param tools - Optional tool definitions.
   * @param systemPrompt - Optional system prompt for this call.
   * @param signal - Optional abort signal.
   */
  generate(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<LLMResponse>;
}

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

/** Constant mapping of agent event names for iteration. */
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

/** The runtime state of the agent. */
export type AgentState = {
  systemPrompt: string;
  messages: Message[];
  tools: Tool[];
  toolContext?: unknown;
};

/** Callback type for running the agent with a given state. */
export type AgentStateCallback = (
  next: (state: AgentState) => Promise<void>,
) => Promise<void>;

/** Agent abstraction (event-driven LLM + tool execution loop). */
export declare class Agent {
  events: AgentEventsEmitter;
  isRunning(): boolean;
  abort(): Promise<void>;
  runWithState(state: AgentState): Promise<void>;
  run(callback: AgentStateCallback): Promise<void>;
}

/**
 * Mapping of job names to payload shape.
 */
export type JobDataMap = Record<string, Record<string, unknown>>;

/**
 * Union of all job names.
 */
export type JobName = keyof JobDataMap & string;

/**
 * Data type for a specific job name.
 * @typeParam K - The job name.
 */
export type JobData<K extends JobName> = JobDataMap[K];

/**
 * Union of all job data types.
 */
export type JobDataUnion = JobData<JobName>;

/**
 * Scheduler job shape.
 */
export type Job<K extends JobName = JobName> = {
  attrs: {
    name: K;
    data: JobData<K>;
  };
};

/**
 * Scheduler job identifier.
 */
export type JobId = string;

/**
 * Input data for scheduling a job.
 */
export interface JobSpec<K extends JobName = JobName> {
  /**
   * The job name used to resolve a handler.
   */
  name: K;
  /**
   * When the job should run (Unix timestamp in milliseconds).
   */
  runAt: number;
  /**
   * Handler-specific data.
   */
  data: JobData<K>;
}

/**
 * Input data for scheduling a recurring job.
 */
export interface JobEverySpec<K extends JobName = JobName> {
  /**
   * The job name used to resolve a handler.
   */
  name: K;
  /**
   * Earliest time the recurring schedule becomes active (Unix timestamp in milliseconds).
   */
  runAt: number;
  /**
   * How often the job should repeat (Agenda interval string or milliseconds).
   */
  interval: string | number;
  /**
   * Handler-specific data.
   */
  data: JobData<K>;
  /**
   * Uniqueness criteria for deduplicating recurring jobs.
   */
  unique?: Record<string, unknown>;
}

/**
 * Scheduler job handler signature.
 */
export type JobHandler<K extends JobName = JobName> = (
  job: Job<K>,
  done?: (error?: Error) => void,
) => Promise<void> | void;

/**
 * Type guard to narrow a job to a specific name/data pair.
 * @param job - The job instance to check.
 * @param name - The expected job name.
 * @returns True when the job matches the provided name.
 */
export function isJob<K extends JobName>(
  job: Job | null | undefined,
  name: K,
): job is Job<K> {
  return !!job && job.attrs.name === name;
}

/**
 * Scheduler interface for managing job lifecycle.
 */
export interface Scheduler {
  /**
   * Starts the scheduler loop.
   * @param handlers - Mapping of job names to their handlers.
   * @returns Promise resolving when the scheduler is started.
   */
  start(handlers: JobHandlerMap): Promise<void>;
  /**
   * Stops the scheduler loop.
   * @returns Promise resolving when the scheduler is stopped.
   */
  stop(): Promise<void>;
  /**
   * Schedules a job for execution.
   * @param job - The job to schedule.
   * @returns Promise resolving to the job id.
   */
  schedule(job: JobSpec): Promise<JobId>;
  /**
   * Reschedules an existing queued job with new runAt/data.
   * @param id - The job identifier.
   * @param job - The new job data.
   * @returns Promise resolving to true if rescheduled, false otherwise.
   */
  reschedule(id: JobId, job: JobSpec): Promise<boolean>;
  /**
   * Cancels a pending job by id.
   * @param id - The job identifier.
   * @returns Promise resolving to true if canceled, false otherwise.
   */
  cancel(id: JobId): Promise<boolean>;
  /**
   * Schedules a recurring job.
   * @param job - The recurring job data.
   * @returns Promise resolving to the job id.
   */
  scheduleEvery(job: JobEverySpec): Promise<JobId>;
  /**
   * Reschedules an existing recurring job.
   * @param id - The job identifier.
   * @param job - The new recurring job data.
   * @returns Promise resolving to true if rescheduled, false otherwise.
   */
  rescheduleEvery(id: JobId, job: JobEverySpec): Promise<boolean>;
  /**
   * Gets a job by id.
   * @param id - The job identifier.
   * @returns Promise resolving to the job if found.
   */
  getJob(id: JobId): Promise<Job | null>;
  /**
   * Lists jobs with an optional filter.
   * @param filter - Filter for jobs.
   * @returns Promise resolving to matching jobs.
   */
  listJobs(filter?: Record<string, unknown>): Promise<Job[]>;
}

/**
 * Mapping of job names to their handlers.
 */
export type JobHandlerMap = Partial<{
  [K in JobName]: JobHandler<K>;
}>;

/**
 * Runtime status of the scheduler.
 */
export type SchedulerStatus = "idle" | "running" | "stopping";
