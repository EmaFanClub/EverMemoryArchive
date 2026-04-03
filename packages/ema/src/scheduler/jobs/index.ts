/**
 * Job data definitions and mappings.
 */

import type { JobHandlerMap } from "../base";
import type { Server } from "../../server";
import { TestJobHandler, type TestJobData } from "./test.job";
import {
  createActorActivityTickJobHandler,
  createActorForegroundJobHandler,
  createActorMemoryUpdateJobHandler,
  type ActorActivityTickJobData,
  type ActorForegroundJobData,
  type ActorMemoryUpdateJobData,
} from "./actor.job";

/**
 * Mapping from job name to its data schema.
 */
export interface JobDataMap {
  /**
   * Demo job data mapping.
   */
  test: TestJobData;
  /**
   * ActorActivityTick job data mapping.
   */
  actor_activity_tick: ActorActivityTickJobData;
  /**
   * ActorMemoryUpdate job data mapping.
   */
  actor_memory_update: ActorMemoryUpdateJobData;
  /**
   * ActorForeground job data mapping.
   */
  actor_foreground: ActorForegroundJobData;
}

/**
 * Creates a mapping from job names to their handler implementations.
 * @param server - Server instance for accessing shared services.
 * @returns The job handler map.
 */
export function createJobHandlers(server: Server): JobHandlerMap {
  return {
    test: TestJobHandler,
    actor_activity_tick: createActorActivityTickJobHandler(server),
    actor_memory_update: createActorMemoryUpdateJobHandler(server),
    actor_foreground: createActorForegroundJobHandler(server),
  };
}
