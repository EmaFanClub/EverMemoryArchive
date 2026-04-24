import { performance } from "node:perf_hooks";

import { buildUserMessageFromActorInput } from "../../actor/utils";
import { Agent, type AgentState, type RunFinishedEvent } from "../../agent";
import { LLMClient } from "../../llm";
import { formatLogTimestamp, Logger } from "../../shared/logger";
import { GlobalConfig } from "../../config/index";
import {
  EMA_MEMORY_ROLLUP_PROMPT,
  EMA_SCHEDULED_ACTIVITY_PROMPT,
  EMA_SCHEDULED_CHAT_PROMPT,
  EMA_SLEEP_PROMPT,
  EMA_WAKE_PROMPT,
} from "../../memory/prompts";
import type { ShortTermMemoryRecord } from "../../memory/base";
import type { Server } from "../../server";
import { baseTools } from "../../tools";
import type { JobHandler } from "../base";

const actorMemoryRollupQueue = new Map<number, Promise<unknown>>();

type SleepTaskSource = "schedule" | "timer";
type ActorBackgroundTaskName = ActorBackgroundJobData["task"];

interface PendingWindowState {
  count: number;
  lastPendingId: number | null;
}

interface ConversationRollupRunResult {
  activityAdded: boolean;
  processedMessageCount: number;
}

interface BackgroundTaskLogData {
  actorId: number;
  task: ActorBackgroundTaskName;
  triggeredAt: number;
  conversationId?: number;
  addition?: Record<string, unknown>;
}

interface ChatTaskData {
  actorId: number;
  prompt: string;
  conversationId: number;
  triggeredAt: number;
}

interface ConversationRollupTaskData {
  actorId: number;
  conversationId: number;
  prompt: string;
  triggeredAt: number;
  followUp?: boolean;
}

interface MemoryRollupTaskData {
  actorId: number;
  prompt: string;
  triggeredAt: number;
  thresholdTriggered: boolean;
  followUp?: boolean;
}

interface ActivityTaskData {
  actorId: number;
  prompt: string;
  triggeredAt: number;
}

interface WakeTaskData {
  actorId: number;
  prompt: string;
  triggeredAt: number;
}

interface SleepTaskData {
  actorId: number;
  prompt: string;
  triggeredAt: number;
  source: SleepTaskSource;
  addition?: Record<string, unknown>;
}

/**
 * Data for actor foreground jobs.
 */
export interface ActorForegroundJobData {
  actorId: number;
  prompt: string;
  conversationId: number;
  task: "chat";
  addition?: Record<string, unknown>;
}

/**
 * Data for actor background jobs.
 */
export interface ActorBackgroundJobData {
  actorId: number;
  conversationId?: number;
  task: "activity" | "conversation_rollup" | "memory_rollup" | "wake" | "sleep";
  prompt: string;
  addition?: Record<string, unknown>;
}

/**
 * Runs the unified foreground actor job entry.
 * @param server - Server instance for shared resources.
 * @param job - Foreground job data.
 * @param triggeredAt - Optional logical trigger timestamp.
 */
export async function runActorForegroundJob(
  server: Server,
  job: ActorForegroundJobData,
  triggeredAt: number = Date.now(),
): Promise<void> {
  server.logger?.info("Actor foreground task started", {
    actorId: job.actorId,
    task: job.task,
    conversationId: job.conversationId,
    triggeredAt,
  });
  switch (job.task) {
    case "chat":
      await runChatTask(server, {
        actorId: job.actorId,
        conversationId: job.conversationId,
        prompt: job.prompt,
        triggeredAt,
      });
      return;
    default: {
      const unreachable: never = job.task;
      throw new Error(`Unsupported actor foreground task: ${unreachable}`);
    }
  }
}

/**
 * Runs the unified background actor job entry.
 * @param server - Server instance for shared resources.
 * @param job - Background job data.
 * @param triggeredAt - Optional logical trigger timestamp.
 */
