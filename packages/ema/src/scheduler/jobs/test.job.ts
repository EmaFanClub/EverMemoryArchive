import type { JobHandler } from "../base";

/**
 * Data shape for the demo job.
 */
export interface TestJobData {
  /**
   * The test message.
   */
  message: string;
}

/**
 * Demo job handler implementation.
 */
export const TestJobHandler: JobHandler<"test"> = async (job) => {
  console.log(`[scheduler:test] ${job.attrs.data.message}`);
};
