import type { Server } from "./server";

/**
 * A plugin module for the EMA server
 * @example
 * ```typescript
 * // This is a sample plugin module that provides a plugin for the EMA server
 * export const Plugin: EmaPluginProvider = class {
 *   // Your plugin code here
 * };
 * ```
 */
export interface EmaPluginModule {
  /**
   * A class that implements the {@link EmaPluginProvider} interface
   */
  Plugin: EmaPluginProvider;
}

/**
 * A class that implements the {@link EmaPluginProvider} interface
 */
export interface EmaPluginProvider {
  /**
   * The name of the plugin, used to identify the plugin in the server
   * @example
   * ```typescript
   * export const Plugin: EmaPluginProvider = class {
   *   static name = "MyPlugin";
   * };
   * ```
   */
  name: string;
  /**
   * A constructor for the plugin
   * @param server - The server instance
   * @returns The plugin instance
   */
  new (server: Server): EmaPlugin;
}

/**
 * A plugin that starts on initialization of the server.
 */
export interface EmaPlugin {
  /**
   * A method that starts the plugin
   * Hint: you can access server resources through the `server` parameter
   * @example
   * ```typescript
   * export const Plugin: EmaPluginProvider = class {
   *   name = "MyPlugin";
   *   constructor(private readonly server: Server) {}
   *   start(): Promise<void> {
   *     console.log("[MyPlugin] all of the plugins in the server:", this.server.plugins);
   *     return Promise.resolve();
   *   }
   * };
   * ```
   */
  start(): Promise<void>;

  // Web API

  /**
   * The web API endpoints of the plugin
   * @param request - The request object
   */
  GET?(request: Request): Promise<Response>;
  /**
   * The web API endpoints of the plugin
   * @param request - The request object
   */
  POST?(request: Request): Promise<Response>;
}
