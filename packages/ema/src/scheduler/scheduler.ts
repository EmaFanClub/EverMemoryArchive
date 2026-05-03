import { Agenda, type IAgendaConfig } from "@hokify/agenda";
import type { Mongo } from "../db/mongo";
import type {
  Job,
  JobEverySpec,
  JobHandler,
  JobHandlerMap,
  JobId,
  JobName,
  JobSpec,
  Scheduler,
  SchedulerStatus,
} from "./base";

/**
 * Scheduler implementation backed by Agenda.
 */
export class AgendaScheduler implements Scheduler {
  /**
   * Collection name used by Agenda.
   */
  readonly collectionName = "agenda";
  private status: SchedulerStatus = "idle";
  private readonly agenda: Agenda;
  private readonly mongo: Mongo;

  /**
   * Creates and initializes a new AgendaScheduler instance.
   * @param mongo - MongoDB instance used to resolve the Agenda connection URI.
   * @param config - Agenda configuration overrides.
   * @returns Promise resolving to an initialized scheduler instance.
   */
  static async create(
    mongo: Mongo,
    config?: Partial<IAgendaConfig>,
  ): Promise<AgendaScheduler> {
    const scheduler = new AgendaScheduler(mongo, config);
    await scheduler.initialize();
    return scheduler;
  }

  /**
   * Creates a new AgendaScheduler instance.
   * @param mongo - MongoDB instance used to resolve the Agenda connection URI.
   * @param config - Agenda configuration overrides.
   */
  private constructor(mongo: Mongo, config?: Partial<IAgendaConfig>) {
    this.agenda = new Agenda(config);
    this.mongo = mongo;
  }

  /**
   * Starts the scheduler loop.
   * @param handlers - Mapping of job names to their handlers.
   * @returns Promise resolving when the scheduler is started.
   */
  async start(handlers: JobHandlerMap): Promise<void> {
    if (this.status !== "idle") {
      return;
    }
    this.registerHandlers(handlers);
    this.status = "running";

    try {
      await this.normalizeOverdueJobsBeforeStart();
      await this.agenda.start();
    } catch (error) {
      this.status = "idle";
      throw error;
    }
  }

  /**
   * Stops the scheduler loop.
   * @returns Promise resolving when the scheduler is stopped.
   */
  async stop(): Promise<void> {
    if (this.status === "idle") {
      return;
    }
    this.status = "stopping";

    try {
      await this.agenda.stop();
    } finally {
      this.status = "idle";
    }
  }

  /**
   * Gets a job by id.
   * @param id - The job identifier.
   * @returns Promise resolving to the job if found.
   */
  async getJob(id: JobId): Promise<Job | null> {
    return this.loadJob(id);
  }

  /**
   * Schedules a job for execution.
   * @param job - The job to schedule.
   * @returns Promise resolving to the job id.
   */
  async schedule(job: JobSpec): Promise<JobId> {
    const scheduled = await this.agenda.schedule(
      new Date(job.runAt),
      job.name,
      job.data,
    );
    const id = scheduled.attrs._id?.toString();
    if (!id) {
      throw new Error("Agenda job id is missing.");
    }
    return id;
  }

  /**
   * Reschedules an existing queued job with new runAt/data.
   * @param id - The job identifier.
   * @param job - The new job data.
   * @returns Promise resolving to true if rescheduled, false otherwise.
   */
  async reschedule(id: JobId, job: JobSpec): Promise<boolean> {
    const agendaJob = await this.loadJob(id);
    if (!agendaJob) {
      return false;
    }

    const running = await this.isRunning(agendaJob);
    if (running) {
      return false;
    }

    agendaJob.attrs.name = job.name;
    agendaJob.attrs.data = job.data;
    agendaJob.schedule(new Date(job.runAt));
    await agendaJob.save();
    return true;
  }

  /**
   * Cancels a pending job by id.
   * @param id - The job identifier.
   * @returns Promise resolving to true if canceled, false otherwise.
   */
  async cancel(id: JobId): Promise<boolean> {
    const agendaJob = await this.loadJob(id);
    if (!agendaJob) {
      return false;
    }

    const running = await this.isRunning(agendaJob);
    if (running) {
      return false;
    }

    const removed = await agendaJob.remove();
    return removed > 0;
  }

