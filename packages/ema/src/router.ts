/**
 * @prism-shadow/ema - SimpleEmaRouter
 *
 * Battle-tested Radix Tree resource router for EMA Worlds powered by radix3.
 * Conforms to EmaRouter interface from RFC-0001.
 */

import { createRouter, type RadixRouter } from "radix3";
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

interface RouteNodeData {
  readonly handler: EmaRouteHandler;
  readonly registrationId: string;
}

export class SimpleEmaRouter implements EmaRouter {
  private router: RadixRouter<RouteNodeData> = createRouter<RouteNodeData>();
  private registrations: RouteRegistration[] = [];
  private patternStacks = new Map<string, RouteRegistration[]>();
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
    const cleanPrefix = normalized.replace(/\/+$/, "") || "/";
    const id = `route-${this.nextId++}`;

    // Determine radix patterns: exact and prefix wildcard (if not already wildcard)
    const patterns: string[] = [];
    if (cleanPrefix.endsWith("/**") || cleanPrefix.endsWith("/*")) {
      patterns.push(cleanPrefix);
    } else {
      patterns.push(cleanPrefix);
      if (cleanPrefix === "/") {
        patterns.push("/**");
      } else {
        patterns.push(`${cleanPrefix}/**`);
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

    // Register into radix tree with stack semantics
    for (const pattern of patterns) {
      let stack = this.patternStacks.get(pattern);
      if (!stack) {
        stack = [];
        this.patternStacks.set(pattern, stack);
      }
      stack.push(reg);
      this.router.insert(pattern, {
        handler: reg.handler,
        registrationId: reg.id,
      });
    }

    return {
      dispose: () => {
        // Remove registration
        const regIdx = this.registrations.findIndex((r) => r.id === id);
        if (regIdx !== -1) {
          this.registrations.splice(regIdx, 1);
        }

        // Unwind from radix tree
        for (const pattern of patterns) {
          const stack = this.patternStacks.get(pattern);
          if (stack) {
            const idx = stack.findIndex((r) => r.id === id);
            if (idx !== -1) {
              stack.splice(idx, 1);
            }
            if (stack.length > 0) {
              const top = stack[stack.length - 1];
              this.router.insert(pattern, {
                handler: top.handler,
                registrationId: top.id,
              });
            } else {
              this.router.remove(pattern);
              this.patternStacks.delete(pattern);
            }
          }
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
    const pathname = url.pathname;
    const query = url.searchParams;

    const matched = this.router.lookup(pathname);
    if (!matched) {
      throw new Error(`Route not found: ${pathname}`);
    }

    const params: Record<string, string> = {};
    if (matched.params) {
      for (const [key, val] of Object.entries(matched.params)) {
        try {
          params[key] = decodeURIComponent(String(val));
        } catch {
          params[key] = String(val);
        }
      }
    }

    const ctx: EmaRouteContext = {
      path: pathname,
      params,
      query,
    };

    return (await matched.handler(ctx)) as T;
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
