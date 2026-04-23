import { Logger } from "../shared/logger";
import {
  EMA_MEMORY_ROLLUP_PROMPT,
  EMA_SLEEP_PROMPT,
  EMA_WAKE_PROMPT,
} from "../memory/prompts";
import { runActorBackgroundJob } from "../scheduler/jobs/actor.job";
import type { Server } from "../server";
import { formatTimestamp } from "../shared/utils";
import type { ChannelEvent } from "../channel";
import type {
  ActorChatInput,
  ActorInput,
  ActorStatus,
  ActorSystemInput,
} from "./base";
import { ActorWorker } from "./actor_worker";
import { SessionManager } from "./session_manager";
import { HeartbeatTimer } from "./timer";

const DEFAULT_SLEEP_QUIET_PERIOD_MS = 5 * 60_000;

export class Actor {
  readonly sessionManager: SessionManager;
  private readonly sleepTimer = new HeartbeatTimer(
    DEFAULT_SLEEP_QUIET_PERIOD_MS,
  );

  private currentConversationId: number | null = null;
  private currentWorker: ActorWorker | null = null;
  private acquiring = false;
  private bootInitPromise: Promise<void> | null = null;
  private status: ActorStatus = "sleep";
  private dayDate: string | null = null;
  private readonly logger: Logger = Logger.create({
    name: "actor",
    level: "debug",
    transport: "console",
  });

  private constructor(
    readonly actorId: number,
    private readonly server: Server,
  ) {
    this.sessionManager = new SessionManager(
      this.handleQueueUnlocked.bind(this),
    );
    this.sleepTimer.on(() => {
      this.runDetached(this.handleSleepTimerFired(), "handle sleep timer");
    });
  }

  static async create(actorId: number, server: Server): Promise<Actor> {
    return new Actor(actorId, server);
  }

  getStatus(): ActorStatus {
    return this.status;
  }

  getDayDate(): string | null {
    return this.dayDate;
  }

  canRunActiveTasks(): boolean {
    return this.status === "awake";
  }

  startBootInit(): void {
    if (this.bootInitPromise) {
      return;
    }
    const task = this.runBootInit().finally(() => {
      if (this.bootInitPromise === task) {
        this.bootInitPromise = null;
      }
    });
    this.bootInitPromise = task;
    this.runDetached(task, "run boot init");
  }

  beginWake(): boolean {
    if (this.status !== "sleep") {
      return false;
    }
    this.stopSleepTimer();
    this.status = "switching";
    return true;
  }

  completeWake(): void {
    this.dayDate = formatTimestamp("YYYY-MM-DD", Date.now());
    this.status = "awake";
    this.tryAcquireConversation();
  }

  failWake(): void {
    this.status = "sleep";
  }

  startSleepTimer(): boolean {
    if (this.status !== "awake") {
      return false;
    }
    this.sleepTimer.start();
    return true;
  }

  resetSleepTimer(): boolean {
    if (this.status !== "awake" || !this.sleepTimer.isRunning()) {
      return false;
    }
    this.sleepTimer.reset();
    return true;
  }

  stopSleepTimer(): void {
    this.sleepTimer.stop();
  }

  beginSleep(): boolean {
    if (this.status !== "awake") {
      return false;
    }
    this.status = "switching";
    return true;
  }

  completeSleep(): void {
    this.stopSleepTimer();
    this.dayDate = null;
    this.status = "sleep";
  }

  failSleep(): void {
    this.status = "awake";
    this.tryAcquireConversation();
  }

  enqueueChannelEvent(
    message: ChannelEvent,
    conversationId: number,
    msgId?: number,
  ): Promise<void> {
    let envelope: ActorInput;
    if (message.kind === "chat") {
      if (typeof msgId !== "number") {
        throw new Error("msgId is required for channel chat messages.");
      }
      envelope = {
        kind: "chat",
        conversationId,
        msgId,
        inputs: message.inputs,
        time: message.time,
        speaker: message.speaker,
        channelMessageId: message.channelMessageId,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      } satisfies ActorChatInput;
    } else {
      envelope = {
        kind: "system",
        conversationId,
        inputs: message.inputs,
        time: message.time,
      } satisfies ActorSystemInput;
    }
    return this.enqueueActorInput(conversationId, envelope);
  }

  async enqueueActorInput(
    conversationId: number,
    input: ActorInput,
  ): Promise<void> {
    if (input.kind === "chat") {
      await this.server.memoryManager.persistChatMessage(input);
    }
    this.sessionManager.enqueue(conversationId, input);
    this.resetSleepTimer();
    if (this.status !== "awake") {
      return;
    }
    if (this.currentConversationId === null) {
      this.tryAcquireConversation();
      return;
    }
    if (this.currentConversationId === conversationId) {
      this.pumpHeldQueue();
    }
  }

