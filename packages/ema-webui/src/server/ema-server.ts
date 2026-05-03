import "server-only";

import { Server } from "ema";

type EmaServerGlobal = typeof globalThis & {
  __emaWebuiEmaServerPromise?: Promise<Server>;
};

const emaServerGlobal = globalThis as EmaServerGlobal;

export function ensureEmaServer(): Promise<Server> {
  emaServerGlobal.__emaWebuiEmaServerPromise ??= Server.create();
  return emaServerGlobal.__emaWebuiEmaServerPromise;
}
