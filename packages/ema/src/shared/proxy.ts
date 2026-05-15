import { ProxyAgent, fetch } from "undici";
import type { Dispatcher, RequestInit } from "undici";

/**
 * Fetch wrapper that routes requests through the configured HTTPS proxy.
 */
export class FetchWithProxy {
  private readonly dispatcher: Dispatcher | undefined;

  constructor(httpsProxy?: string) {
    this.dispatcher = httpsProxy ? new ProxyAgent(httpsProxy) : undefined;
  }

  fetch(url: string, requestInit?: RequestInit) {
    requestInit ??= {};
    requestInit.dispatcher = this.dispatcher;
    return fetch(url, requestInit);
  }

  createFetcher() {
    return this.fetch.bind(this) as any;
  }
}
