/**
 * @prism-shadow/ema - Shared World Data & HTTP Server Hub
 *
 * Centralizes all EMA World state on the same machine under the unified directory
 * configured in global `config.toml` (`~/.penguin/data/ema/config.toml`) and serves
 * the unified `SimpleEmaRouter` over HTTP so that sandboxed EMA Agent sessions
 * (`ema.js world ls | get | post`) access all worlds (`WebWorld`, `QQWorld`,
 * `BilibiliWorld`, `PenguinChannelWorld`) over HTTP.
 *
 * Principles:
 * 1. Configuration is read strictly from `config.toml` (no `process.env` reads).
 * 2. Fail fast (panic) on configuration or server errors (no silent fallbacks).
 */

import fs from "node:fs";
import http from "node:http";
import { loadEmaGlobalConfig } from "./config.js";
import { SimpleEmaRouter } from "./router.js";
import { PenguinChannelWorld } from "./worlds/penguin-channel-world.js";
import { BilibiliWorld } from "./worlds/bilibili/index.js";
import { WebWorld } from "./worlds/web/index.js";
import { QQWorld } from "./worlds/qq/index.js";
import type { Disposable, EmaWorldRegistry } from "./interfaces.js";

export function getDefaultWorldDataDir(configPath?: string): string {
  return loadEmaGlobalConfig(configPath).world.dataDir;
}

export function getDefaultWebWorldDbPath(configPath?: string): string {
  return loadEmaGlobalConfig(configPath).world.web.dbPath;
}

export function getDefaultQQWorldDbPath(configPath?: string): string {
  return loadEmaGlobalConfig(configPath).world.qq.dbPath;
}

export function getDefaultBilibiliWorldDbPath(configPath?: string): string {
  return loadEmaGlobalConfig(configPath).world.bilibili.dbPath;
}

export function getDefaultChannelWorldDbPath(configPath?: string): string {
  return loadEmaGlobalConfig(configPath).world.channel.dbPath;
}

export function getDefaultWorldServerUrl(configPath?: string): string {
  return loadEmaGlobalConfig(configPath).world.url;
}

export interface SharedWorldHubOptions {
  configPath?: string;
}

export interface SharedWorldHub {
  worldDataDir: string;
  webDbPath: string;
  qqDbPath: string;
  bilibiliDbPath: string;
  channelDbPath: string;
  router: SimpleEmaRouter;
  channelWorld: PenguinChannelWorld;
  bilibiliWorld: BilibiliWorld;
  webWorld: WebWorld;
  qqWorld: QQWorld;
  httpServer: http.Server | null;
  port: number;
  host: string;
  url: string;
  listFormattedRoutes(): Array<{ worldName: string; prefix: string; description?: string }>;
  dispose(): void;
}

const GLOBAL_HUB_KEY = "__EMA_SHARED_WORLD_HUB_V1__";