export async function runActorBackgroundJob(
  server: Server,
  job: ActorBackgroundJobData,
  triggeredAt: number = Date.now(),
): Promise<void> {
  const logData = buildBackgroundTaskLogData(job.task, {
    actorId: job.actorId,
    conversationId: job.conversationId,
    triggeredAt,
    addition: job.addition,
  });
  const dispatchStartedAt = performance.now();
  logBackgroundTaskRequested(server, logData);
  try {
    switch (job.task) {
      case "activity":
        await runActivityTask(server, {
          actorId: job.actorId,
          prompt: job.prompt,
          triggeredAt,
        });
        return;
      case "conversation_rollup":
        if (typeof job.conversationId !== "number") {
          throw new Error(
            "conversationId is required for actor background task 'conversation_rollup'.",
          );
        }
        await runConversationRollupTask(server, {
          actorId: job.actorId,
          conversationId: job.conversationId,
          prompt: job.prompt,
          triggeredAt,
        });
        return;
      case "memory_rollup":
        await runMemoryRollupTask(server, {
          actorId: job.actorId,
          prompt: job.prompt,
          triggeredAt,
          thresholdTriggered: isThresholdTriggered(job.addition),
        });
        return;
      case "wake":
        await runWakeTask(server, {
          actorId: job.actorId,
          prompt: job.prompt,
          triggeredAt,
        });
        return;
      case "sleep":
        await runSleepTask(server, {
          actorId: job.actorId,
          prompt: job.prompt,
          triggeredAt,
          source: job.addition?.source === "timer" ? "timer" : "schedule",
          addition: stripInternalSleepSource(job.addition),
        });
        return;
      default: {
        const unreachable: never = job.task;
        throw new Error(`Unsupported actor background task: ${unreachable}`);
      }
    }
  } catch (error) {
    if (!isBackgroundTaskErrorLogged(error)) {
      logBackgroundTaskFailed(server, logData, dispatchStartedAt, error);
    }
    throw error;
  }
}

/**
 * Dispatches one foreground chat task to the target actor.
 * @param server - Server instance for shared resources.
 * @param job - Normalized chat task data.
 */
async function runChatTask(server: Server, job: ChatTaskData): Promise<void> {
  const actor = await server.actorRegistry.ensure(job.actorId);
  if (!actor.canRunActiveTasks()) {
    return;
  }
  await actor.enqueueActorInput(job.conversationId, {
    kind: "system",
    conversationId: job.conversationId,
    time: job.triggeredAt,
    inputs: [
      {
        type: "text",
        text: EMA_SCHEDULED_CHAT_PROMPT.replaceAll("{prompt}", job.prompt),
      },
    ],
  });
}

/**
 * Runs one conversation-triggered activity task.
 * @param server - Server instance for shared resources.
 * @param job - Conversation rollup task data.
 */
async function runConversationRollupTask(
  server: Server,
  job: ConversationRollupTaskData,
): Promise<void> {
  const logData = buildBackgroundTaskLogData("conversation_rollup", job);
  if (!server.memoryManager.tryEnterConversationActivity(job.conversationId)) {
    logBackgroundTaskSkipped(server, logData, "already_running", {
      ...(job.followUp ? { followUp: true } : {}),
    });
    return;
  }
  const threshold = server.memoryManager.diaryUpdateEvery;
  let pendingBefore: PendingWindowState = {
    count: 0,
    lastPendingId: null,
  };
  let runResult: ConversationRollupRunResult | null = null;
  let startedAt: number | null = null;
  let completed = false;
  let ranOnce = false;
  let didConsumePending = false;
  try {
    try {
      pendingBefore =
        await server.memoryManager.getPendingConversationWindowState(
          job.conversationId,
          job.triggeredAt,
        );
      if (pendingBefore.count >= threshold) {
        ranOnce = true;
        startedAt = logBackgroundTaskStarted(server, logData, {
          pendingCount: pendingBefore.count,
          threshold,
          ...(job.followUp ? { followUp: true } : {}),
        });
        runResult = await runConversationRollupTaskOnce(server, job);
        didConsumePending = runResult.processedMessageCount > 0;
      }
    } finally {
      server.memoryManager.leaveConversationActivity(job.conversationId);
    }
    const latestAt = Date.now();
    const pendingAfter =
      await server.memoryManager.getPendingConversationWindowState(
        job.conversationId,
        latestAt,
      );
    const followUpScheduled = shouldScheduleFollowUp(
      pendingBefore,
      pendingAfter,
      threshold,
      ranOnce,
      didConsumePending,
    );
    if (startedAt === null) {
      logBackgroundTaskSkipped(server, logData, "threshold_not_reached", {
        pendingBefore: pendingBefore.count,
        pendingAfter: pendingAfter.count,
        threshold,
        followUpScheduled,
        ...(job.followUp ? { followUp: true } : {}),
      });
    } else {
      logBackgroundTaskCompleted(server, logData, startedAt, {
        activityAdded: runResult?.activityAdded === true,
        processedMessageCount: runResult?.processedMessageCount ?? 0,
        pendingBefore: pendingBefore.count,
        pendingAfter: pendingAfter.count,
        followUpScheduled,
        ...(job.followUp ? { followUp: true } : {}),
      });
      completed = true;
    }
    if (!followUpScheduled) {
      return;
    }
    await runConversationRollupTask(server, {
      ...job,
      triggeredAt: latestAt,
      followUp: true,
    });
  } catch (error) {
    if (startedAt !== null && !completed) {
      logBackgroundTaskFailed(server, logData, startedAt, error);
    }
    throw error;
  }
}

