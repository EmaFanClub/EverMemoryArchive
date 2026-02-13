import type { JobHandler } from "../base";
import type { ActorScope } from "../../actor";
import type { ActorState } from "../../memory/base";
import type { Server } from "../../server";
import { Agent, type AgentState } from "../../agent";
import { LLMClient } from "../../llm";
import { Logger } from "../../logger";
import { formatTimestamp } from "../../utils";

/**
 * Data shape for the agent job.
 */
export interface ActorJobData {
  /**
   * The id of the job owner (actor who created it). If not specified, means system.
   */
  ownerId?: number;
  /**
   * The actor scope for the agent to operate within.
   */
  actorScope: ActorScope;
  /**
   * The prompt for the agent to process.
   */
  prompt: string;
  /**
   * BufferMessages to provide context for the agent. If not provided, the agent
   * will read database to get the newest memory state.
   */
  actorState?: ActorState;
}

/**
 * ActorBackground job handler implementation.
 */
export function createActorBackgroundJobHandler(
  server: Server,
): JobHandler<"actor_background"> {
  return async (job) => {
    try {
      const { actorScope, prompt, actorState } = job.attrs.data;
      const agent = new Agent(
        server.config.agent,
        new LLMClient(server.config.llm),
        Logger.create({
          name: "ActorBackgroundJob",
          level: "full",
          transport: "file",
          filePath: `ActorBackgroundJob/actor-${actorScope.actorId}-${Date.now()}.log`,
        }),
      );
      const time = formatTimestamp("YYYY-MM-DD HH:mm:ss", Date.now());
      const agentState: AgentState = {
        systemPrompt: await server.memoryManager.buildSystemPrompt(
          actorScope.actorId,
          actorScope.conversationId,
          server.config.systemPrompt,
          actorState,
        ),
        messages: [
          {
            role: "user",
            contents: [
              { type: "text", text: `<system time="${time}">` },
              { type: "text", text: prompt },
              { type: "text", text: `</system>` },
            ],
          },
        ],
        tools: server.config.baseTools,
        toolContext: {
          actorScope,
          server,
        },
      };
      console.log("=== Agent Background Job ===");
      await agent.runWithState(agentState);
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
      const { actorScope, prompt, actorState } = job.attrs.data;
      const actor = await server.getActor(
        actorScope.userId,
        actorScope.actorId,
        actorScope.conversationId,
      );
      const time = formatTimestamp("YYYY-MM-DD HH:mm:ss", Date.now());
      await actor.work(
        [
          { type: "text", text: `<system time="${time}">` },
          { type: "text", text: prompt },
          { type: "text", text: `</system>` },
        ],
        false,
      );
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
}
