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

  /**
   * Mounts a handler under a path prefix (e.g. `/world/channel` or `/world/channel/messages/:id`).
   */
  serve(
    pathPrefix: string,
    handler: EmaRouteHandler,
    description?: string
  ): Disposable {
    const path = pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`;
    const clean = path.replace(/\/+$/, "") || "/";
    const store: RouteStore = { prefix: path, handler, description };

    this.router.on("GET", clean, () => handler, store);

    // If prefix route without wildcard or params, also register subpath wildcard
    const wildcard =
      !clean.includes("*") && !clean.includes(":")
        ? `${clean === "/" ? "" : clean}/*`
        : null;

    if (wildcard) {
      this.router.on("GET", wildcard, () => handler, { ...store, isWildcard: true });
    }

    return {
      dispose: () => {
        this.router.off("GET", clean);
        if (wildcard) {
          this.router.off("GET", wildcard);
        }
      },
    };
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

    const ctx: EmaRouteContext = {
      path: url.pathname,
      params: (matched.params || {}) as Record<string, string>,
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
    const routes = (this.router as unknown as { routes?: FindMyWayRoute[] }).routes || [];

    for (const route of routes) {
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
