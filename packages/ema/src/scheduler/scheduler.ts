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
   * Creates a new AgendaScheduler instance.
   * @param mongo - MongoDB instance used to resolve the Agenda connection URI.
   * @param config - Agenda configuration overrides.
   */
  constructor(mongo: Mongo, config?: Partial<IAgendaConfig>) {
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
      await this.agenda.database(this.mongo.getUri(), this.collectionName);
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
    await this.ensureReady();
    return this.loadJob(id);
  }

  /**
   * Schedules a job for execution.
   * @param job - The job to schedule.
   * @returns Promise resolving to the job id.
   */
  async schedule(job: JobSpec): Promise<JobId> {
    await this.ensureReady();
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
    await this.ensureReady();
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
    await this.ensureReady();
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
    await this.ensureReady();
    const agendaJob = this.agenda.create(job.name, job.data);
    agendaJob.unique(job.unique);
    agendaJob.schedule(new Date(job.runAt));
    agendaJob.repeatEvery(job.interval, { skipImmediate: true });
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
    await this.ensureReady();
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
    agendaJob.unique(job.unique);
    agendaJob.schedule(new Date(job.runAt));
    agendaJob.repeatEvery(job.interval, { skipImmediate: true });
    await agendaJob.save();
    return true;
  }

  /**
   * Lists jobs using a MongoDB filter.
   * @param filter - MongoDB filter for jobs.
   * @returns Promise resolving to matching jobs.
   */
  async listJobs(filter?: Record<string, unknown>): Promise<Job[]> {
    await this.ensureReady();
    const jobs = await this.agenda.jobs(filter ?? {});
    return jobs as Job[];
  }

  private async ensureReady(): Promise<void> {
    if (this.status !== "running") {
      throw new Error("Scheduler is not running.");
    }
    await this.agenda.ready;
  }

  private registerHandlers(handlers: JobHandlerMap): void {
    for (const name of Object.keys(handlers) as JobName[]) {
      this.register(name, handlers[name]);
    }
  }

  private register<K extends JobName>(name: K, handler: JobHandler<K>): void {
    this.agenda.define(name, handler as (job: Job) => Promise<void> | void);
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
