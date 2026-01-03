import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import type { LLMClientBase } from "./base";
import { LLMConfig } from "../config";
import { GoogleClient } from "./google_client";
import { OpenAIClient } from "./openai_client";
import type { LLMResponse } from "../schema";
import type { Message } from "../schema";
import type { Tool } from "../tools/base";

const PROXY_HOSTS = new Set([
  "generativelanguage.googleapis.com",
  "aiplatform.googleapis.com",
]);

const proxyEnv =
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  process.env.https_proxy ||
  process.env.http_proxy;

function resolveRequestUrl(input: RequestInfo | URL): string | null {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof (input as Request).url === "string") {
    return (input as Request).url;
  }
  return null;
}

function shouldProxy(url: string): boolean {
  try {
    const host = new URL(url).host;
    return PROXY_HOSTS.has(host);
  } catch {
    return false;
  }
}

// @@@proxy-fetch - Route only Gemini/Vertex API traffic through env proxy.
if (proxyEnv && typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const proxyAgent = new EnvHttpProxyAgent();
  const wrappedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveRequestUrl(input);
    if (url && shouldProxy(url)) {
      return undiciFetch(input as RequestInfo, {
        ...(init ?? {}),
        dispatcher: proxyAgent,
      } as RequestInit);
    }
    return originalFetch(input as RequestInfo, init as RequestInit);
  };
  (wrappedFetch as typeof fetch & { __emaProxyWrapped?: boolean }).__emaProxyWrapped =
    true;
  if (
    !(globalThis.fetch as typeof fetch & { __emaProxyWrapped?: boolean })
      .__emaProxyWrapped
  ) {
    globalThis.fetch = wrappedFetch as typeof fetch;
  }
}

export enum LLMProvider {
  GOOGLE = "google",
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
}

/** Factory that routes calls to the provider-specific LLM client. */
export class LLMClient {
  private readonly client: LLMClientBase;

  constructor(readonly config: LLMConfig) {
    if (!this.config.apiKey) {
      throw new Error("LLM API key is required.");
    }
    if (!this.config.provider) {
      throw new Error("Missing LLM provider.");
    }
    switch (this.config.provider) {
      case LLMProvider.GOOGLE:
        this.client = new GoogleClient(this.config);
        break;
      case LLMProvider.OPENAI:
        this.client = new OpenAIClient(this.config);
        break;
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
    }
  }

  /**
   * Proxy a generate request to the selected provider.
   * @param messages Internal message array (EMA schema)
   * @param tools Optional tool definitions (EMA schema)
   * @param systemPrompt Optional system instruction text
   */
  generate(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string,
  ): Promise<LLMResponse> {
    return this.client.generate(messages, tools, systemPrompt);
  }
}