  /**
   * Schedules a recurring job.
   * @param job - The recurring job data.
   * @returns Promise resolving to the job id.
   */
  async scheduleEvery(job: JobEverySpec): Promise<JobId> {
    const agendaJob = this.agenda.create(job.name, job.data);
    if (job.unique) {
      agendaJob.unique(job.unique);
    }
    agendaJob.schedule(new Date(job.runAt));
    agendaJob.repeatEvery(job.interval);
    const saved = await agendaJob.save();
    const id = saved.attrs._id?.toString();
    if (!id) {
      throw new Error("Agenda job id is missing.");
    }
    return id;
  }

  /**
   * Reschedules an existing recurring job.
   * @param id - The job identifier.
   * @param job - The new recurring job data.
   * @returns Promise resolving to true if rescheduled, false otherwise.
   */
  async rescheduleEvery(id: JobId, job: JobEverySpec): Promise<boolean> {
    const agendaJob = await this.loadJob(id);
    if (!agendaJob) {
      return false;
    }

    const running = await this.isRunning(agendaJob);
    if (running) {
      return false;
    }

    agendaJob.attrs.name = job.name;
    agendaJob.attrs.data = job.data;
    if (job.unique) {
      agendaJob.unique(job.unique);
    }
    agendaJob.schedule(new Date(job.runAt));
    agendaJob.repeatEvery(job.interval);
    await agendaJob.save();
    return true;
  }

  /**
   * Lists jobs using a MongoDB filter.
   * @param filter - MongoDB filter for jobs.
   * @returns Promise resolving to matching jobs.
   */
  async listJobs(filter?: Record<string, unknown>): Promise<Job[]> {
    const jobs = await this.agenda.jobs(filter ?? {});
    return jobs as Job[];
  }

  private async initialize(): Promise<void> {
    await this.agenda.database(this.mongo.getUri(), this.collectionName);
    await this.agenda.ready;
  }

  /**
   * Normalizes overdue jobs before the scheduler loop starts.
   */
  private async normalizeOverdueJobsBeforeStart(): Promise<void> {
    const jobs = (await this.agenda.jobs({})) as Job[];
    const now = Date.now();

    for (const job of jobs) {
      const nextRunAt = job.attrs.nextRunAt;
      if (!(nextRunAt instanceof Date) || Number.isNaN(nextRunAt.getTime())) {
        continue;
      }
      if (nextRunAt.getTime() >= now) {
        continue;
      }

      job.attrs.lockedAt = undefined;
      const isRecurring = Boolean(
        job.attrs.repeatInterval || job.attrs.repeatAt,
      );
      if (!isRecurring) {
        job.disable();
        const data = job.attrs.data;
        if (data && typeof data === "object" && !Array.isArray(data)) {
          const nextData = data as unknown as Record<string, unknown>;
          const addition = nextData.addition;
          nextData.addition =
            addition && typeof addition === "object" && !Array.isArray(addition)
              ? { ...(addition as Record<string, unknown>), overdue: true }
              : { overdue: true };
        }
        await job.save();
        continue;
      }

      job.enable();
      while (
        job.attrs.nextRunAt instanceof Date &&
        job.attrs.nextRunAt.getTime() <= now
      ) {
        job.attrs.lastRunAt = new Date(job.attrs.nextRunAt);
        (job as any).computeNextRunAt();
        if (!(job.attrs.nextRunAt instanceof Date)) {
          break;
        }
      }
      await job.save();
    }
  }

  private registerHandlers(handlers: JobHandlerMap): void {
    for (const name of Object.keys(handlers) as JobName[]) {
      const handler = handlers[name];
      if (!handler) {
        throw new Error(`Job handler "${name}" is missing.`);
      }
      this.agenda.define(name, handler as (job: Job) => Promise<void> | void);
    }
  }

  private async loadJob(id: JobId): Promise<Job | null> {
    try {
      const job = await this.agenda.getForkedJob(id);
      return job as Job;
    } catch {
      return null;
    }
  }

  private async isRunning(job: Job): Promise<boolean> {
    try {
      return await job.isRunning();
    } catch {
      return false;
    }
  }
}
