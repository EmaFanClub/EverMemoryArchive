/**
 * Scheduler domain types and interfaces for Agenda-backed scheduling.
 *
 * The scheduler API remains stable while relying on Agenda's job runtime model.
 */
import type { JobDataMap } from "./jobs";
import type { Job as AgendaJob } from "@hokify/agenda";
import type { Filter } from "mongodb-agenda";

/**
 * Union of all job names.
 */
export type JobName = keyof JobDataMap;

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
 * Agenda job type with EMA data typing.
 */
export type Job<K extends JobName = JobName> = AgendaJob<JobData<K>>;

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
  unique: Record<string, unknown>;
}

/**
 * Agenda-backed job handler signature.
 */
export type JobHandler<K extends JobName = JobName> = (
  job: Job<K>,
  done?: (error?: Error) => void,
) => Promise<void> | void;

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
   * Lists jobs using a MongoDB filter.
   * @param filter - MongoDB filter for jobs.
   * @returns Promise resolving to matching jobs.
   */
  listJobs(filter?: Filter<Record<string, unknown>>): Promise<Job[]>;
}

/**
 * Mapping of job names to their handlers.
 */
export type JobHandlerMap = {
  [K in JobName]: JobHandler<K>;
};

/**
 * Runtime status of the scheduler.
 */
export type SchedulerStatus = "idle" | "running" | "stopping";
