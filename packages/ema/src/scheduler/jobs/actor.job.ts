import { performance } from "node:perf_hooks";

import { buildUserMessageFromActorInput } from "../../actor/utils";
import { Agent, type AgentState, type RunFinishedEvent } from "../../agent";
import { LLMClient } from "../../llm";
import {
  formatLogTimestamp,
  formatTraceTimestamp,
  Logger,
} from "../../shared/logger";
import { formatTimestamp } from "../../shared/utils";
import { GlobalConfig } from "../../config/index";
import type { ShortTermMemoryRecord } from "../../memory/base";
import type { Server } from "../../server";
import { baseTools } from "../../tools";
import {
  recordAgentTokenUsage,
  type TokenUsageContext,
} from "../../token_usage";
import type { JobHandler } from "../base";

const actorMemoryRollupQueue = new Map<number, Promise<unknown>>();

type SleepTaskSource = "schedule" | "timer";
type ActorBackgroundTaskName = ActorBackgroundJobData["task"];

interface BackgroundAgentRun {
  agent: Agent;
  traceId: string;
}

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
  mode?: "training";
  logicalTime?: string;
  conversationId?: number;
  addition?: Record<string, unknown>;
}

export interface ActorBackgroundMemoryPolicy {
  bufferWindowSize: number;
  diaryUpdateEvery: number;
}

export interface ActorBackgroundRunOptions {
  mode?: "runtime" | "training";
  logger?: Logger;
  logStartedAt?: number;
  memoryPolicy?: ActorBackgroundMemoryPolicy;
}

interface ActorBackgroundRunContext {
  mode: "runtime" | "training";
  logger?: Logger;
  logStartedAt?: number;
  memoryPolicy?: ActorBackgroundMemoryPolicy;
}

type ForegroundConversationTask = ActorForegroundJobData["task"];

interface ChatTaskData {
  actorId: number;
  task: ForegroundConversationTask;
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
  triggeredAt: number;
}

interface SleepTaskData {
  actorId: number;
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
  summary?: string;
  conversationId: number;
  task: "chat" | "focus";
  addition?: Record<string, unknown>;
}

/**
 * Data for actor background jobs.
 */
