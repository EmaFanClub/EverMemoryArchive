import type { EmaPluginProvider, Server } from "ema";

export const Plugin: EmaPluginProvider = class {
  static name = "QQ";
  constructor(private readonly server: Server) {}
  start(): Promise<void> {
    console.log("[ema-qq] started", !!this.server.chat);
    return Promise.resolve();
  }
};
