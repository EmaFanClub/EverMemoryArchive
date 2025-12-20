import type { EmaPluginModule, Server } from "ema";
import * as fs from "fs";

/**
 * Loads plugins by environment variable `EMA_PLUGINS`
 * @param server - The server instance
 */
export async function loadPlugins(server: Server): Promise<void> {
  /**
   * Comma-separated list of plugins to load
   *
   * @example
   * EMA_PLUGINS=qq,discord
   */
  const enabledPlugins = new Set(
    (process.env.EMA_PLUGINS ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );

  await Promise.all(
    getPluginModules()
      .filter((name) => enabledPlugins.has(name))
      .map(async (name: string) => {
        try {
          const m: EmaPluginModule = await import(`ema-plugin-${name}`);
          if (m.Plugin.name in server.plugins) {
            throw new Error(`Plugin ${m.Plugin.name} already loaded`);
          }

          const plugin = new m.Plugin(server);

          server.plugins[m.Plugin.name] = plugin;
        } catch (error) {
          console.error(`Failed to load plugin package "${name}":`, error);
          return;
        }
      }),
  );

  const plugins = Object.entries(server.plugins);
  await Promise.all(
    plugins.map(async ([name, plugin]) => {
      if (!plugin) {
        return;
      }
      try {
        return await plugin.start();
      } catch (error) {
        console.error(`Failed to start plugin "${name}":`, error);
      }
    }),
  );
}

/**
 * Finds all plugin modules in the `ema-ui` package.json
 *
 * @returns The names of the plugin modules
 */
function getPluginModules(): string[] {
  const dependencies = new Set<string>();
  const addOne = (name: string) => {
    if (name.startsWith("ema-plugin-")) {
      dependencies.add(name.slice("ema-plugin-".length));
    }
  };

  const packageJsonData = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
  );

  Object.keys(packageJsonData.dependencies || {}).forEach(addOne);
  Object.keys(packageJsonData.peerDependencies || {}).forEach(addOne);
  return Array.from(dependencies).sort();
}
