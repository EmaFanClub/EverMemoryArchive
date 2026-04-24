import type { JobHandler } from "../base";
import { Logger } from "../../shared/logger";

/**
 * Data shape for the demo job.
 */
export interface TestJobData {
  /**
   * The test message.
   */
  message: string;
}

const logger = Logger.create({
  name: "scheduler.test",
  outputs: [
    { type: "console", level: "info" },
    { type: "file", level: "debug" },
  ],
});

/**
 * Demo job handler implementation.
 */
export const TestJobHandler: JobHandler<"test"> = async (job) => {
  logger.info("Test job executed", { message: job.attrs.data.message });
};
