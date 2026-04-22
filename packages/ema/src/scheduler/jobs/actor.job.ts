import { buildUserMessageFromActorInput } from "../../actor/utils";
import { Agent, type AgentState } from "../../agent";
import { LLMClient } from "../../llm";
import { Logger } from "../../logger";
import {
  EMA_MEMORY_ROLLUP_PROMPT,
  EMA_SCHEDULED_ACTIVITY_PROMPT,
  EMA_SCHEDULED_CHAT_PROMPT,
  EMA_SLEEP_PROMPT,
  EMA_WAKE_PROMPT,
} from "../../memory/prompts";
import type { ShortTermMemoryRecord } from "../../memory/base";
import type { Server } from "../../server";
import { formatTimestamp } from "../../utils";
import type { JobHandler } from "../base";

const actorMemoryRollupQueue = new Map<number, Promise<unknown>>();

type SleepTaskSource = "schedule" | "timer";

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
  thresholdTriggered: boolean;
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
  const activitySnapshot = await server.memoryManager.getActivityWindow(
    job.actorId,
    job.triggeredAt,
  );
  const agent = createBackgroundAgent(
    server,
    "ActorConversationRollupTask",
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
        task: "conversation_rollup",
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
  if (!job.thresholdTriggered) {
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
            thresholdTriggered: true,
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
      thresholdTriggered: true,
    });
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
  const actor = await server.actorRegistry.ensure(job.actorId);
  if (!actor.canRunActiveTasks()) {
    return;
  }
  const activitySnapshot = await server.memoryManager.getActivityWindow(
    job.actorId,
    job.triggeredAt,
  );
  const agent = createBackgroundAgent(
    server,
    "ActorActivityTask",
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
    tools: server.config.baseTools,
    toolContext: {
      actorId: job.actorId,
      server,
      data: {
        task: "activity",
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
 * Runs one wake task and transitions the actor to the awake state on success.
 * @param server - Server instance for shared resources.
 * @param job - Wake task data.
 */
async function runWakeTask(server: Server, job: WakeTaskData): Promise<void> {
  const actor = await server.actorRegistry.ensure(job.actorId);
  if (!actor.beginWake()) {
    return;
  }
  try {
    const activitySnapshot = await server.memoryManager.getActivityWindow(
      job.actorId,
      job.triggeredAt,
    );
    const agent = createBackgroundAgent(
      server,
      "ActorWakeTask",
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
          inputs: [{ type: "text", text: EMA_WAKE_PROMPT }],
        }),
      ],
      tools: server.config.baseTools,
      toolContext: {
        actorId: job.actorId,
        server,
        data: {
          task: "wake",
          triggeredAt: job.triggeredAt,
        },
      },
    };
    await agent.runWithState(agentState);
    actor.completeWake();
  } catch (error) {
    actor.failWake();
    throw error;
  }
}

/**
 * Runs one sleep task. Scheduled sleep starts the timer, timer sleep performs the real transition.
 * @param server - Server instance for shared resources.
 * @param job - Sleep task data.
 */
async function runSleepTask(server: Server, job: SleepTaskData): Promise<void> {
  const actor = await server.actorRegistry.ensure(job.actorId);
  if (job.source === "schedule") {
    actor.startSleepTimer();
    return;
  }
  if (!actor.beginSleep()) {
    return;
  }
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
    const agent = createBackgroundAgent(
      server,
      "ActorSleepTask",
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
          inputs: [{ type: "text", text: EMA_SLEEP_PROMPT }],
        }),
      ],
      tools: server.config.baseTools,
      toolContext: {
        actorId: job.actorId,
        server,
        data: {
          task: "sleep",
          triggeredAt: job.triggeredAt,
        },
      },
    };
    await agent.runWithState(agentState);
    actor.completeSleep();
  } catch (error) {
    actor.failSleep();
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
  const agent = createBackgroundAgent(
    server,
    "ActorMemoryRollupTask",
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
        triggeredAt: job.triggeredAt,
        activitySnapshot,
      },
    },
  };
  await agent.runWithState(agentState);
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
