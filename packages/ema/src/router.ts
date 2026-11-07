/**
 * @prism-shadow/ema - SimpleEmaRouter
 *
 * Lightweight prefix and pattern matching resource router for EMA Worlds.
 * Conforms to EmaRouter interface from RFC-0001.
 */

import type {
  EmaRouter,
  EmaRouteHandler,
  EmaRouteEntry,
  EmaRouteContext,
  Disposable,
} from "./interfaces.js";

interface InternalRoute {
  readonly id: string;
  readonly prefix: string;
  readonly handler: EmaRouteHandler;
  readonly description?: string;
  readonly regex: RegExp;
  readonly paramNames: string[];
}

export class SimpleEmaRouter implements EmaRouter {
  private routes: InternalRoute[] = [];
  private nextId = 1;

  /**
   * Mounts a handler under a path prefix (e.g. `/world/channel` or `/world/channel/messages/:id`).
   */
  serve(
    pathPrefix: string,
    handler: EmaRouteHandler,
    description?: string
  ): Disposable {
    const normalized = pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`;
    const id = `route-${this.nextId++}`;

    const paramNames: string[] = [];
    const escaped = normalized.replace(/:([a-zA-Z0-9_]+)/g, (_match, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });

    // If normalized prefix doesn't end with wildcard, match exact or prefix with /
    const regex = new RegExp(`^${escaped}(?:/.*)?$`);

    const route: InternalRoute = {
      id,
      prefix: normalized,
      handler,
      description,
      regex,
      paramNames,
    };

    // Keep routes sorted by specificity (longest prefix first)
    this.routes.push(route);
    this.routes.sort((a, b) => b.prefix.length - a.prefix.length);

    return {
      dispose: () => {
        this.routes = this.routes.filter((r) => r.id !== id);
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
    const pathname = url.pathname;
    const query = url.searchParams;

    for (const route of this.routes) {
      const match = pathname.match(route.regex);
      if (match) {
        const params: Record<string, string> = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          params[route.paramNames[i]] = decodeURIComponent(match[i + 1] || "");
        }

        const ctx: EmaRouteContext = {
          path: pathname,
          params,
          query,
        };

        return (await route.handler(ctx)) as T;
      }
    }

    throw new Error(`Route not found: ${pathname}`);
  }

  /**
   * Lists all mounted route prefixes.
   */
  listRoutes(): ReadonlyArray<EmaRouteEntry> {
    return this.routes.map((r) => ({
      prefix: r.prefix,
      description: r.description,
    }));
  }
}
