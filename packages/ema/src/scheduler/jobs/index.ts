/**
 * Job data definitions and mappings.
 */

import type { JobHandlerMap } from "../base";
import type { Server } from "../../server";
import { TestJobHandler, type TestJobData } from "./test.job";
import {
  createActorCalendarRollupJobHandler,
  createActorDialogueTickJobHandler,
  createActorForegroundJobHandler,
  type ActorCalendarRollupJobData,
  type ActorDialogueTickJobData,
  type ActorForegroundJobData,
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
   * ActorDialogueTick job data mapping.
   */
  actor_dialogue_tick: ActorDialogueTickJobData;
  /**
   * ActorCalendarRollup job data mapping.
   */
  actor_calendar_rollup: ActorCalendarRollupJobData;
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
    actor_dialogue_tick: createActorDialogueTickJobHandler(server),
    actor_calendar_rollup: createActorCalendarRollupJobHandler(server),
    actor_foreground: createActorForegroundJobHandler(server),
  };
}
