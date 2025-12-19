/**
 * Shared server instance for all API routes.
 * This ensures a single Server instance is used across all API endpoints.
 */
import { Server } from "ema";

let serverInstance: Server | undefined;

/**
 * Gets or creates the shared server instance.
 * @returns The shared Server instance
 */
export async function getServer(): Promise<Server> {
  if (!serverInstance) {
    serverInstance = await Server.create();
  }
  return serverInstance;
}