export interface ActorBackgroundJobData {
  actorId: number;
  conversationId?: number;
  task: "activity" | "conversation_rollup" | "memory_rollup" | "wake" | "sleep";
  prompt?: string;
  summary?: string;
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
  server.logger?.info("Actor foreground task requested", {
    actorId: job.actorId,
    task: job.task,
    conversationId: job.conversationId,
    triggeredAt,
  });
  if (!(await canRunScheduledActorJob(server, job.actorId))) {
    server.logger?.info("Actor foreground task skipped", {
      actorId: job.actorId,
      task: job.task,
      conversationId: job.conversationId,
      triggeredAt,
      reason: "actor_disabled_or_missing",
    });
    return;
  }
  switch (job.task) {
    case "chat":
    case "focus":
      await runChatTask(server, {
        actorId: job.actorId,
        task: job.task,
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
  options: ActorBackgroundRunOptions = {},
): Promise<void> {
  const context = normalizeBackgroundRunContext(options);
  const logData = buildBackgroundTaskLogData(
    job.task,
    {
      actorId: job.actorId,
      conversationId: job.conversationId,
      triggeredAt,
      addition: job.addition,
    },
    context,
  );
  const dispatchStartedAt = performance.now();
  logBackgroundTaskRequested(server, logData, context);
  if (!(await canRunScheduledActorJob(server, job.actorId, context))) {
    logBackgroundTaskSkipped(
      server,
      logData,
      "actor_disabled_or_missing",
      undefined,
      context,
    );
    return;
  }
  try {
    switch (job.task) {
      case "activity":
        await runActivityTask(
          server,
          {
            actorId: job.actorId,
            prompt: job.prompt ?? "",
            triggeredAt,
          },
          context,
        );
        return;
      case "conversation_rollup":
        if (typeof job.conversationId !== "number") {
          throw new Error(
            "conversationId is required for actor background task 'conversation_rollup'.",
          );
        }
        await runConversationRollupTask(
          server,
          {
            actorId: job.actorId,
            conversationId: job.conversationId,
            prompt: job.prompt ?? "",
            triggeredAt,
          },
          context,
        );
        return;
      case "memory_rollup":
        await runMemoryRollupTask(
          server,
          {
            actorId: job.actorId,
            prompt: job.prompt ?? "",
            triggeredAt,
            thresholdTriggered: isThresholdTriggered(job.addition),
          },
          context,
        );
        return;
      case "wake":
        await runWakeTask(
          server,
          {
            actorId: job.actorId,
            triggeredAt,
          },
          context,
        );
        return;
      case "sleep":
        await runSleepTask(
          server,
          {
            actorId: job.actorId,
            triggeredAt,
            source: job.addition?.source === "timer" ? "timer" : "schedule",
            addition: stripInternalSleepSource(job.addition),
          },
          context,
        );
        return;
      default: {
        const unreachable: never = job.task;
        throw new Error(`Unsupported actor background task: ${unreachable}`);
      }
    }
  } catch (error) {
    if (!isBackgroundTaskErrorLogged(error)) {
      logBackgroundTaskFailed(
        server,
        logData,
        dispatchStartedAt,
        error,
        undefined,
        context,
      );
    }
    throw error;
  }
}

function normalizeBackgroundRunContext(
  options: ActorBackgroundRunOptions,
): ActorBackgroundRunContext {
  return {
    mode: options.mode ?? "runtime",
    ...(options.logger ? { logger: options.logger } : {}),
    ...(typeof options.logStartedAt === "number"
      ? { logStartedAt: options.logStartedAt }
      : {}),
    ...(options.memoryPolicy ? { memoryPolicy: options.memoryPolicy } : {}),
  };
}

async function canRunScheduledActorJob(
  server: Server,
  actorId: number,
  context: ActorBackgroundRunContext = { mode: "runtime" },
): Promise<boolean> {
  const actor = await server.dbService.actorDB.getActor(actorId);
  if (context.mode === "training") {
    return Boolean(actor);
  }
  return actor?.enabled === true;
}

/**
 * Dispatches one foreground chat task to the target actor.
 * @param server - Server instance for shared resources.
 * @param job - Normalized chat task data.
 */
async function runChatTask(server: Server, job: ChatTaskData): Promise<void> {
  const conversation = await server.dbService.conversationDB.getConversation(
    job.conversationId,
  );
  if (!conversation || conversation.actorId !== job.actorId) {
    server.logger?.warn("Actor foreground task skipped", {
      actorId: job.actorId,
      task: job.task,
      conversationId: job.conversationId,
      triggeredAt: job.triggeredAt,
      reason: "invalid_conversation",
    });
    return;
  }
  if (conversation.allowProactive !== true) {
    server.logger?.info("Actor foreground task skipped", {
      actorId: job.actorId,
      task: job.task,
      conversationId: job.conversationId,
      triggeredAt: job.triggeredAt,
      reason: "proactive_disabled",
    });
    return;
  }
  const actor = await server.actorRegistry.ensure(job.actorId);
  if (!actor.canRunActiveTasks()) {
    server.logger?.info("Actor foreground task skipped", {
      actorId: job.actorId,
      task: job.task,
      conversationId: job.conversationId,
      triggeredAt: job.triggeredAt,
      reason: "actor_not_awake",
    });
    return;
  }
  await actor.enqueueActorInput(job.conversationId, {
    kind: "system",
    conversationId: job.conversationId,
    time: job.triggeredAt,
    inputs: [
      {
        type: "text",
        text:
          job.task === "focus"
            ? await server.promptStore.loadTaskPrompt("conversation-focus")
            : await server.promptStore.loadTaskPrompt("scheduled-chat", {
                SCHEDULED_PROMPT: job.prompt,
              }),
      },
    ],
  });
  server.logger?.info("Actor foreground task enqueued", {
    actorId: job.actorId,
    task: job.task,
    conversationId: job.conversationId,
    triggeredAt: job.triggeredAt,
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
  context: ActorBackgroundRunContext,
): Promise<void> {
  const logData = buildBackgroundTaskLogData(
    "conversation_rollup",
    job,
    context,
  );
  if (!server.memoryManager.tryEnterConversationActivity(job.conversationId)) {
    logBackgroundTaskSkipped(
      server,
      logData,
      "already_running",
      {
        ...(job.followUp ? { followUp: true } : {}),
      },
      context,
    );
    return;
  }
  const threshold =
    context.memoryPolicy?.diaryUpdateEvery ??
    server.memoryManager.diaryUpdateEvery;
  const bufferWindowSize = context.memoryPolicy?.bufferWindowSize;
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
          bufferWindowSize,
        );
      if (pendingBefore.count >= threshold) {
        ranOnce = true;
        startedAt = logBackgroundTaskStarted(
          server,
          logData,
          {
            pendingCount: pendingBefore.count,
            threshold,
            ...(job.followUp ? { followUp: true } : {}),
          },
          context,
        );
        runResult = await runConversationRollupTaskOnce(server, job, context);
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
        bufferWindowSize,
      );
    const followUpScheduled = shouldScheduleFollowUp(
      pendingBefore,
      pendingAfter,
      threshold,
      ranOnce,
      didConsumePending,
    );
    if (startedAt === null) {
      logBackgroundTaskSkipped(
        server,
        logData,
        "threshold_not_reached",
        {
          pendingBefore: pendingBefore.count,
          pendingAfter: pendingAfter.count,
          threshold,
          followUpScheduled,
          ...(job.followUp ? { followUp: true } : {}),
        },
        context,
      );
    } else {
      logBackgroundTaskCompleted(
        server,
        logData,
        startedAt,
        {
          activityAdded: runResult?.activityAdded === true,
          processedMessageCount: runResult?.processedMessageCount ?? 0,
          pendingBefore: pendingBefore.count,
          pendingAfter: pendingAfter.count,
          followUpScheduled,
          ...(job.followUp ? { followUp: true } : {}),
        },
        context,
      );
      completed = true;
    }
    if (!followUpScheduled) {
      return;
    }
    await runConversationRollupTask(
      server,
      {
        ...job,
        triggeredAt: latestAt,
        followUp: true,
      },
      context,
    );
  } catch (error) {
    if (startedAt !== null && !completed) {
      logBackgroundTaskFailed(
        server,
        logData,
        startedAt,
        error,
        undefined,
        context,
      );
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
  context: ActorBackgroundRunContext,
): Promise<ConversationRollupRunResult> {
  const bufferSnapshot =
    await server.memoryManager.getBufferedConversationWindowSnapshot(
      job.conversationId,
      job.triggeredAt,
      context.memoryPolicy?.bufferWindowSize,
    );
  const activitySnapshot = await server.memoryManager.getActivityWindow(
    job.actorId,
    job.triggeredAt,
  );
  const { agent, traceId } = await createBackgroundAgent(
    server,
    job.actorId,
    job.triggeredAt,
    "conversation_rollup",
    job.conversationId,
    context,
  );
  const agentState: AgentState = {
    traceId,
    usageContext: buildBackgroundUsageContext(
      job.actorId,
      "conversation_rollup",
      job.conversationId,
      context,
    ),
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
  await runBackgroundAgentWithState(server, agent, agentState);
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
      context,
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
  context: ActorBackgroundRunContext,
): Promise<void> {
  const logData = buildBackgroundTaskLogData("memory_rollup", job, context);
  if (!job.thresholdTriggered) {
    let startedAt: number | null = null;
    try {
      const memoryUpdated = await enqueueActorMemoryRollup(job.actorId, () => {
        startedAt = logBackgroundTaskStarted(
          server,
          logData,
          {
            thresholdTriggered: false,
            ...(job.followUp ? { followUp: true } : {}),
          },
          context,
        );
        return runMemoryRollupTaskOnce(server, job, context);
      });
      logBackgroundTaskCompleted(
        server,
        logData,
        startedAt,
        {
          memoryUpdated,
          thresholdTriggered: false,
          ...(job.followUp ? { followUp: true } : {}),
        },
        context,
      );
    } catch (error) {
      if (startedAt !== null) {
        logBackgroundTaskFailed(
          server,
          logData,
          startedAt,
          error,
          undefined,
          context,
        );
      }
      throw error;
    }
    return;
  }

  if (!server.memoryManager.tryEnterActivityToDayRollup(job.actorId)) {
    logBackgroundTaskSkipped(
      server,
      logData,
      "already_running",
      {
        thresholdTriggered: true,
        ...(job.followUp ? { followUp: true } : {}),
      },
      context,
    );
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
          startedAt = logBackgroundTaskStarted(
            server,
            logData,
            {
              pendingCount: before.count,
              threshold,
              thresholdTriggered: true,
              ...(job.followUp ? { followUp: true } : {}),
            },
            context,
          );
          return {
            pendingBefore: before,
            ranOnce: true,
            didConsumePending: await runMemoryRollupTaskOnce(
              server,
              {
                ...job,
                triggeredAt: startedAtForWindow,
                thresholdTriggered: true,
              },
              context,
            ),
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
      logBackgroundTaskSkipped(
        server,
        logData,
        "threshold_not_reached",
        {
          pendingBefore: pendingBefore.count,
          pendingAfter: pendingAfter.count,
          threshold,
          followUpScheduled,
          thresholdTriggered: true,
          ...(job.followUp ? { followUp: true } : {}),
        },
        context,
      );
    } else {
      logBackgroundTaskCompleted(
        server,
        logData,
        startedAt,
        {
          memoryUpdated: didConsumePending,
          pendingBefore: pendingBefore.count,
          pendingAfter: pendingAfter.count,
          followUpScheduled,
          thresholdTriggered: true,
          ...(job.followUp ? { followUp: true } : {}),
        },
        context,
      );
      completed = true;
    }
    if (!followUpScheduled) {
      return;
    }
    await runMemoryRollupTask(
      server,
      {
        ...job,
        triggeredAt: latestAt,
        thresholdTriggered: true,
        followUp: true,
      },
      context,
    );
  } catch (error) {
    if (startedAt !== null && !completed) {
      logBackgroundTaskFailed(
        server,
        logData,
        startedAt,
        error,
        undefined,
        context,
      );
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
  context: ActorBackgroundRunContext,
): Promise<void> {
  const logData = buildBackgroundTaskLogData("activity", job, context);
  const actor = await server.actorRegistry.ensure(job.actorId);
  if (!actor.canRunActiveTasks()) {
    logBackgroundTaskSkipped(
      server,
      logData,
      "actor_not_awake",
      {
        status: actor.getStatus(),
      },
      context,
    );
    return;
  }
  const startedAt = logBackgroundTaskStarted(
    server,
    logData,
    undefined,
    context,
  );
  try {
    const activitySnapshot = await server.memoryManager.getActivityWindow(
      job.actorId,
      job.triggeredAt,
    );
    const { agent, traceId } = await createBackgroundAgent(
      server,
      job.actorId,
      job.triggeredAt,
      "activity",
      undefined,
      context,
    );
    const agentState: AgentState = {
      traceId,
      usageContext: buildBackgroundUsageContext(
        job.actorId,
        "activity",
        undefined,
        context,
      ),
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
              text: await server.promptStore.loadTaskPrompt(
                "scheduled-activity",
                {
                  SCHEDULED_PROMPT: job.prompt,
                },
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
    await runBackgroundAgentWithState(server, agent, agentState);
    await runThresholdMemoryRollupWhenNeeded(
      server,
      job.actorId,
      job.triggeredAt,
      agentState,
      context,
    );
    logBackgroundTaskCompleted(
      server,
      logData,
      startedAt,
      {
        activityAdded: agentState.toolContext?.data?.activityAdded === true,
      },
      context,
    );
  } catch (error) {
    logBackgroundTaskFailed(
      server,
      logData,
      startedAt,
      error,
      undefined,
      context,
    );
    throw error;
  }
}

/**
 * Runs one wake task and transitions the actor to the awake state on success.
 * @param server - Server instance for shared resources.
 * @param job - Wake task data.
 */
async function runWakeTask(
  server: Server,
  job: WakeTaskData,
  context: ActorBackgroundRunContext,
): Promise<void> {
  const logData = buildBackgroundTaskLogData("wake", job, context);
  const actor = await server.actorRegistry.ensure(job.actorId);
  if (!actor.beginWake()) {
    logBackgroundTaskSkipped(
      server,
      logData,
      "actor_not_sleeping",
      {
        status: actor.getStatus(),
      },
      context,
    );
    return;
  }
  const startedAt = logBackgroundTaskStarted(
    server,
    logData,
    undefined,
    context,
  );
  try {
    const activitySnapshot = await server.memoryManager.getActivityWindow(
      job.actorId,
      job.triggeredAt,
    );
    const { agent, traceId } = await createBackgroundAgent(
      server,
      job.actorId,
      job.triggeredAt,
      "wake",
      undefined,
      context,
    );
    const agentState: AgentState = {
      traceId,
      usageContext: buildBackgroundUsageContext(
        job.actorId,
        "wake",
        undefined,
        context,
      ),
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
              text: await server.promptStore.loadTaskPrompt("wake"),
            },
          ],
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
    await runBackgroundAgentWithState(server, agent, agentState);
    actor.completeWake();
    logBackgroundTaskCompleted(
      server,
      logData,
      startedAt,
      {
        status: actor.getStatus(),
      },
      context,
    );
  } catch (error) {
    actor.failWake();
    logBackgroundTaskFailed(
      server,
      logData,
      startedAt,
      error,
      undefined,
      context,
    );
    throw error;
  }
}

/**
 * Runs one sleep task. Scheduled sleep starts the timer, timer sleep performs the real transition.
 * @param server - Server instance for shared resources.
 * @param job - Sleep task data.
 */
async function runSleepTask(
  server: Server,
  job: SleepTaskData,
  context: ActorBackgroundRunContext,
): Promise<void> {
  const logData = buildBackgroundTaskLogData("sleep", job, context);
  const actor = await server.actorRegistry.ensure(job.actorId);
  if (job.source === "schedule") {
    if (!actor.startSleepTimer()) {
      logBackgroundTaskSkipped(
        server,
        logData,
        "actor_not_awake",
        {
          source: job.source,
          status: actor.getStatus(),
        },
        context,
      );
      return;
    }
    const startedAt = logBackgroundTaskStarted(
      server,
      logData,
      {
        source: job.source,
      },
      context,
    );
    logBackgroundTaskCompleted(
      server,
      logData,
      startedAt,
      {
        source: job.source,
        result: "sleep_timer_started",
      },
      context,
    );
    return;
  }
  if (!actor.beginSleep()) {
    logBackgroundTaskSkipped(
      server,
      logData,
      "actor_not_awake",
      {
        source: job.source,
        status: actor.getStatus(),
      },
      context,
    );
    return;
  }
  const startedAt = logBackgroundTaskStarted(
    server,
    logData,
    {
      source: job.source,
    },
    context,
  );
  try {
    await runMemoryRollupTask(
      server,
      {
        actorId: job.actorId,
        prompt: await server.promptStore.loadTaskPrompt("memory-rollup"),
        triggeredAt: job.triggeredAt,
        thresholdTriggered: false,
      },
      context,
    );
    const activitySnapshot = await server.memoryManager.getActivityWindow(
      job.actorId,
      job.triggeredAt,
    );
    const { agent, traceId } = await createBackgroundAgent(
      server,
      job.actorId,
      job.triggeredAt,
      "sleep",
      undefined,
      context,
    );
    const agentState: AgentState = {
      traceId,
      usageContext: buildBackgroundUsageContext(
        job.actorId,
        "sleep",
        undefined,
        context,
      ),
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
              text: await server.promptStore.loadTaskPrompt("sleep"),
            },
          ],
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
    await runBackgroundAgentWithState(server, agent, agentState);
    actor.completeSleep();
    logBackgroundTaskCompleted(
      server,
      logData,
      startedAt,
      {
        source: job.source,
        status: actor.getStatus(),
      },
      context,
    );
  } catch (error) {
    actor.failSleep();
    logBackgroundTaskFailed(
      server,
      logData,
      startedAt,
      error,
      undefined,
      context,
    );
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
  context: ActorBackgroundRunContext = { mode: "runtime" },
): BackgroundTaskLogData {
  return {
    actorId: job.actorId,
    task,
    triggeredAt: job.triggeredAt,
    ...(context.mode === "training"
      ? {
          mode: "training" as const,
          logicalTime: formatTimestamp("YYYY-MM-DD HH:mm:ss", job.triggeredAt),
        }
      : {}),
    ...(typeof job.conversationId === "number"
      ? { conversationId: job.conversationId }
      : {}),
    ...(job.addition ? { addition: job.addition } : {}),
  };
}

function buildBackgroundUsageContext(
  actorId: number,
  task: ActorBackgroundTaskName,
  conversationId: number | undefined,
  context: ActorBackgroundRunContext,
): TokenUsageContext {
  return {
    actorId,
    source: context.mode === "training" ? "training" : task,
    ...(typeof conversationId === "number" ? { conversationId } : {}),
  };
}

function logBackgroundTaskRequested(
  server: Server,
  data: BackgroundTaskLogData,
  context: ActorBackgroundRunContext = { mode: "runtime" },
): void {
  logBackgroundTask(
    context,
    server,
    "info",
    "Actor background task requested",
    data,
  );
}

function logBackgroundTaskStarted(
  server: Server,
  data: BackgroundTaskLogData,
  extra?: Record<string, unknown>,
  context: ActorBackgroundRunContext = { mode: "runtime" },
): number {
  logBackgroundTask(context, server, "info", "Actor background task started", {
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
  context: ActorBackgroundRunContext = { mode: "runtime" },
): void {
  logBackgroundTask(context, server, "info", "Actor background task skipped", {
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
  context: ActorBackgroundRunContext = { mode: "runtime" },
): void {
  logBackgroundTask(
    context,
    server,
    "info",
    "Actor background task completed",
    {
      ...data,
      ...buildDurationData(startedAt),
      ...extra,
    },
  );
}

function logBackgroundTaskFailed(
  server: Server,
  data: BackgroundTaskLogData,
  startedAt: number | null,
  error: unknown,
  extra?: Record<string, unknown>,
  context: ActorBackgroundRunContext = { mode: "runtime" },
): void {
  markBackgroundTaskErrorLogged(error);
  logBackgroundTask(context, server, "error", "Actor background task failed", {
    ...data,
    ...buildDurationData(startedAt),
    ...extra,
    error,
  });
}

function backgroundLogger(
  server: Server,
  context: ActorBackgroundRunContext,
): Logger | undefined {
  return context.logger ?? server.logger;
}

function logBackgroundTask(
  context: ActorBackgroundRunContext,
  server: Server,
  level: "info" | "error",
  message: string,
  data: unknown,
): void {
  const logger = backgroundLogger(server, context);
  if (!logger) {
    return;
  }
  if (context.mode === "training") {
    logger.debug(message, data);
    return;
  }
  logger[level](message, data);
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
  server: Server,
  agent: Agent,
  agentState: AgentState,
): Promise<void> {
  const finishedRef: { value?: RunFinishedEvent } = {};
  const handleFinished = (event: RunFinishedEvent) => {
    finishedRef.value = event;
  };
  const usageWrites = new Set<Promise<void>>();
  const handleUsage = (event: Parameters<typeof recordAgentTokenUsage>[1]) => {
    const write: Promise<void> = recordAgentTokenUsage(
      server.dbService,
      event,
      server.bus,
    )
      .then(() => undefined)
      .catch((error) => {
        server.logger.warn("Failed to record actor token usage", {
          actorId: event.usageContext.actorId,
          source: event.usageContext.source,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    usageWrites.add(write);
    void write.finally(() => {
      usageWrites.delete(write);
    });
  };
  agent.events.once("runFinished", handleFinished);
  agent.events.on("llmUsageReceived", handleUsage);
  try {
    await agent.runWithState(agentState);
  } finally {
    agent.events.off("runFinished", handleFinished);
    agent.events.off("llmUsageReceived", handleUsage);
    await Promise.allSettled(Array.from(usageWrites));
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
  context: ActorBackgroundRunContext,
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
  await runMemoryRollupTask(
    server,
    {
      actorId,
      prompt: await server.promptStore.loadTaskPrompt("memory-rollup"),
      triggeredAt,
      thresholdTriggered: true,
    },
    context,
  );
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
  context: ActorBackgroundRunContext,
): Promise<boolean> {
  const activitySnapshot = await server.memoryManager.getActivityWindow(
    job.actorId,
    job.triggeredAt,
  );
  const { agent, traceId } = await createBackgroundAgent(
    server,
    job.actorId,
    job.triggeredAt,
    "memory_rollup",
    undefined,
    context,
  );
  const agentState: AgentState = {
    traceId,
    usageContext: buildBackgroundUsageContext(
      job.actorId,
      "memory_rollup",
      undefined,
      context,
    ),
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
  await runBackgroundAgentWithState(server, agent, agentState);
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
  _triggeredAt: number,
  task: ActorBackgroundJobData["task"],
  _conversationId?: number,
  context: ActorBackgroundRunContext = { mode: "runtime" },
): Promise<BackgroundAgentRun> {
  const startedAt = formatTraceTimestamp();
  const date = startedAt.slice(0, 10);
  const traceId =
    context.mode === "training"
      ? `actors/actor_${actorId}/train/${task}/${date}/${startedAt}`
      : `actors/actor_${actorId}/${task}/${date}/${startedAt}`;
  return {
    agent: new Agent(
      new LLMClient(await server.dbService.getActorLLMConfig(actorId)),
    ),
    traceId,
  };
}
