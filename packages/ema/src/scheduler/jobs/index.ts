/**
 * Job data definitions and mappings.
 */

import type { JobHandlerMap } from "../base";
import type { Server } from "../../server";
import { TestJobHandler, type TestJobData } from "./test.job";
import {
  createActorForegroundJobHandler,
  createActorHeartbeatActivityJobHandler,
  createActorMemoryRollupJobHandler,
  type ActorForegroundJobData,
  type ActorHeartbeatActivityJobData,
  type ActorMemoryRollupJobData,
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
   * ActorMemoryRollup job data mapping.
   */
  actor_memory_rollup: ActorMemoryRollupJobData;
  /**
   * HeartbeatActivity job data mapping.
   */
  heartbeat_activity: ActorHeartbeatActivityJobData;
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
    actor_memory_rollup: createActorMemoryRollupJobHandler(server),
    heartbeat_activity: createActorHeartbeatActivityJobHandler(server),
    actor_foreground: createActorForegroundJobHandler(server),
  };
}
