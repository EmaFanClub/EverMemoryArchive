/**
 * Job data definitions and mappings.
 */

import type { JobHandlerMap } from "../base";
import type { Server } from "../../server";
import { TestJobHandler, type TestJobData } from "./test.job";
import {
  createActorForegroundJobHandler,
  createActorBackgroundJobHandler,
  type ActorJobData,
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
   * ActorBackground job data mapping.
   */
  actor_background: ActorJobData;
  /**
   * ActorForeground job data mapping.
   */
  actor_foreground: ActorJobData;
}

/**
 * Creates a mapping from job names to their handler implementations.
 * @param server - Server instance for accessing shared services.
 * @returns The job handler map.
 */
export function createJobHandlers(server: Server): JobHandlerMap {
  return {
    test: TestJobHandler,
    actor_background: createActorBackgroundJobHandler(server),
    actor_foreground: createActorForegroundJobHandler(server),
  };
}
