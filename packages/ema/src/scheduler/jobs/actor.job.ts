import { buildUserMessageFromActorInput } from "../../actor/utils";
import { Agent, type AgentState } from "../../agent";
import { LLMClient } from "../../llm";
import { Logger } from "../../logger";
import {
  EMA_ACTIVITY_TICK_PROMPT,
  EMA_HEARTBEAT_ACTIVITY_PROMPT,
  EMA_FOREGROUND_HEARTBEAT_PROMPT,
  EMA_MEMORY_UPDATE_PROMPT,
} from "../../memory/prompts";
import type { Server } from "../../server";
import { formatTimestamp } from "../../utils";
import type { JobHandler } from "../base";

/**
 * Data for actor foreground jobs.
 */
export interface ActorForegroundJobData {
  actorId: number;
  prompt: string;
  conversationId?: number;
}

/**
 * Data for activity-tick memory update jobs.
 */
export interface ActorActivityTickJobData {
  actorId: number;
  conversationId: number;
  triggeredAt?: number;
}

/**
 * Data for calendar-triggered memory update jobs.
 */
export interface ActorMemoryUpdateJobData {
  actorId: number;
  triggeredAt?: number;
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
  if (typeof job.conversationId !== "number") {
    throw new Error(
      "Foreground jobs without conversationId are not yet supported.",
    );
  }
  const actor = await server.getActor(job.actorId);
  await actor.enqueueActorInput(job.conversationId, {
    kind: "system",
    conversationId: job.conversationId,
    time: Date.now(),
    inputs: [{ type: "text", text: job.prompt }],
  });
}

/**
 * Runs an activity-tick memory update job.
 * @param server - Server instance for shared resources.
 * @param job - Activity-tick job data.
 */
export async function runActorActivityTickJob(
  server: Server,
  job: ActorActivityTickJobData,
): Promise<void> {
  const triggeredAt = job.triggeredAt ?? Date.now();
  const agent = createBackgroundAgent(
    server,
    "ActorActivityTickJob",
    job.actorId,
    triggeredAt,
  );
  const agentState: AgentState = {
    systemPrompt: await server.memoryManager.buildSystemPromptForActivityUpdate(
      job.actorId,
      job.conversationId,
    ),
    messages: [
      buildUserMessageFromActorInput({
        kind: "system",
        conversationId: job.conversationId,
        time: triggeredAt,
        inputs: [{ type: "text", text: EMA_ACTIVITY_TICK_PROMPT }],
      }),
    ],
    tools: server.config.baseTools,
    toolContext: {
      actorId: job.actorId,
      conversationId: job.conversationId,
      server,
      data: {
        task: "activity_tick",
        triggeredAt,
      },
    },
  };
  await agent.runWithState(agentState);
}

/**
 * Runs a calendar-triggered memory update job.
 * @param server - Server instance for shared resources.
 * @param job - Memory-update job data.
 */
export async function runActorMemoryUpdateJob(
  server: Server,
  job: ActorMemoryUpdateJobData,
): Promise<void> {
  const triggeredAt = job.triggeredAt ?? Date.now();
  const agent = createBackgroundAgent(
    server,
    "ActorMemoryUpdateJob",
    job.actorId,
    triggeredAt,
  );
  const agentState: AgentState = {
    systemPrompt: await server.memoryManager.buildSystemPromptForMemoryUpdate(
      job.actorId,
    ),
    messages: [
      buildUserMessageFromActorInput({
        kind: "system",
        time: triggeredAt,
        inputs: [{ type: "text", text: EMA_MEMORY_UPDATE_PROMPT }],
      }),
    ],
    tools: server.config.baseTools,
    toolContext: {
      actorId: job.actorId,
      server,
      data: {
        task: "memory_update",
        triggeredAt,
        activitySnapshot: await server.memoryManager.getActivitySnapshot(
          job.actorId,
          triggeredAt,
        ),
      },
    },
  };
  await agent.runWithState(agentState);
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
  const agent = createBackgroundAgent(
    server,
    "ActorHeartbeatActivityJob",
    job.actorId,
    triggeredAt,
  );
  const agentState: AgentState = {
    systemPrompt:
      await server.memoryManager.buildSystemPromptForHeartbeatActivity(
        job.actorId,
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
}

/**
 * ActorActivityTick job handler implementation.
 */
export function createActorActivityTickJobHandler(
  server: Server,
): JobHandler<"actor_activity_tick"> {
  return async (job) => {
    try {
      await runActorActivityTickJob(server, job.attrs.data);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
}

/**
 * ActorMemoryUpdate job handler implementation.
 */
export function createActorMemoryUpdateJobHandler(
  server: Server,
): JobHandler<"actor_memory_update"> {
  return async (job) => {
    try {
      await runActorMemoryUpdateJob(server, {
        ...job.attrs.data,
        triggeredAt: job.attrs.data.triggeredAt ?? Date.now(),
      });
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
