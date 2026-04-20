import { buildUserMessageFromActorInput } from "../../actor/utils";
import { Agent, type AgentState } from "../../agent";
import { LLMClient } from "../../llm";
import { Logger } from "../../logger";
import { EMA_MEMORY_ROLLUP_PROMPT } from "../../memory/prompts";
import type { ShortTermMemoryRecord } from "../../memory/base";
import type { Server } from "../../server";
import { formatTimestamp } from "../../utils";
import type { JobHandler } from "../base";

const actorMemoryRollupQueue = new Map<number, Promise<unknown>>();

type MemoryRollupReason = "threshold" | "dayend";

interface PendingWindowState {
  count: number;
  lastPendingId: number | null;
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
}

interface MemoryRollupTaskData {
  actorId: number;
  prompt: string;
  triggeredAt: number;
  reason: MemoryRollupReason;
}

interface ActivityTaskData {
  actorId: number;
  prompt: string;
  triggeredAt: number;
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
  task: "activity" | "conversation_rollup" | "memory_rollup";
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
        reason: getMemoryRollupReason(job.addition),
      });
      return;
    default: {
      const unreachable: never = job.task;
      throw new Error(`Unsupported actor background task: ${unreachable}`);
    }
  }
}

/**
 * Dispatches one foreground chat task to the target actor.
 * @param server - Server instance for shared resources.
 * @param job - Normalized chat task data.
 */
async function runChatTask(server: Server, job: ChatTaskData): Promise<void> {
  const actor = await server.getActor(job.actorId);
  await actor.enqueueActorInput(job.conversationId, {
    kind: "system",
    conversationId: job.conversationId,
    time: job.triggeredAt,
    inputs: [{ type: "text", text: job.prompt }],
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
  if (!server.memoryManager.tryEnterConversationActivity(job.conversationId)) {
    return;
  }
  const threshold = server.memoryManager.diaryUpdateEvery;
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
        job.triggeredAt,
      );
    if (pendingBefore.count >= threshold) {
      ranOnce = true;
      didConsumePending = await runConversationRollupTaskOnce(server, job);
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
    await runConversationRollupTask(server, {
      ...job,
      triggeredAt: latestAt,
    });
  }
}

/**
 * Executes one conversation-to-activity update attempt.
 * @param server - Server instance for shared resources.
 * @param job - Normalized conversation rollup task data.
 * @returns True when buffered source messages were marked as processed.
 */
async function runConversationRollupTaskOnce(
  server: Server,
  job: ConversationRollupTaskData,
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
        inputs: [{ type: "text", text: job.prompt }],
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
 * Runs one memory-rollup task. Rollups for the same actor are serialized.
 * @param server - Server instance for shared resources.
 * @param job - Memory rollup task data.
 */
async function runMemoryRollupTask(
  server: Server,
  job: MemoryRollupTaskData,
): Promise<void> {
  if (job.reason === "dayend") {
    await enqueueActorMemoryRollup(job.actorId, () =>
      runMemoryRollupTaskOnce(server, job),
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
          didConsumePending: await runMemoryRollupTaskOnce(server, {
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
    await runMemoryRollupTask(server, {
      ...job,
      triggeredAt: latestAt,
      reason: "threshold",
    });
  }
}

/**
 * Runs one heartbeat-triggered background activity task.
 * @param server - Server instance for shared resources.
 * @param job - Background activity task data.
 */
async function runActivityTask(
  server: Server,
  job: ActivityTaskData,
): Promise<void> {
  const activitySnapshot = await server.memoryManager.getVisibleActivityWindow(
    job.actorId,
    job.triggeredAt,
  );
  const agent = createBackgroundAgent(
    server,
    "ActorHeartbeatActivityJob",
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
        inputs: [{ type: "text", text: job.prompt }],
      }),
    ],
    tools: server.config.baseTools,
    toolContext: {
      actorId: job.actorId,
      server,
      data: {
        task: "heartbeat_activity",
        triggeredAt: job.triggeredAt,
      },
    },
  };
  await agent.runWithState(agentState);
  await runThresholdMemoryRollupWhenNeeded(
    server,
    job.actorId,
    job.triggeredAt,
    agentState,
  );
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
    reason: "threshold",
  });
}

/**
 * Executes one rollup attempt for the provided actor and reason.
 * @param server - Server instance for shared resources.
 * @param job - Normalized memory-rollup task data.
 * @returns True when pending activity source records were marked as processed.
 */
async function runMemoryRollupTaskOnce(
  server: Server,
  job: MemoryRollupTaskData,
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
        inputs: [{ type: "text", text: job.prompt }],
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
  job: MemoryRollupTaskData,
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

function getMemoryRollupReason(
  addition?: Record<string, unknown>,
): MemoryRollupReason {
  return addition?.reason === "dayend" ? "dayend" : "threshold";
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
