/**
 * @prism-shadow/ema - SimpleEmaRouter
 *
 * Web-standard HTTP resource router for EMA Worlds powered by Hono.
 * Conforms to EmaRouter interface from RFC-0001.
 */

import { Hono, type Context } from "hono";
import type {
  EmaRouter,
  EmaRouteHandler,
  EmaRouteEntry,
  EmaRouteContext,
  Disposable,
} from "./interfaces.js";

interface RouteRegistration {
  readonly id: string;
  readonly prefix: string;
  readonly handler: EmaRouteHandler;
  readonly description?: string;
  readonly patterns: readonly string[];
}

export class SimpleEmaRouter implements EmaRouter {
  private registrations: RouteRegistration[] = [];
  private honoApp: Hono = new Hono();
  private nextId = 1;

  constructor() {
    this.rebuildHonoApp();
  }

  /**
   * The underlying Hono instance, supporting Web Standard Fetch and Penguin plugin route binding.
   */
  get app(): Hono {
    return this.honoApp;
  }

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
    const id = `route-${this.nextId++}`;

    const patterns: string[] = [];
    if (cleanPrefix.endsWith("/*")) {
      patterns.push(cleanPrefix);
    } else if (cleanPrefix.includes(":")) {
      patterns.push(cleanPrefix);
    } else {
      patterns.push(cleanPrefix);
      if (cleanPrefix === "/") {
        patterns.push("/*");
      } else {
        patterns.push(`${cleanPrefix}/*`);
      }
    }

    const reg: RouteRegistration = {
      id,
      prefix: normalized,
      handler,
      description,
      patterns,
    };

    this.registrations.push(reg);
    this.rebuildHonoApp();

    return {
      dispose: () => {
        const idx = this.registrations.findIndex((r) => r.id === id);
        if (idx !== -1) {
          this.registrations.splice(idx, 1);
          this.rebuildHonoApp();
        }
      },
    };
  }

  private rebuildHonoApp(): void {
    const app = new Hono();

    // Sort: specific parameterized routes first, then exact routes, then wildcard routes last
    const sorted = [...this.registrations].sort((a, b) => {
      const aIsWild = a.patterns.some((p) => p.endsWith("/*"));
      const bIsWild = b.patterns.some((p) => p.endsWith("/*"));
      if (aIsWild && !bIsWild) return 1;
      if (!aIsWild && bIsWild) return -1;
      return b.prefix.length - a.prefix.length;
    });

    for (const reg of sorted) {
      const bridge = async (c: Context) => {
        const url = new URL(c.req.url);
        const ctx: EmaRouteContext = {
          path: c.req.path,
          params: (c.req.param() || {}) as Record<string, string>,
          query: url.searchParams,
        };

        const result = await reg.handler(ctx);
        if (result instanceof Response) {
          return result;
        }
        if (typeof result === "string") {
          return c.text(result);
        }
        return c.json(result);
      };

      for (const pattern of reg.patterns) {
        app.all(pattern, bridge);
      }
    }

    this.honoApp = app;
  }

  /**
   * Reads a resource by URI path using Web Standard request dispatch.
   *
   * @throws {Error} if route is not found or handler throws.
   */
  async read<T = unknown>(uri: string): Promise<T> {
    const url = new URL(uri, "http://localhost");
    const res = await this.honoApp.request(url.toString());

    if (res.status === 404) {
      throw new Error(`Route not found: ${url.pathname}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Route error (${res.status}): ${errText || url.pathname}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }

    return (await res.text()) as unknown as T;
  }

  /**
   * Lists all mounted route prefixes.
   */
  listRoutes(): ReadonlyArray<EmaRouteEntry> {
    return this.registrations.map((r) => ({
      prefix: r.prefix,
      description: r.description,
    }));
  }
}
