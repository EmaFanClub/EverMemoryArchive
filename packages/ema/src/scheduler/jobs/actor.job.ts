import { buildUserMessageFromActorInput } from "../../actor/utils";
import { Agent, type AgentState } from "../../agent";
import { LLMClient } from "../../llm";
import { Logger } from "../../logger";
import {
  EMA_CONVERSATION_ACTIVITY_PROMPT,
  EMA_HEARTBEAT_ACTIVITY_PROMPT,
  EMA_FOREGROUND_HEARTBEAT_PROMPT,
  EMA_MEMORY_ROLLUP_PROMPT,
} from "../../memory/prompts";
import type { ShortTermMemoryRecord } from "../../memory/base";
import type { Server } from "../../server";
import { formatTimestamp } from "../../utils";
import type { JobHandler } from "../base";

const actorMemoryRollupQueue = new Map<number, Promise<unknown>>();

interface PendingWindowState {
  count: number;
  lastPendingId: number | null;
}

/**
 * Data for actor foreground jobs.
 */
export interface ActorForegroundJobData {
  actorId: number;
  prompt: string;
  conversationId: number;
}

/**
 * Data for conversation-triggered activity jobs.
 */
export interface ActorConversationActivityJobData {
  actorId: number;
  conversationId: number;
  triggeredAt?: number;
}

/**
 * Data for memory-rollup jobs.
 */
export interface ActorMemoryRollupJobData {
  actorId: number;
  triggeredAt?: number;
  reason: "threshold" | "dayend";
}

/**
 * Data for heartbeat-triggered background activity jobs.
 */
export interface ActorHeartbeatActivityJobData {
  actorId: number;
  triggeredAt?: number;
}

/**
 * Runs the foreground actor execution directly without scheduler glue.
 * @param server - Server instance for shared resources.
 * @param job - Foreground job data.
 */
export async function runActorForegroundJob(
  server: Server,
  job: ActorForegroundJobData,
): Promise<void> {
  const actor = await server.getActor(job.actorId);
  await actor.enqueueActorInput(job.conversationId, {
    kind: "system",
    conversationId: job.conversationId,
    time: Date.now(),
    inputs: [{ type: "text", text: job.prompt }],
  });
}

/**
 * Runs a conversation-triggered activity job.
 * @param server - Server instance for shared resources.
 * @param job - Conversation activity job data.
 */
export async function runActorConversationActivityJob(
  server: Server,
  job: ActorConversationActivityJobData,
): Promise<void> {
  if (!server.memoryManager.tryEnterConversationActivity(job.conversationId)) {
    return;
  }
  const threshold = server.memoryManager.diaryUpdateEvery;
  const startedAt = job.triggeredAt ?? Date.now();
  let pendingBefore: PendingWindowState = {
    count: 0,
    lastPendingId: null,
  };
  let ranOnce = false;
  let didConsumePending = false;
  try {
    pendingBefore =
      await server.memoryManager.getPendingConversationWindowState(
        job.conversationId,
        startedAt,
      );
    if (pendingBefore.count >= threshold) {
      ranOnce = true;
      didConsumePending = await runActorConversationActivityJobOnce(server, {
        ...job,
        triggeredAt: startedAt,
      });
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
  if (
    shouldScheduleFollowUp(
      pendingBefore,
      pendingAfter,
      threshold,
      ranOnce,
      didConsumePending,
    )
  ) {
    await runActorConversationActivityJob(server, {
      ...job,
      triggeredAt: latestAt,
    });
  }
}

/**
 * Executes one conversation-to-activity update attempt.
 * @param server - Server instance for shared resources.
 * @param job - Normalized conversation activity job data.
 * @returns True when buffered source messages were marked as processed.
 */
async function runActorConversationActivityJobOnce(
  server: Server,
  job: Required<ActorConversationActivityJobData>,
): Promise<boolean> {
  const bufferSnapshot =
    await server.memoryManager.getBufferedConversationWindowSnapshot(
      job.conversationId,
      job.triggeredAt,
    );
  const activitySnapshot = await server.memoryManager.getVisibleActivityWindow(
    job.actorId,
    job.triggeredAt,
  );
  const agent = createBackgroundAgent(
    server,
    "ActorConversationActivityJob",
    job.actorId,
    job.triggeredAt,
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
        inputs: [{ type: "text", text: EMA_CONVERSATION_ACTIVITY_PROMPT }],
      }),
    ],
    tools: server.config.baseTools,
    toolContext: {
      actorId: job.actorId,
      conversationId: job.conversationId,
      server,
      data: {
        task: "conversation_activity",
        triggeredAt: job.triggeredAt,
      },
    },
  };
  await agent.runWithState(agentState);
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
  return processedMessageCount > 0;
}

/**
 * Runs a memory-rollup job. Rollups for the same actor are serialized.
 * @param server - Server instance for shared resources.
 * @param job - Memory-rollup job data.
 */
