import type { Server } from "./server";

export interface EmaPluginModule {
  Plugin: EmaPluginProvider;
}

export interface EmaPluginProvider {
  name: string;
  new (server: Server): EmaPlugin;
}

export interface EmaPlugin {
  start(): Promise<void>;

  // Web API
  GET?(request: Request): Promise<Response>;
  POST?(request: Request): Promise<Response>;
}
