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
  readonly path: string;
  readonly handler: EmaRouteHandler;
  readonly description?: string;
  disposed?: boolean;
}

export class SimpleEmaRouter implements EmaRouter {
  private routes: RouteRegistration[] = [];
  private honoApp: Hono | null = null;

  /**
   * The underlying Hono instance, supporting Web Standard Fetch and Penguin plugin route binding.
   * Built lazily from mounted routes on demand.
   */
  get app(): Hono {
    return this.getApp();
  }

  /**
   * Mounts a handler under a standard Hono route path (e.g. `/world/channel/*` or `/world/channel/messages/:id`).
   * Preserves exact registration order.
   */
  serve(
    path: string,
    handler: EmaRouteHandler,
    description?: string
  ): Disposable {
    const entry: RouteRegistration = {
      path,
      handler,
      description,
      disposed: false,
    };

    this.routes.push(entry);
    this.honoApp = null;

    return {
      dispose: () => {
        if (!entry.disposed) {
          entry.disposed = true;
          this.honoApp = null;
        }
      },
    };
  }

  private getApp(): Hono {
    if (!this.honoApp) {
      // Lazy delete: compact out tombstoned routes in a single O(n) pass during rebuild
      this.routes = this.routes.filter((r) => !r.disposed);

      const app = new Hono();

      for (const entry of this.routes) {
        app.all(entry.path, async (c: Context) => {
          const url = new URL(c.req.url);
          const ctx: EmaRouteContext = {
            path: c.req.path,
            params: (c.req.param() || {}) as Record<string, string>,
            query: url.searchParams,
          };

          const result = await entry.handler(ctx);
          if (result instanceof Response) {
            return result;
          }
          if (typeof result === "string") {
            return c.text(result);
          }
          return c.json(result);
        });
      }

      this.honoApp = app;
    }

    return this.honoApp;
  }

  /**
   * Reads a resource by URI path using Web Standard request dispatch.
   *
   * @throws {Error} if route is not found or handler throws.
   */
  async read<T = unknown>(uri: string): Promise<T> {
    const url = new URL(uri, "http://localhost");
    const res = await this.getApp().request(url.toString());

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
   * Lists all mounted route prefixes in their exact registration order.
   */
  listRoutes(): ReadonlyArray<EmaRouteEntry> {
    return this.routes
      .filter((r) => !r.disposed)
      .map((r) => ({
        prefix: r.path,
        description: r.description,
      }));
  }
}