export async function runActorMemoryRollupJob(
  server: Server,
  job: ActorMemoryRollupJobData,
): Promise<void> {
  if (job.reason === "dayend") {
    await enqueueActorMemoryRollup(job.actorId, () =>
      runActorMemoryRollupJobOnce(server, {
        ...job,
        triggeredAt: job.triggeredAt ?? Date.now(),
      }),
    );
    return;
  }

  if (!server.memoryManager.tryEnterActivityToDayRollup(job.actorId)) {
    return;
  }
  const threshold = server.memoryManager.activityRollupEvery;
  let pendingBefore: PendingWindowState = {
    count: 0,
    lastPendingId: null,
  };
  let ranOnce = false;
  let didConsumePending = false;
  try {
    ({ pendingBefore, ranOnce, didConsumePending } =
      await enqueueActorMemoryRollup(job.actorId, async () => {
        const startedAt = Date.now();
        const before = await server.memoryManager.getPendingActivityWindowState(
          job.actorId,
          startedAt,
        );
        if (before.count < threshold) {
          return {
            pendingBefore: before,
            ranOnce: false,
            didConsumePending: false,
          };
        }
        return {
          pendingBefore: before,
          ranOnce: true,
          didConsumePending: await runActorMemoryRollupJobOnce(server, {
            ...job,
            triggeredAt: startedAt,
            reason: "threshold",
          }),
        };
      }));
  } finally {
    server.memoryManager.leaveActivityToDayRollup(job.actorId);
  }
  const latestAt = Date.now();
  const pendingAfter = await server.memoryManager.getPendingActivityWindowState(
    job.actorId,
    latestAt,
  );
  if (
    shouldScheduleFollowUp(
      pendingBefore,
      pendingAfter,
      threshold,
      ranOnce,
      didConsumePending,
    )
  ) {
    await runActorMemoryRollupJob(server, {
      ...job,
      triggeredAt: latestAt,
      reason: "threshold",
    });
  }
}

/**
 * Runs a heartbeat-triggered background activity job.
 * @param server - Server instance for shared resources.
 * @param job - Heartbeat activity job data.
 */
export async function runActorHeartbeatActivityJob(
  server: Server,
  job: ActorHeartbeatActivityJobData,
): Promise<void> {
  const triggeredAt = job.triggeredAt ?? Date.now();
  const activitySnapshot = await server.memoryManager.getVisibleActivityWindow(
    job.actorId,
    triggeredAt,
  );
  const agent = createBackgroundAgent(
    server,
    "ActorHeartbeatActivityJob",
    job.actorId,
    triggeredAt,
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
        time: triggeredAt,
        inputs: [{ type: "text", text: EMA_HEARTBEAT_ACTIVITY_PROMPT }],
      }),
    ],
    tools: server.config.baseTools,
    toolContext: {
      actorId: job.actorId,
      server,
      data: {
        task: "heartbeat_activity",
        triggeredAt,
      },
    },
  };
  await agent.runWithState(agentState);
  await runThresholdMemoryRollupWhenNeeded(
    server,
    job.actorId,
    triggeredAt,
    agentState,
  );
}

/**
 * ActorMemoryRollup job handler implementation.
 */
export function createActorMemoryRollupJobHandler(
  server: Server,
): JobHandler<"actor_memory_rollup"> {
  return async (job) => {
    try {
      await runActorMemoryRollupJob(server, job.attrs.data);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
}

/**
 * HeartbeatActivity job handler implementation.
 */
export function createActorHeartbeatActivityJobHandler(
  server: Server,
): JobHandler<"heartbeat_activity"> {
  return async (job) => {
    try {
      await runActorHeartbeatActivityJob(server, job.attrs.data);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
}

/**
 * ActorForeground job handler implementation.
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

export { EMA_FOREGROUND_HEARTBEAT_PROMPT };

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
  await runActorMemoryRollupJob(server, {
    actorId,
    triggeredAt,
    reason: "threshold",
  });
}

/**
 * Executes one rollup attempt for the provided actor and reason.
 * @param server - Server instance for shared resources.
 * @param job - Normalized memory-rollup job data.
 * @returns True when pending activity source records were marked as processed.
 */
async function runActorMemoryRollupJobOnce(
  server: Server,
  job: Required<ActorMemoryRollupJobData>,
): Promise<boolean> {
  const activitySnapshot = await server.memoryManager.getVisibleActivityWindow(
    job.actorId,
    job.triggeredAt,
  );
  const processedBefore = activitySnapshot.filter(
    (item) => typeof item.processedAt === "number",
  ).length;
  const agent = createBackgroundAgent(
    server,
    "ActorMemoryRollupJob",
    job.actorId,
    job.triggeredAt,
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
        inputs: [{ type: "text", text: EMA_MEMORY_ROLLUP_PROMPT }],
      }),
    ],
    tools: server.config.baseTools,
    toolContext: {
      actorId: job.actorId,
      server,
      data: {
        task: "memory_rollup",
        reason: job.reason,
        triggeredAt: job.triggeredAt,
        activitySnapshot,
      },
    },
  };
  await agent.runWithState(agentState);
  await finalizeDayEndVisibility(server, job, activitySnapshot);
  const processedAfter = activitySnapshot.filter(
    (item) => typeof item.processedAt === "number",
  ).length;
  return processedAfter > processedBefore;
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

async function finalizeDayEndVisibility(
  server: Server,
  job: Required<ActorMemoryRollupJobData>,
  activitySnapshot: ShortTermMemoryRecord[],
): Promise<void> {
  if (job.reason !== "dayend" || activitySnapshot.length === 0) {
    return;
  }
  const newestCreatedAtInSnapshot =
    activitySnapshot[activitySnapshot.length - 1]?.createdAt;
  if (typeof newestCreatedAtInSnapshot !== "number") {
    return;
  }
  await server.memoryManager.hideRolledUpActivities(
    job.actorId,
    newestCreatedAtInSnapshot,
  );
}

function createBackgroundAgent(
  server: Server,
  name: string,
  actorId: number,
  triggeredAt: number,
): Agent {
  const fileName = `${formatTimestamp("YYYY-MM-DD-HH-mm-ss", triggeredAt)}.log`;
  return new Agent(
    server.config.agent,
    new LLMClient(server.config.llm),
    Logger.create({
      name,
      level: "debug",
      transport: ["console", "file"],
      filePath: `${name}/actor_${actorId}/${fileName}`,
    }),
  );
}
