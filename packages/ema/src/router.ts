/**
 * @prism-shadow/ema - SimpleEmaRouter
 *
 * HTTP radix-tree resource router for EMA Worlds powered by find-my-way.
 * Conforms to EmaRouter interface from RFC-0001.
 */

import FindMyWay, { type Instance, type HTTPVersion } from "find-my-way";
import type {
  EmaRouter,
  EmaRouteHandler,
  EmaRouteEntry,
  EmaRouteContext,
  Disposable,
} from "./interfaces.js";

interface RouteStore {
  readonly prefix: string;
  readonly handler: EmaRouteHandler;
  readonly description?: string;
  readonly isWildcard?: boolean;
}

interface FindMyWayRoute {
  readonly method: string;
  readonly path: string;
  readonly store?: RouteStore;
}

export class SimpleEmaRouter implements EmaRouter {
  private router: Instance<HTTPVersion.V1> = FindMyWay<HTTPVersion.V1>({
    ignoreTrailingSlash: true,
    ignoreDuplicateSlashes: true,
  });

  // Track handlers per path to support clean unmounting and override restoration
  private pathHandlers = new Map<string, RouteStore[]>();

  /**
   * Mounts a handler under a path prefix (e.g. `/world/channel` or `/world/channel/messages/:id`).
   */
  serve(
    pathPrefix: string,
    handler: EmaRouteHandler,
    description?: string
  ): Disposable {
    const normalized = pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`;
    const cleanPrefix = normalized.replace(/\/+$/, "") || "/";

    // Standard HTTP route patterns: exact path and wildcard subpaths
    const patterns: Array<{ path: string; isWildcard: boolean }> = [];
    if (cleanPrefix.endsWith("/*")) {
      patterns.push({ path: cleanPrefix, isWildcard: false });
    } else {
      patterns.push({ path: cleanPrefix, isWildcard: false });
      if (cleanPrefix === "/") {
        patterns.push({ path: "/*", isWildcard: true });
      } else {
        patterns.push({ path: `${cleanPrefix}/*`, isWildcard: true });
      }
    }

    const unregisters: Array<() => void> = [];

    for (const { path, isWildcard } of patterns) {
      const store: RouteStore = {
        prefix: normalized,
        handler,
        description,
        isWildcard,
      };

      let stack = this.pathHandlers.get(path);
      if (!stack) {
        stack = [];
        this.pathHandlers.set(path, stack);
      }
      stack.push(store);

      this.updateHttpRoute(path);

      unregisters.push(() => {
        const currentStack = this.pathHandlers.get(path);
        if (currentStack) {
          const idx = currentStack.indexOf(store);
          if (idx !== -1) {
            currentStack.splice(idx, 1);
          }
          if (currentStack.length === 0) {
            this.pathHandlers.delete(path);
          }
        }
        this.updateHttpRoute(path);
      });
    }

    return {
      dispose: () => {
        for (const unreg of unregisters) {
          unreg();
        }
      },
    };
  }

  private updateHttpRoute(path: string): void {
    if (this.router.hasRoute("GET", path)) {
      this.router.off("GET", path);
    }

    const stack = this.pathHandlers.get(path);
    if (stack && stack.length > 0) {
      const active = stack[stack.length - 1];
      this.router.on("GET", path, () => active, active);
    }
  }

  /**
   * Reads a resource by URI path.
   *
   * @throws {Error} if route is not found or handler throws.
   */
  async read<T = unknown>(uri: string): Promise<T> {
    const url = new URL(uri, "http://localhost");
    const matched = this.router.find("GET", uri);

    if (!matched || !matched.store) {
      throw new Error(`Route not found: ${url.pathname}`);
    }

    const store = matched.store as RouteStore;

    const params: Record<string, string> = {};
    if (matched.params) {
      for (const [key, val] of Object.entries(matched.params)) {
        if (typeof val === "string") {
          params[key] = val;
        }
      }
    }

    const ctx: EmaRouteContext = {
      path: url.pathname,
      params,
      query: url.searchParams,
    };

    return (await store.handler(ctx)) as T;
  }

  /**
   * Lists all mounted route prefixes.
   */
  listRoutes(): ReadonlyArray<EmaRouteEntry> {
    const seen = new Set<string>();
    const result: EmaRouteEntry[] = [];
    const internalRoutes = (this.router as unknown as { routes?: FindMyWayRoute[] }).routes || [];

    for (const route of internalRoutes) {
      const store = route.store;
      if (store && !store.isWildcard && !seen.has(store.prefix)) {
        seen.add(store.prefix);
        result.push({
          prefix: store.prefix,
          description: store.description,
        });
      }
    }

    return result;
  }
}
