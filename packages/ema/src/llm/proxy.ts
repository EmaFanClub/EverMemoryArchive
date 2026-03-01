import { ProxyAgent, fetch } from "undici";
import type { Dispatcher, RequestInit } from "undici";

/**
 * A common fetch implementation that uses a proxy if HTTPS_PROXY or https_proxy is set.
 */
export class FetchWithProxy {
  private readonly dispatcher: Dispatcher | undefined;

  constructor(
    /**
     * A proxy URL to use for the fetch.
     * If empty, the requests are sent without http proxy.
     */
    https_proxy?: string,
  ) {
    this.dispatcher = https_proxy ? new ProxyAgent(https_proxy) : undefined;
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
