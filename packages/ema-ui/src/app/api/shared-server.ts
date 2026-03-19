import { Server } from "ema";

let serverPromise: Promise<Server> | null = null;

export async function getServer(): Promise<Server> {
  if (!serverPromise) {
    serverPromise = Server.create();
  }
  return await serverPromise;
}