/**
 * Executes one conversation-to-activity update attempt.
 * @param server - Server instance for shared resources.
 * @param job - Normalized conversation rollup task data.
 * @returns Summary describing whether an activity was added and messages were consumed.
 */
async function runConversationRollupTaskOnce(
  server: Server,
  job: ConversationRollupTaskData,
): Promise<ConversationRollupRunResult> {
  const bufferSnapshot =
    await server.memoryManager.getBufferedConversationWindowSnapshot(
      job.conversationId,
      job.triggeredAt,
    );
  const activitySnapshot = await server.memoryManager.getActivityWindow(
    job.actorId,
    job.triggeredAt,
  );
  const agent = await createBackgroundAgent(
    server,
    job.actorId,
    job.triggeredAt,
    "conversation_rollup",
    job.conversationId,
  );
  const agentState: AgentState = {
    systemPrompt: await server.memoryManager.buildSystemPromptForBackground(
      job.actorId,
      {
        conversationId: job.conversationId,
        activityRecords: activitySnapshot,
        bufferMessages: bufferSnapshot.messages,
      },
    ),
    messages: [
      buildUserMessageFromActorInput({
        kind: "system",
        conversationId: job.conversationId,
        time: job.triggeredAt,
        inputs: [{ type: "text", text: job.prompt }],
      }),
    ],
    tools: baseTools,
    toolContext: {
      actorId: job.actorId,
      conversationId: job.conversationId,
      server,
      data: {
        task: "conversation_rollup",
        triggeredAt: job.triggeredAt,
      },
    },
  };
  await runBackgroundAgentWithState(agent, agentState);
  const activityAdded = agentState.toolContext?.data?.activityAdded === true;
  let processedMessageCount = 0;
  if (activityAdded) {
    processedMessageCount =
      await server.memoryManager.markConversationMessagesActivityProcessed(
        job.conversationId,
        bufferSnapshot.msgIds,
        job.triggeredAt,
      );
    await runThresholdMemoryRollupWhenNeeded(
      server,
      job.actorId,
      job.triggeredAt,
      agentState,
    );
  }
  return {
    activityAdded,
    processedMessageCount,
  };
}

/**
 * Runs one memory-rollup task. Rollups for the same actor are serialized.
 * @param server - Server instance for shared resources.
 * @param job - Memory rollup task data.
 */
