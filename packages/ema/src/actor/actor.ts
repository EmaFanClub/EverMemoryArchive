import { Logger } from "../shared/logger";
import {
  EMA_MEMORY_ROLLUP_PROMPT,
  EMA_SLEEP_PROMPT,
  EMA_WAKE_PROMPT,
} from "../memory/prompts";
import { runActorBackgroundJob } from "../scheduler/jobs/actor.job";
import type { Server } from "../server";
import { formatTimestamp, parseTimestamp } from "../shared/utils";
import type { ActorRecurringScheduleItem } from "../scheduler";
import type { ChannelEvent } from "../channel";
import type {
  ActorChatInput,
  ActorInput,
  ActorStatus,
  ActorTransition,
  ActorSystemInput,
} from "./base";
import { ActorWorker } from "./actor_worker";
import {
  SessionManager,
  type SessionManagerQueueEvent,
} from "./session_manager";
import { HeartbeatTimer } from "./timer";

const DEFAULT_SLEEP_QUIET_PERIOD_MS = 5 * 60_000;
const SCHEDULE_TIME_FORMAT = "YYYY-MM-DD HH:mm:ss";

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
  private transition: ActorTransition = null;
  private dayDate: string | null = null;
  private readonly logger: Logger;

  private constructor(
    readonly actorId: number,
    private readonly server: Server,
  ) {
    this.logger = Logger.create({
      name: "actor",
      context: {
        actorId,
      },
      outputs: [
        { type: "console", level: "info" },
        { type: "file", level: "debug" },
      ],
    });
    this.sessionManager = new SessionManager(
      this.handleQueueUnlocked.bind(this),
      {},
      this.handleQueueEvent.bind(this),
    );
    this.sleepTimer.on(() => {
      this.runDetached(this.handleSleepTimerFired(), "handle sleep timer");
    });
  }

  static async create(actorId: number, server: Server): Promise<Actor> {
    const actor = new Actor(actorId, server);
    actor.logger.info("Actor runtime created");
    return actor;
  }

  getStatus(): ActorStatus {
    return this.status;
  }

  getTransition(): ActorTransition {
    return this.transition;
  }

  getDayDate(): string | null {
    return this.dayDate;
  }

  isBusy(): boolean {
    return this.currentConversationId !== null || this.currentWorker !== null;
  }

  isProcessingConversation(conversationId: number): boolean {
    return (
      this.currentConversationId === conversationId &&
      this.currentWorker !== null
    );
  }

  isPreparing(): boolean {
    return this.status === "switching" || this.bootInitPromise !== null;
  }

  canRunActiveTasks(): boolean {
    return this.status === "awake";
  }

  startBootInit(): Promise<void> {
    if (this.bootInitPromise) {
      return this.bootInitPromise;
    }
    this.logger.info("Actor boot initialization started");
    const startedAt = performance.now();
    const task = this.runBootInit()
      .then(() => {
        this.logger.info("Actor boot initialization completed", {
          status: this.status,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
      })
      .catch((error) => {
        this.logger.error("Actor boot initialization failed", {
          status: this.status,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          error,
        });
        throw error;
      })
      .finally(() => {
        if (this.bootInitPromise === task) {
          this.bootInitPromise = null;
        }
        this.publishRuntimeStatus("boot_init:complete");
      });
    this.bootInitPromise = task;
    this.runDetached(task, "run boot init");
    this.publishRuntimeStatus("boot_init:start");
    return task;
  }

  beginWake(): boolean {
    if (this.status !== "sleep") {
      return false;
    }
    this.stopSleepTimer();
    this.status = "switching";
    this.transition = "waking";
    this.logger.info("Actor waking");
    this.publishRuntimeStatus("wake:start");
    return true;
  }

  completeWake(): void {
    this.dayDate = formatTimestamp("YYYY-MM-DD", Date.now());
    this.status = "awake";
    this.transition = null;
    this.logger.info("Actor awake", { dayDate: this.dayDate });
    this.publishRuntimeStatus("wake:complete");
    this.tryAcquireConversation();
  }

  failWake(): void {
    this.status = "sleep";
    this.transition = null;
    this.logger.warn("Actor wake failed");
    this.publishRuntimeStatus("wake:failed");
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
    this.transition = "sleeping";
    this.logger.info("Actor sleeping");
    this.publishRuntimeStatus("sleep:start");
    return true;
  }

  completeSleep(): void {
    this.stopSleepTimer();
    this.dayDate = null;
    this.status = "sleep";
    this.transition = null;
    this.logger.info("Actor asleep");
    this.publishRuntimeStatus("sleep:complete");
  }

  failSleep(): void {
    this.status = "awake";
    this.transition = null;
    this.logger.warn("Actor sleep failed");
    this.publishRuntimeStatus("sleep:failed");
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
    this.logger.debug("Actor input enqueued", {
      conversationId,
      kind: input.kind,
    });
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
    const triggeredAt = Date.now();
    const listed = await this.server.getActorScheduler(this.actorId).list();
    const wakeSchedule = listed.recurring.find((item) => item.task === "wake");
    const sleepSchedule = listed.recurring.find(
      (item) => item.task === "sleep",
    );
    const shouldWake = shouldBootInitWake(
      wakeSchedule,
      sleepSchedule,
      triggeredAt,
    );
    const targetDayDate = resolveBootInitTargetDayDate({
      shouldWake,
      wakeSchedule,
      triggeredAt,
    });
    await this.runBootMemoryRollupIfNeeded(triggeredAt, targetDayDate);

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

  private async runBootMemoryRollupIfNeeded(
    triggeredAt: number,
    targetDayDate: string,
  ): Promise<void> {
    const shouldRollup =
      await this.server.memoryManager.hasUnprocessedActivityBeforeDay(
        this.actorId,
        targetDayDate,
      );
    if (!shouldRollup) {
      return;
    }

    try {
      await runActorBackgroundJob(
        this.server,
        {
          actorId: this.actorId,
          task: "memory_rollup",
          prompt: EMA_MEMORY_ROLLUP_PROMPT,
          addition: { reason: "boot_init", targetDayDate },
        },
        triggeredAt,
      );
    } catch (error) {
      this.logger.error("Failed to run boot-init memory rollup:", error);
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
    let worker: ActorWorker;
    try {
      worker = await ActorWorker.create(
        this.actorId,
        conversationId,
        this.server,
      );
    } catch (error) {
      if (!isInvalidConversationError(error, conversationId)) {
        throw error;
      }
      const droppedInputs =
        this.sessionManager.dropConversation(conversationId);
      this.logger.warn("Conversation queue dropped", {
        conversationId,
        droppedInputs,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.currentConversationId = conversationId;
    this.currentWorker = worker;
    this.logger.info("Conversation acquired", {
      conversationId,
      session: worker.session,
    });
    this.publishConversationTyping(conversationId, true);
    this.publishRuntimeStatus("conversation:acquired");
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

  private handleQueueEvent(
    conversationId: number,
    event: SessionManagerQueueEvent,
  ): void {
    switch (event.type) {
      case "rate_limited":
        this.logger.info("Session queue rate limited", {
          conversationId,
          queueSize: event.queueSize,
          dispatchesInWindow: event.dispatchesInWindow,
          maxDispatchesPerWindow: event.maxDispatchesPerWindow,
          rateLimitWindowMs: event.rateLimitWindowMs,
          unlockAt: event.unlockAt,
          delayMs: event.delayMs,
        });
        return;
      case "unlocked":
        this.logger.info("Session queue unlocked", {
          conversationId,
          queueSize: event.queueSize,
        });
        return;
      case "dropped":
        this.logger.warn("Session queue dropped oldest input", {
          conversationId,
          queueSize: event.queueSize,
          maxQueueSize: event.maxQueueSize,
        });
        return;
    }
  }

  private releaseConversation(): void {
    const conversationId = this.currentConversationId;
    const session = this.currentWorker?.session;
    if (this.currentWorker) {
      this.currentWorker.events.removeAllListeners("actorResponsed");
      this.currentWorker.events.removeAllListeners("workFinished");
    }
    this.currentWorker = null;
    this.currentConversationId = null;
    if (conversationId !== null) {
      this.logger.info("Conversation released", {
        conversationId,
        ...(session ? { session } : {}),
      });
      this.publishConversationTyping(conversationId, false);
    }
    this.publishRuntimeStatus("conversation:released");
  }

  private runDetached(task: Promise<unknown>, label: string): void {
    task.catch((error) => {
      this.logger.error(`Failed to ${label}:`, error);
    });
  }

  async dispose(): Promise<void> {
    this.stopSleepTimer();
    this.bootInitPromise = null;
    this.sessionManager.clear();
    this.releaseConversation();
    this.status = "sleep";
    this.transition = null;
    this.dayDate = null;
    this.logger.info("Actor runtime disposed");
  }

  private publishRuntimeStatus(reason: string): void {
    this.server.controller.runtime
      .publishStatus(this.actorId, reason)
      .catch((error) => {
        this.logger.warn("Failed to publish runtime status", {
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private publishConversationTyping(
    conversationId: number,
    typing: boolean,
  ): void {
    this.server.controller.chat
      .publishConversationTyping(conversationId, typing)
      .catch((error) => {
        this.logger.warn("Failed to publish conversation typing", {
          conversationId,
          typing,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

function isInvalidConversationError(
  error: unknown,
  conversationId: number,
): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === `Conversation ${conversationId} not found.` ||
    message === `Invalid session on conversation ${conversationId}.` ||
    message === `Invalid actor on conversation ${conversationId}.`
  );
}

function shouldBootInitWake(
  wakeSchedule: ActorRecurringScheduleItem | undefined,
  sleepSchedule: ActorRecurringScheduleItem | undefined,
  triggeredAt: number,
): boolean {
  const wakeClockMinutes = resolveDailyCronClockMinutes(wakeSchedule?.interval);
  const sleepClockMinutes = resolveDailyCronClockMinutes(
    sleepSchedule?.interval,
  );
  if (
    wakeClockMinutes !== null &&
    sleepClockMinutes !== null &&
    wakeClockMinutes !== sleepClockMinutes
  ) {
    return !isClockWithinSleepWindow(
      getClockMinutes(triggeredAt),
      sleepClockMinutes,
      wakeClockMinutes,
    );
  }

  return (
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
            : true)
  );
}

function resolveDailyCronClockMinutes(
  interval: ActorRecurringScheduleItem["interval"] | undefined,
): number | null {
  if (typeof interval !== "string") {
    return null;
  }
  const parts = interval.trim().split(/\s+/);
  if (
    parts.length !== 5 ||
    parts[2] !== "*" ||
    parts[3] !== "*" ||
    parts[4] !== "*"
  ) {
    return null;
  }
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (
    !Number.isInteger(minute) ||
    !Number.isInteger(hour) ||
    minute < 0 ||
    minute > 59 ||
    hour < 0 ||
    hour > 23
  ) {
    return null;
  }
  return hour * 60 + minute;
}

function getClockMinutes(timestamp: number): number {
  const time = new Date(timestamp);
  return time.getHours() * 60 + time.getMinutes();
}

function isClockWithinSleepWindow(
  clockMinutes: number,
  sleepClockMinutes: number,
  wakeClockMinutes: number,
): boolean {
  if (sleepClockMinutes < wakeClockMinutes) {
    return clockMinutes >= sleepClockMinutes && clockMinutes < wakeClockMinutes;
  }
  return clockMinutes >= sleepClockMinutes || clockMinutes < wakeClockMinutes;
}

function resolveBootInitTargetDayDate({
  shouldWake,
  wakeSchedule,
  triggeredAt,
}: {
  shouldWake: boolean;
  wakeSchedule: ActorRecurringScheduleItem | undefined;
  triggeredAt: number;
}): string {
  if (shouldWake || typeof wakeSchedule?.nextRunAt !== "string") {
    return formatTimestamp("YYYY-MM-DD", triggeredAt);
  }
  return formatTimestamp(
    "YYYY-MM-DD",
    parseTimestamp(SCHEDULE_TIME_FORMAT, wakeSchedule.nextRunAt),
  );
}