export function createWorldHubInstance(options: SharedWorldHubOptions = {}): SharedWorldHub {
  const cfg = loadEmaGlobalConfig(options.configPath);
  const { world } = cfg;

  fs.mkdirSync(world.dataDir, { recursive: true });

  const router = new SimpleEmaRouter();
  const worldsMap = new Map<string, unknown>();
  const registry: EmaWorldRegistry = {
    register: (name, w) => {
      worldsMap.set(name, w);
      return {
        dispose: () => {
          worldsMap.delete(name);
        },
      };
    },
    get: (name) => worldsMap.get(name) as any,
    list: () => [...worldsMap.entries()].map(([name, w]) => ({ name, world: w as any })),
  };

  const ctx = {
    router,
    inputBatcher: { push: () => {}, onBatch: () => ({ dispose: () => {} }) },
    registry,
  };

  const channelWorld = new PenguinChannelWorld({
    channels: world.channel.channels,
    passive: true,
    stateFile: world.channel.dbPath,
  });

  const bilibiliWorld = new BilibiliWorld({
    rooms: world.bilibili.rooms,
    videoTargets: world.bilibili.videoTargets,
    dmTargets: world.bilibili.dmTargets,
    passive: true,
    dbPath: world.bilibili.dbPath,
  });

  const webWorld = new WebWorld({
    initialSessions: world.web.initialSessions,
    dbPath: world.web.dbPath,
    heartbeatIntervalMs: 0,
  });

  const qqWorld = new QQWorld({
    selfId: world.qq.selfId,
    gatewayUrl: world.qq.gatewayUrl,
    gatewayToken: world.qq.gatewayToken,
    allowedUsers: world.qq.allowedUsers,
    allowedGroups: world.qq.allowedGroups,
    groups: world.qq.groups,
    privateUsers: world.qq.privateUsers,
    passive: true,
    dbPath: world.qq.dbPath,
  });

  const handles: Disposable[] = [
    channelWorld.start(ctx),
    bilibiliWorld.start(ctx),
    webWorld.start(ctx),
    qqWorld.start(ctx),
  ];

  const listFormattedRoutes = () => {
    return router
      .listRoutes()
      .filter((r) => r.prefix !== "/world/routes")
      .map((r) => {
        let worldName = r.worldName;
        if (!worldName) {
          if (r.prefix.startsWith("/world/channel")) worldName = "PenguinChannelWorld";
          else if (r.prefix.startsWith("/world/bilibili")) worldName = "BilibiliWorld";
          else if (r.prefix.startsWith("/world/web")) worldName = "WebWorld";
          else if (r.prefix.startsWith("/world/qq")) worldName = "QQWorld";
          else {
            throw new Error(`[EMA World Panic] Unknown world route prefix: ${r.prefix}`);
          }
        }
        return {
          worldName,
          prefix: r.prefix,
          description: r.description,
        };
      });
  };

  handles.push(
    router.serve(
      "/world/routes",
      () => ({
        worldDataDir: world.dataDir,
        routes: listFormattedRoutes(),
      }),
      "Lists all active worlds and their mounted route prefixes",
    ),
  );

  return {
    worldDataDir: world.dataDir,
    webDbPath: world.web.dbPath,
    qqDbPath: world.qq.dbPath,
    bilibiliDbPath: world.bilibili.dbPath,
    channelDbPath: world.channel.dbPath,
    router,
    channelWorld,
    bilibiliWorld,
    webWorld,
    qqWorld,
    httpServer: null,
    port: world.port,
    host: world.host,
    url: world.url,
    listFormattedRoutes,
    dispose() {
      if (this.httpServer) {
        this.httpServer.close();
        this.httpServer = null;
      }
      for (const h of handles) {
        h.dispose();
      }
    },
  };
}

/**
 * Returns (and lazily initializes) the process-wide singleton `SharedWorldHub`,
 * binding an HTTP server on the host/port configured in `config.toml`.
 * Panics on bind error.
 */
export async function ensureSharedWorldServer(
  options: SharedWorldHubOptions = {},
): Promise<SharedWorldHub> {
  const g = globalThis as Record<string, unknown>;
  let hub = g[GLOBAL_HUB_KEY] as SharedWorldHub | undefined;
  if (!hub) {
    hub = createWorldHubInstance(options);
    g[GLOBAL_HUB_KEY] = hub;
  }

  if (!hub.httpServer) {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", `http://${hub!.host}:${hub!.port}`);
        const method = req.method || "GET";
        let bodyBuf: Buffer | undefined;
        if (method === "POST" || method === "PUT" || method === "PATCH") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          bodyBuf = Buffer.concat(chunks);
        }

        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string") headers.set(k, v);
          else if (Array.isArray(v)) headers.set(k, v.join(", "));
        }

        const webReq = new Request(reqUrl.toString(), {
          method,
          headers,
          body: bodyBuf && bodyBuf.length > 0 ? new Uint8Array(bodyBuf) : undefined,
        });

        const webRes = await hub!.router.app.fetch(webReq);
        res.statusCode = webRes.status;
        webRes.headers.forEach((val, key) => {
          res.setHeader(key, val);
        });
        const arrayBuf = await webRes.arrayBuffer();
        res.end(Buffer.from(arrayBuf));
      } catch (err: any) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(err?.message || String(err));
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", (err) => {
        reject(
          new Error(
            `[EMA World Server Panic] Failed to bind HTTP server on ${hub!.host}:${hub!.port}: ${err.message}`,
          ),
        );
      });
      server.listen(hub!.port, hub!.host, () => {
        hub!.httpServer = server;
        resolve();
      });
    });
  }

  return hub;
}