async function runMemoryRollupTask(
  server: Server,
  job: MemoryRollupTaskData,
): Promise<void> {
  const logData = buildBackgroundTaskLogData("memory_rollup", job);
  if (!job.thresholdTriggered) {
    let startedAt: number | null = null;
    try {
      const memoryUpdated = await enqueueActorMemoryRollup(job.actorId, () => {
        startedAt = logBackgroundTaskStarted(server, logData, {
          thresholdTriggered: false,
          ...(job.followUp ? { followUp: true } : {}),
        });
        return runMemoryRollupTaskOnce(server, job);
      });
      logBackgroundTaskCompleted(server, logData, startedAt, {
        memoryUpdated,
        thresholdTriggered: false,
        ...(job.followUp ? { followUp: true } : {}),
      });
    } catch (error) {
      if (startedAt !== null) {
        logBackgroundTaskFailed(server, logData, startedAt, error);
      }
      throw error;
    }
    return;
  }

  if (!server.memoryManager.tryEnterActivityToDayRollup(job.actorId)) {
    logBackgroundTaskSkipped(server, logData, "already_running", {
      thresholdTriggered: true,
      ...(job.followUp ? { followUp: true } : {}),
    });
    return;
  }
  const threshold = server.memoryManager.activityRollupEvery;
  let pendingBefore: PendingWindowState = {
    count: 0,
    lastPendingId: null,
  };
  let ranOnce = false;
  let didConsumePending = false;
  let startedAt: number | null = null;
  let completed = false;
  try {
    try {
      ({ pendingBefore, ranOnce, didConsumePending } =
        await enqueueActorMemoryRollup(job.actorId, async () => {
          const startedAtForWindow = Date.now();
          const before =
            await server.memoryManager.getPendingActivityWindowState(
              job.actorId,
              startedAtForWindow,
            );
          if (before.count < threshold) {
            return {
              pendingBefore: before,
              ranOnce: false,
              didConsumePending: false,
            };
          }
          startedAt = logBackgroundTaskStarted(server, logData, {
            pendingCount: before.count,
            threshold,
            thresholdTriggered: true,
            ...(job.followUp ? { followUp: true } : {}),
          });
          return {
            pendingBefore: before,
            ranOnce: true,
            didConsumePending: await runMemoryRollupTaskOnce(server, {
              ...job,
              triggeredAt: startedAtForWindow,
              thresholdTriggered: true,
            }),
          };
        }));
    } finally {
      server.memoryManager.leaveActivityToDayRollup(job.actorId);
    }
    const latestAt = Date.now();
    const pendingAfter =
      await server.memoryManager.getPendingActivityWindowState(
        job.actorId,
        latestAt,
      );
    const followUpScheduled = shouldScheduleFollowUp(
      pendingBefore,
      pendingAfter,
      threshold,
      ranOnce,
      didConsumePending,
    );
    if (startedAt === null) {
      logBackgroundTaskSkipped(server, logData, "threshold_not_reached", {
        pendingBefore: pendingBefore.count,
        pendingAfter: pendingAfter.count,
        threshold,
        followUpScheduled,
        thresholdTriggered: true,
        ...(job.followUp ? { followUp: true } : {}),
      });
    } else {
      logBackgroundTaskCompleted(server, logData, startedAt, {
        memoryUpdated: didConsumePending,
        pendingBefore: pendingBefore.count,
        pendingAfter: pendingAfter.count,
        followUpScheduled,
        thresholdTriggered: true,
        ...(job.followUp ? { followUp: true } : {}),
      });
      completed = true;
    }
    if (!followUpScheduled) {
      return;
    }
    await runMemoryRollupTask(server, {
      ...job,
      triggeredAt: latestAt,
      thresholdTriggered: true,
      followUp: true,
    });
  } catch (error) {
    if (startedAt !== null && !completed) {
      logBackgroundTaskFailed(server, logData, startedAt, error);
    }
    throw error;
  }
}

/**
 * Runs one scheduled background activity task.
 * @param server - Server instance for shared resources.
 * @param job - Background activity task data.
 */
async function runActivityTask(
  server: Server,
  job: ActivityTaskData,
): Promise<void> {
  const logData = buildBackgroundTaskLogData("activity", job);
  const actor = await server.actorRegistry.ensure(job.actorId);
  if (!actor.canRunActiveTasks()) {
    logBackgroundTaskSkipped(server, logData, "actor_not_awake", {
      status: actor.getStatus(),
    });
    return;
  }
  const startedAt = logBackgroundTaskStarted(server, logData);
  try {
    const activitySnapshot = await server.memoryManager.getActivityWindow(
      job.actorId,
      job.triggeredAt,
    );
    const agent = await createBackgroundAgent(
      server,
      job.actorId,
      job.triggeredAt,
      "activity",
    );
    const agentState: AgentState = {
      systemPrompt: await server.memoryManager.buildSystemPromptForBackground(
        job.actorId,
        {
          activityRecords: activitySnapshot,
        },
      ),
      messages: [
        buildUserMessageFromActorInput({
          kind: "system",
          time: job.triggeredAt,
          inputs: [
            {
              type: "text",
              text: EMA_SCHEDULED_ACTIVITY_PROMPT.replaceAll(
                "{prompt}",
                job.prompt,
              ),
            },
          ],
        }),
      ],
      tools: baseTools,
      toolContext: {
        actorId: job.actorId,
        server,
        data: {
          task: "activity",
          triggeredAt: job.triggeredAt,
        },
      },
    };
    await runBackgroundAgentWithState(agent, agentState);
    await runThresholdMemoryRollupWhenNeeded(
      server,
      job.actorId,
      job.triggeredAt,
      agentState,
    );
    logBackgroundTaskCompleted(server, logData, startedAt, {
      activityAdded: agentState.toolContext?.data?.activityAdded === true,
    });
  } catch (error) {
    logBackgroundTaskFailed(server, logData, startedAt, error);
    throw error;
  }
}

