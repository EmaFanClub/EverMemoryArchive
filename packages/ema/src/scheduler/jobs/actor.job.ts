import type { JobHandler } from "../base";
import { buildUserMessageFromActorInput } from "../../actor";
import type { ActorState, ShortTermMemory } from "../../memory/base";
import type { Server } from "../../server";
import { Agent, type AgentState } from "../../agent";
import { LLMClient } from "../../llm";
import { Logger } from "../../logger";

type ShortTermMemoryKind = ShortTermMemory["kind"];

/**
 * Input for directly executing a background memory-update run.
 */
export interface ActorBackgroundExecutionInput {
  actorId: number;
  conversationId: number;
  /**
   * The prompt for the agent to process.
   */
  prompt: string;
  /**
   * Optional preloaded actor state used to build the system prompt.
   */
  actorState?: ActorState;
  /**
   * Allowed short-term memory kinds for this execution.
   */
  updateMemoryKinds?: ShortTermMemoryKind[];
  /**
   * Trigger timestamp in milliseconds. Defaults to now.
   */
  triggeredAt?: number;
}

/**
 * Input for directly executing a foreground system run.
 */
export interface ActorForegroundExecutionInput {
  actorId: number;
  conversationId: number;
  /**
   * The prompt for the actor to process.
   */
  prompt: string;
  /**
   * Trigger timestamp in milliseconds. Defaults to now.
   */
  triggeredAt?: number;
}

/**
 * Data shape for the agent job.
 */
export interface ActorJobData {
  /**
   * The id of the job owner (actor who created it). If not specified, means system.
   */
  ownerId?: number;
  actorId: number;
  conversationId: number;
  /**
   * The prompt for the agent to process.
   */
  prompt: string;
  /**
   * BufferMessages to provide context for the agent. If not provided, the agent
   * will read database to get the newest memory state.
   */
  actorState?: ActorState;
  /**
   * Allowed short-term memory kinds for this job.
   */
  updateMemoryKinds?: ShortTermMemoryKind[];
}

/**
 * Deduplicates and orders update kinds.
 * @param kinds - Input update kinds.
 * @returns Ordered update kinds.
 */
function normalizeUpdateKinds(
  kinds: ShortTermMemoryKind[],
): ShortTermMemoryKind[] {
  const order: ShortTermMemoryKind[] = ["day", "week", "month", "year"];
  const set = new Set<ShortTermMemoryKind>(kinds);
  return order.filter((kind) => set.has(kind));
}

/**
 * Computes update kinds for daily rollup jobs.
 * @param timestamp - Trigger timestamp in milliseconds.
 * @returns Ordered update kinds for the current rollup.
 */
export function computeDailyRollupKinds(
  timestamp: number,
): ShortTermMemoryKind[] {
  const date = new Date(timestamp);
  const kinds: ShortTermMemoryKind[] = ["week"];
  if (date.getDay() === 1) {
    kinds.push("month");
  }
  if (date.getDate() === 1) {
    kinds.push("year");
  }
  return kinds;
}

/**
 * Builds the final background prompt with resolved memory update metadata.
 * @param prompt - Original task prompt.
 * @param updateMemoryKinds - Allowed memory kinds for this execution.
 * @returns Prompt text to send to the model.
 */
function buildBackgroundPrompt(
  prompt: string,
  updateMemoryKinds: ShortTermMemoryKind[] | undefined,
): string {
  if (!updateMemoryKinds) {
    return prompt;
  }
  return prompt.replaceAll("{MEMORY_KINDS}", updateMemoryKinds.join(", "));
}

/**
 * Runs the background memory-update execution directly without scheduler glue.
 * @param server - Server instance for shared resources.
 * @param input - Execution input for the background run.
 */
export async function runActorBackgroundExecution(
  server: Server,
  input: ActorBackgroundExecutionInput,
): Promise<void> {
  const triggeredAt = input.triggeredAt ?? Date.now();
  const updateMemoryKinds = input.updateMemoryKinds
    ? normalizeUpdateKinds(input.updateMemoryKinds)
    : computeDailyRollupKinds(triggeredAt);
  const backgroundPrompt = buildBackgroundPrompt(
    input.prompt,
    updateMemoryKinds,
  );
  const agent = new Agent(
    server.config.agent,
    new LLMClient(server.config.llm),
    Logger.create({
      name: "ActorBackgroundJob",
      level: "full",
      transport: "file",
      filePath: `ActorBackgroundJob/actor-${input.actorId}-${triggeredAt}.log`,
    }),
  );
  const agentState: AgentState = {
    systemPrompt: await server.memoryManager.buildSystemPrompt(
      input.actorId,
      input.conversationId,
      server.config.systemPrompt,
      input.actorState,
    ),
    messages: [
      buildUserMessageFromActorInput(
        {
          kind: "system",
          conversationId: input.conversationId,
          time: triggeredAt,
          inputs: [{ type: "text", text: backgroundPrompt }],
        },
        null,
      ),
    ],
    tools: server.config.baseTools,
    toolContext: {
      actorId: input.actorId,
      conversationId: input.conversationId,
      server,
      updateMemoryKinds,
    },
  };
  await agent.runWithState(agentState);
}

/**
 * Runs the foreground actor execution directly without scheduler glue.
 * @param server - Server instance for shared resources.
 * @param input - Execution input for the foreground run.
 */
export async function runActorForegroundExecution(
  server: Server,
  input: ActorForegroundExecutionInput,
): Promise<void> {
  const actor = await server.getActor(input.actorId);
  await actor.enqueueActorInput(input.conversationId, {
    kind: "system",
    conversationId: input.conversationId,
    time: input.triggeredAt ?? Date.now(),
    inputs: [{ type: "text", text: input.prompt }],
  });
}

/**
 * ActorBackground job handler implementation.
 */
export function createActorBackgroundJobHandler(
  server: Server,
): JobHandler<"actor_background"> {
  return async (job) => {
    try {
      await runActorBackgroundExecution(server, {
        actorId: job.attrs.data.actorId,
        conversationId: job.attrs.data.conversationId,
        prompt: job.attrs.data.prompt,
        actorState: job.attrs.data.actorState,
        updateMemoryKinds: job.attrs.data.updateMemoryKinds,
        triggeredAt: Date.now(),
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
      await runActorForegroundExecution(server, {
        actorId: job.attrs.data.actorId,
        conversationId: job.attrs.data.conversationId,
        prompt: job.attrs.data.prompt,
        triggeredAt: Date.now(),
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
}