  private async runBootInit(): Promise<void> {
    try {
      await runActorBackgroundJob(
        this.server,
        {
          actorId: this.actorId,
          task: "memory_rollup",
          prompt: EMA_MEMORY_ROLLUP_PROMPT,
          addition: { reason: "flush" },
        },
        Date.now(),
      );
    } catch (error) {
      this.logger.error("Failed to run boot-init memory rollup:", error);
    }

    const listed = await this.server.getActorScheduler(this.actorId).list();
    const wakeSchedule = listed.recurring.find((item) => item.task === "wake");
    const sleepSchedule = listed.recurring.find(
      (item) => item.task === "sleep",
    );
    const shouldWake =
      !wakeSchedule ||
      !sleepSchedule ||
      (typeof wakeSchedule.lastRunAt === "string" &&
      typeof sleepSchedule.lastRunAt === "string"
        ? wakeSchedule.lastRunAt > sleepSchedule.lastRunAt
        : typeof wakeSchedule.lastRunAt === "string"
          ? true
          : typeof sleepSchedule.lastRunAt === "string"
            ? false
            : typeof wakeSchedule.nextRunAt === "string" &&
                typeof sleepSchedule.nextRunAt === "string"
              ? wakeSchedule.nextRunAt >= sleepSchedule.nextRunAt
              : true);
    if (!shouldWake) {
      return;
    }

    try {
      await runActorBackgroundJob(
        this.server,
        {
          actorId: this.actorId,
          task: "wake",
          prompt: EMA_WAKE_PROMPT,
        },
        Date.now(),
      );
    } catch (error) {
      this.logger.error("Failed to run boot-init wake task:", error);
    }
  }

  private async handleSleepTimerFired(): Promise<void> {
    if (this.status !== "awake") {
      return;
    }
    await runActorBackgroundJob(
      this.server,
      {
        actorId: this.actorId,
        task: "sleep",
        prompt: EMA_SLEEP_PROMPT,
        addition: { source: "timer" },
      },
      Date.now(),
    );
  }

  private tryAcquireConversation(): void {
    if (
      this.status !== "awake" ||
      this.currentConversationId !== null ||
      this.acquiring
    ) {
      return;
    }
    const conversationId = this.sessionManager.pickNextConversationId();
    if (conversationId === null) {
      return;
    }
    this.acquiring = true;
    this.runDetached(
      this.holdConversation(conversationId).finally(() => {
        this.acquiring = false;
        if (this.currentConversationId === null && this.status === "awake") {
          setTimeout(() => {
            this.tryAcquireConversation();
          }, 0);
        }
      }),
      `hold conversation ${conversationId}`,
    );
  }

  private async holdConversation(conversationId: number): Promise<void> {
    const worker = await ActorWorker.create(
      this.actorId,
      conversationId,
      this.server,
    );
    this.currentConversationId = conversationId;
    this.currentWorker = worker;
    worker.events.on("actorResponsed", (event) => {
      this.runDetached(
        this.server.gateway.dispatchActorResponse(event.response),
        `send reply for conversation ${conversationId}`,
      );
    });
    worker.events.on("workFinished", (event) => {
      if (!event.ok) {
        this.logger.error(
          `Worker finished with error for conversation ${conversationId}: ${event.msg}`,
          event.error,
        );
      }
      if (this.currentConversationId === conversationId) {
        this.releaseConversation();
        this.tryAcquireConversation();
      }
    });
    this.pumpHeldQueue();
  }

  private pumpHeldQueue(): void {
    if (
      this.status !== "awake" ||
      this.currentConversationId === null ||
      !this.currentWorker
    ) {
      return;
    }
    const conversationId = this.currentConversationId;
    for (;;) {
      const input = this.sessionManager.tryPop(conversationId);
      if (!input) {
        return;
      }
      this.runDetached(
        this.currentWorker.work(input),
        `dispatch held conversation ${conversationId}`,
      );
    }
  }

  private handleQueueUnlocked(conversationId: number): void {
    if (this.status !== "awake") {
      return;
    }
    if (this.currentConversationId === null) {
      this.tryAcquireConversation();
      return;
    }
    if (this.currentConversationId === conversationId) {
      this.pumpHeldQueue();
    }
  }

  private releaseConversation(): void {
    if (this.currentWorker) {
      this.currentWorker.events.removeAllListeners("actorResponsed");
      this.currentWorker.events.removeAllListeners("workFinished");
    }
    this.currentWorker = null;
    this.currentConversationId = null;
  }

  private runDetached(task: Promise<unknown>, label: string): void {
    task.catch((error) => {
      this.logger.error(`Failed to ${label}:`, error);
    });
  }
}