/**
 * Runs one wake task and transitions the actor to the awake state on success.
 * @param server - Server instance for shared resources.
 * @param job - Wake task data.
 */
async function runWakeTask(server: Server, job: WakeTaskData): Promise<void> {
  const logData = buildBackgroundTaskLogData("wake", job);
  const actor = await server.actorRegistry.ensure(job.actorId);
  if (!actor.beginWake()) {
    logBackgroundTaskSkipped(server, logData, "actor_not_sleeping", {
      status: actor.getStatus(),
    });
    return;
  }
  const startedAt = logBackgroundTaskStarted(server, logData);
  try {
    const activitySnapshot = await server.memoryManager.getActivityWindow(
      job.actorId,
      job.triggeredAt,
    );
    const agent = await createBackgroundAgent(
      server,
      job.actorId,
      job.triggeredAt,
      "wake",
    );
    const agentState: AgentState = {
      systemPrompt: await server.memoryManager.buildSystemPromptForBackground(
        job.actorId,
        {
          activityRecords: activitySnapshot,
        },
      ),
      messages: [
        buildUserMessageFromActorInput({
          kind: "system",
          time: job.triggeredAt,
          inputs: [{ type: "text", text: EMA_WAKE_PROMPT }],
        }),
      ],
      tools: baseTools,
      toolContext: {
        actorId: job.actorId,
        server,
        data: {
          task: "wake",
          triggeredAt: job.triggeredAt,
        },
      },
    };
    await runBackgroundAgentWithState(agent, agentState);
    actor.completeWake();
    logBackgroundTaskCompleted(server, logData, startedAt, {
      status: actor.getStatus(),
    });
  } catch (error) {
    actor.failWake();
    logBackgroundTaskFailed(server, logData, startedAt, error);
    throw error;
  }
}

/**
 * Runs one sleep task. Scheduled sleep starts the timer, timer sleep performs the real transition.
 * @param server - Server instance for shared resources.
 * @param job - Sleep task data.
 */
async function runSleepTask(server: Server, job: SleepTaskData): Promise<void> {
  const logData = buildBackgroundTaskLogData("sleep", job);
  const actor = await server.actorRegistry.ensure(job.actorId);
  if (job.source === "schedule") {
    if (!actor.startSleepTimer()) {
      logBackgroundTaskSkipped(server, logData, "actor_not_awake", {
        source: job.source,
        status: actor.getStatus(),
      });
      return;
    }
    const startedAt = logBackgroundTaskStarted(server, logData, {
      source: job.source,
    });
    logBackgroundTaskCompleted(server, logData, startedAt, {
      source: job.source,
      result: "sleep_timer_started",
    });
    return;
  }
  if (!actor.beginSleep()) {
    logBackgroundTaskSkipped(server, logData, "actor_not_awake", {
      source: job.source,
      status: actor.getStatus(),
    });
    return;
  }
  const startedAt = logBackgroundTaskStarted(server, logData, {
    source: job.source,
  });
  try {
    await runMemoryRollupTask(server, {
      actorId: job.actorId,
      prompt: EMA_MEMORY_ROLLUP_PROMPT,
      triggeredAt: job.triggeredAt,
      thresholdTriggered: false,
    });
    const activitySnapshot = await server.memoryManager.getActivityWindow(
      job.actorId,
      job.triggeredAt,
    );
    const agent = await createBackgroundAgent(
      server,
      job.actorId,
      job.triggeredAt,
      "sleep",
    );
    const agentState: AgentState = {
      systemPrompt: await server.memoryManager.buildSystemPromptForBackground(
        job.actorId,
        {
          activityRecords: activitySnapshot,
        },
      ),
      messages: [
        buildUserMessageFromActorInput({
          kind: "system",
          time: job.triggeredAt,
          inputs: [{ type: "text", text: EMA_SLEEP_PROMPT }],
        }),
      ],
      tools: baseTools,
      toolContext: {
        actorId: job.actorId,
        server,
        data: {
          task: "sleep",
          triggeredAt: job.triggeredAt,
        },
      },
    };
    await runBackgroundAgentWithState(agent, agentState);
    actor.completeSleep();
    logBackgroundTaskCompleted(server, logData, startedAt, {
      source: job.source,
      status: actor.getStatus(),
    });
  } catch (error) {
    actor.failSleep();
    logBackgroundTaskFailed(server, logData, startedAt, error);
    throw error;
  }
}

