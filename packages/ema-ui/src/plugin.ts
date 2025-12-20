import type { EmaPluginModule, Server } from "ema";
import * as path from "path";
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
  const enabledPlugins = new Set(process.env.EMA_PLUGINS?.split(",") ?? []);

  await Promise.all(
    getPluginModules().map(async (name: string) => {
      if (!enabledPlugins.has(name)) {
        return;
      }
      const m = await import(`ema-plugin-${name}`);
      const plugin = new m.Plugin(server);

      if (plugin.name in server.plugins) {
        throw new Error(`Plugin ${plugin.name} already loaded`);
      }

      server.plugins[plugin.name] = plugin;
    }),
  );

  const plugins = Object.values(server.plugins);
  await Promise.all(plugins.map((plugin) => plugin?.start()));
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
