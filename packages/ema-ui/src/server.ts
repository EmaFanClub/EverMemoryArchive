import { GlobalConfigError, Server } from "ema";

declare global {
  // eslint-disable-next-line no-var
  var __emaServerPromise__: Promise<Server> | undefined;
}

export async function getServer(): Promise<Server> {
  globalThis.__emaServerPromise__ ??= createServer();
  return await globalThis.__emaServerPromise__;
}

async function createServer(): Promise<Server> {
  try {
    return await Server.create();
  } catch (error) {
    if (error instanceof GlobalConfigError) {
      await writeStderr(`${(error as Error).message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

async function writeStderr(message: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stderr.write(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