/**
 * Actor background job handler implementation.
 */
export function createActorBackgroundJobHandler(
  server: Server,
): JobHandler<"actor_background"> {
  return async (job) => {
    try {
      await runActorBackgroundJob(server, job.attrs.data);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
}

/**
 * Actor foreground job handler implementation.
 */
export function createActorForegroundJobHandler(
  server: Server,
): JobHandler<"actor_foreground"> {
  return async (job) => {
    try {
      await runActorForegroundJob(server, job.attrs.data);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
}

const loggedBackgroundTaskErrors = new WeakSet<object>();

function buildBackgroundTaskLogData(
  task: ActorBackgroundTaskName,
  job: {
    actorId: number;
    triggeredAt: number;
    conversationId?: number;
    addition?: Record<string, unknown>;
  },
): BackgroundTaskLogData {
  return {
    actorId: job.actorId,
    task,
    triggeredAt: job.triggeredAt,
    ...(typeof job.conversationId === "number"
      ? { conversationId: job.conversationId }
      : {}),
    ...(job.addition ? { addition: job.addition } : {}),
  };
}

function logBackgroundTaskRequested(
  server: Server,
  data: BackgroundTaskLogData,
): void {
  server.logger?.info("Actor background task requested", data);
}

function logBackgroundTaskStarted(
  server: Server,
  data: BackgroundTaskLogData,
  extra?: Record<string, unknown>,
): number {
  server.logger?.info("Actor background task started", {
    ...data,
    ...extra,
  });
  return performance.now();
}

function logBackgroundTaskSkipped(
  server: Server,
  data: BackgroundTaskLogData,
  reason: string,
  extra?: Record<string, unknown>,
): void {
  server.logger?.info("Actor background task skipped", {
    ...data,
    reason,
    ...extra,
  });
}

function logBackgroundTaskCompleted(
  server: Server,
  data: BackgroundTaskLogData,
  startedAt: number | null,
  extra?: Record<string, unknown>,
): void {
  server.logger?.info("Actor background task completed", {
    ...data,
    ...buildDurationData(startedAt),
    ...extra,
  });
}

function logBackgroundTaskFailed(
  server: Server,
  data: BackgroundTaskLogData,
  startedAt: number | null,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  markBackgroundTaskErrorLogged(error);
  server.logger?.error("Actor background task failed", {
    ...data,
    ...buildDurationData(startedAt),
    ...extra,
    error,
  });
}

function buildDurationData(startedAt: number | null): Record<string, unknown> {
  if (startedAt === null) {
    return {};
  }
  return {
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}

function markBackgroundTaskErrorLogged(error: unknown): void {
  if (error && typeof error === "object") {
    loggedBackgroundTaskErrors.add(error);
  }
}

function isBackgroundTaskErrorLogged(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    loggedBackgroundTaskErrors.has(error)
  );
}

async function runBackgroundAgentWithState(
  agent: Agent,
  agentState: AgentState,
): Promise<void> {
  const finishedRef: { value?: RunFinishedEvent } = {};
  const handleFinished = (event: RunFinishedEvent) => {
    finishedRef.value = event;
  };
  agent.events.once("runFinished", handleFinished);
  try {
    await agent.runWithState(agentState);
  } finally {
    agent.events.off("runFinished", handleFinished);
  }
  const finished = finishedRef.value;
  if (finished && !finished.ok) {
    throw finished.error ?? new Error(`Agent run failed: ${finished.msg}`);
  }
}

async function runThresholdMemoryRollupWhenNeeded(
  server: Server,
  actorId: number,
  triggeredAt: number,
  agentState: AgentState,
): Promise<void> {
  if (agentState.toolContext?.data?.activityAdded !== true) {
    return;
  }
  const pendingCount = (
    await server.memoryManager.getPendingActivityWindowState(
      actorId,
      triggeredAt,
    )
  ).count;
  if (pendingCount < server.memoryManager.activityRollupEvery) {
    return;
  }
  await runMemoryRollupTask(server, {
    actorId,
    prompt: EMA_MEMORY_ROLLUP_PROMPT,
    triggeredAt,
    thresholdTriggered: true,
  });
}

/**
 * Executes one memory-rollup agent run.
 * @param server - Server instance for shared resources.
 * @param job - Normalized memory-rollup task data.
 * @returns True when this run consumed at least one batch of source records.
 */
async function runMemoryRollupTaskOnce(
  server: Server,
  job: MemoryRollupTaskData,
): Promise<boolean> {
  const activitySnapshot = await server.memoryManager.getActivityWindow(
    job.actorId,
    job.triggeredAt,
  );
  const agent = await createBackgroundAgent(
    server,
    job.actorId,
    job.triggeredAt,
    "memory_rollup",
  );
  const agentState: AgentState = {
    systemPrompt: await server.memoryManager.buildSystemPromptForBackground(
      job.actorId,
      {
        activityRecords: activitySnapshot,
      },
    ),
    messages: [
      buildUserMessageFromActorInput({
        kind: "system",
        time: job.triggeredAt,
        inputs: [{ type: "text", text: job.prompt }],
      }),
    ],
    tools: baseTools,
    toolContext: {
      actorId: job.actorId,
      server,
      data: {
        task: "memory_rollup",
        triggeredAt: job.triggeredAt,
        activitySnapshot,
      },
    },
  };
  await runBackgroundAgentWithState(agent, agentState);
  return agentState.toolContext?.data?.memoryUpdated === true;
}

/**
 * Queues one rollup unit behind any existing rollup for the same actor.
 * @param actorId - The actor identifier used for serialization.
 * @param work - The rollup unit to execute.
 * @returns Result returned by the queued work item.
 */
async function enqueueActorMemoryRollup<T>(
  actorId: number,
  work: () => Promise<T>,
): Promise<T> {
  const previous = actorMemoryRollupQueue.get(actorId) ?? Promise.resolve();
  let result!: T;
  const current = previous
    .catch(() => {
      // Keep the per-actor queue alive after failures so later rollups still run.
    })
    .then(async () => {
      result = await work();
    });
  actorMemoryRollupQueue.set(actorId, current);
  try {
    await current;
    return result;
  } finally {
    if (actorMemoryRollupQueue.get(actorId) === current) {
      actorMemoryRollupQueue.delete(actorId);
    }
  }
}

function shouldScheduleFollowUp(
  pendingBefore: PendingWindowState,
  pendingAfter: PendingWindowState,
  threshold: number,
  ranOnce: boolean,
  didConsumePending: boolean,
): boolean {
  if (pendingAfter.count < threshold) {
    return false;
  }
  if (!ranOnce) {
    return true;
  }
  if (didConsumePending) {
    return true;
  }
  return pendingAfter.lastPendingId !== pendingBefore.lastPendingId;
}

function isThresholdTriggered(addition?: Record<string, unknown>): boolean {
  return addition?.source === "threshold" || addition?.reason === "threshold";
}

function stripInternalSleepSource(
  addition?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!addition || typeof addition !== "object" || Array.isArray(addition)) {
    return undefined;
  }
  const next = { ...addition };
  delete next.source;
  return Object.keys(next).length > 0 ? next : undefined;
}

async function createBackgroundAgent(
  server: Server,
  actorId: number,
  triggeredAt: number,
  task: ActorBackgroundJobData["task"],
  conversationId?: number,
): Promise<Agent> {
  const startedAt = formatLogTimestamp(triggeredAt);
  const date = startedAt.slice(0, 10);
  return new Agent(
    GlobalConfig.agent,
    new LLMClient(await server.dbService.getActorLLMConfig(actorId)),
    Logger.create({
      name: "agent.task",
      context: {
        actorId,
        task,
        ...(typeof conversationId === "number" ? { conversationId } : {}),
      },
      outputs: [
        { type: "console", level: "warn" },
        {
          type: "file",
          level: "debug",
          filePath: `actors/actor_${actorId}/${task}/${date}/${startedAt}.jsonl`,
        },
      ],
    }),
  );
}
