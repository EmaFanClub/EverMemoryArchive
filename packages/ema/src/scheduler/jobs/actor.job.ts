import { buildUserMessageFromActorInput } from "../../actor";
import { Agent, type AgentState } from "../../agent";
import { LLMClient } from "../../llm";
import { Logger } from "../../logger";
import {
  EMA_CALENDAR_ROLLUP_PROMPT,
  EMA_DIALOGUE_TICK_PROMPT,
} from "../../memory/prompts";
import {
  computeDailyRollupKinds,
  injectAllowedMemoryKinds,
} from "../../memory/update_tasks";
import type { ActorState } from "../../memory/base";
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
 * Data for dialogue-tick memory update jobs.
 */
export interface ActorDialogueTickJobData {
  actorId: number;
  conversationId: number;
  triggeredAt: number;
  /**
   * Optional preloaded actor state used to freeze the triggering context.
   */
  actorState?: ActorState;
}

/**
 * Data for calendar-triggered rollup jobs.
 */
export interface ActorCalendarRollupJobData {
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
 * Runs a dialogue-tick memory update job.
 * @param server - Server instance for shared resources.
 * @param job - Dialogue-tick job data.
 */
export async function runActorDialogueTickJob(
  server: Server,
  job: ActorDialogueTickJobData,
): Promise<void> {
  const prompt = injectAllowedMemoryKinds(
    EMA_DIALOGUE_TICK_PROMPT,
    "dialogue_tick",
    job.triggeredAt,
  );
  const agent = createBackgroundAgent(
    server,
    "ActorDialogueTickJob",
    job.actorId,
    job.triggeredAt,
  );
  const agentState: AgentState = {
    systemPrompt: await server.memoryManager.buildSystemPrompt(
      server.config.systemPrompt,
      job.actorId,
      job.conversationId,
      job.actorState,
    ),
    messages: [
      buildUserMessageFromActorInput({
        kind: "system",
        conversationId: job.conversationId,
        time: job.triggeredAt,
        inputs: [{ type: "text", text: prompt }],
      }),
    ],
    tools: server.config.baseTools,
    toolContext: {
      actorId: job.actorId,
      conversationId: job.conversationId,
      server,
      data: {
        task: "dialogue_tick",
        triggeredAt: job.triggeredAt,
      },
    },
  };
  await agent.runWithState(agentState);
}

/**
 * Runs a calendar-triggered memory rollup job.
 * @param server - Server instance for shared resources.
 * @param job - Calendar rollup job data.
 */
export async function runActorCalendarRollupJob(
  server: Server,
  job: ActorCalendarRollupJobData,
): Promise<void> {
  const triggeredAt = job.triggeredAt ?? Date.now();
  const prompt = injectAllowedMemoryKinds(
    EMA_CALENDAR_ROLLUP_PROMPT,
    "calendar_rollup",
    triggeredAt,
  );
  const agent = createBackgroundAgent(
    server,
    "ActorCalendarRollupJob",
    job.actorId,
    triggeredAt,
  );
  const agentState: AgentState = {
    systemPrompt: await server.memoryManager.buildSystemPrompt(
      server.config.systemPrompt,
      job.actorId,
    ),
    messages: [
      buildUserMessageFromActorInput({
        kind: "system",
        time: triggeredAt,
        inputs: [{ type: "text", text: prompt }],
      }),
    ],
    tools: server.config.baseTools,
    toolContext: {
      actorId: job.actorId,
      server,
      data: {
        task: "calendar_rollup",
        triggeredAt,
      },
    },
  };
  await agent.runWithState(agentState);
}

/**
 * ActorDialogueTick job handler implementation.
 */
export function createActorDialogueTickJobHandler(
  server: Server,
): JobHandler<"actor_dialogue_tick"> {
  return async (job) => {
    try {
      await runActorDialogueTickJob(server, job.attrs.data);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
}

/**
 * ActorCalendarRollup job handler implementation.
 */
export function createActorCalendarRollupJobHandler(
  server: Server,
): JobHandler<"actor_calendar_rollup"> {
  return async (job) => {
    try {
      await runActorCalendarRollupJob(server, {
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

/**
 * Computes update kinds for daily rollup jobs.
 * @param timestamp - Trigger timestamp in milliseconds.
 * @returns Ordered update kinds for the current rollup.
 */
export { computeDailyRollupKinds };

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
