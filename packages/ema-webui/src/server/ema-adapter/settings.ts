import "server-only";

import {
  resolveSession,
  type ChannelConfig,
  type EffectiveActorSettings,
  type EmbeddingConfig,
  type LLMConfig,
  resolveLLMModelDefinition,
  type VectorIndexStatus,
  type WebSearchConfig,
} from "ema";
import type {
  GlobalEmbeddingIndexStatus,
  GlobalEmbeddingConfig,
  LlmModelProvider,
  ActorQQBlockedBy,
  ActorLlmConfig,
  ActorQQConfig,
  ActorQQTransportStatus,
  ActorQQConversation,
  ActorWebSearchConfig,
} from "@/types/dashboard/v1beta1";

export interface CoreConversationForQq {
  id?: number;
  session: string;
  name: string;
  description: string;
  allowProactive?: boolean;
}

export function toWebLlmConfig(config: LLMConfig): ActorLlmConfig {
  return {
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ...(config.thinkingLevel ? { thinkingLevel: config.thinkingLevel } : {}),
  };
}

export function toCoreLlmConfig(config: ActorLlmConfig): LLMConfig {
  return {
    model: config.model.trim(),
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    ...(config.thinkingLevel
      ? { thinkingLevel: config.thinkingLevel as LLMConfig["thinkingLevel"] }
      : {}),
  };
}

export function toWebLlmModelProvider(config: LLMConfig): LlmModelProvider {
  try {
    return resolveLLMModelDefinition(config.model).provider;
  } catch {
    if (config.model.startsWith("gpt") || config.baseUrl.includes("openai")) {
      return "openai";
    }
    if (config.baseUrl.includes("anthropic")) {
      return "anthropic";
    }
    return "google";
  }
}

export function toWebEmbeddingConfig(
  config: EmbeddingConfig,
): GlobalEmbeddingConfig {
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  };
}

export function toWebEmbeddingIndexStatus(
  status: VectorIndexStatus,
): GlobalEmbeddingIndexStatus {
  return {
    state: status.state,
    activeFingerprint: status.activeFingerprint,
    activeProvider: status.activeProvider,
    activeModel: status.activeModel,
    ...(typeof status.dimensions === "number"
      ? { dimensions: status.dimensions }
      : {}),
    ...(typeof status.startedAt === "number"
      ? { startedAt: new Date(status.startedAt).toISOString() }
      : {}),
    ...(typeof status.finishedAt === "number"
      ? { finishedAt: new Date(status.finishedAt).toISOString() }
      : {}),
    ...(typeof status.totalMemories === "number"
      ? { totalMemories: status.totalMemories }
      : {}),
    ...(typeof status.indexedMemories === "number"
      ? { indexedMemories: status.indexedMemories }
      : {}),
    ...(status.error ? { error: status.error } : {}),
  };
}

export function toWebSearchConfig(
  config: WebSearchConfig,
): ActorWebSearchConfig {
  return {
    enabled: config.enabled,
    tavilyApiKey: config.tavilyApiKey,
  };
}

export function toWebQqConversation(
  conversation: CoreConversationForQq,
): ActorQQConversation | null {
  if (typeof conversation.id !== "number") {
    return null;
  }
  const session = resolveSession(conversation.session);
  if (!session || session.channel !== "qq") {
    return null;
  }
  if (session.type !== "chat" && session.type !== "group") {
    return null;
  }
  return {
    id: String(conversation.id),
    type: session.type,
    uid: session.uid,
    name: conversation.name,
    description: conversation.description,
    allowProactive: conversation.allowProactive === true,
  };
}

export function toWebQqConfig(
  config: ChannelConfig["qq"],
  conversations: CoreConversationForQq[] = [],
): ActorQQConfig {
  return {
    enabled: config.enabled,
    wsUrl: config.wsUrl,
    accessToken: config.accessToken,
    conversations: conversations
      .map(toWebQqConversation)
      .filter((item): item is ActorQQConversation => Boolean(item)),
  };
}

export function toWebSettings(
  settings: EffectiveActorSettings,
  qqConversations: CoreConversationForQq[] = [],
) {
  return {
    llm: toWebLlmConfig(settings.llm),
    webSearch: toWebSearchConfig(settings.webSearch),
    qq: toWebQqConfig(settings.channel.qq, qqConversations),
  };
}

export function toWebQqTransportStatus(status: string): ActorQQTransportStatus {
  if (
    status === "connecting" ||
    status === "connected" ||
    status === "disconnected"
  ) {
    return status;
  }
  return "disconnected";
}

export function toWebQqBlockedBy(value: unknown): ActorQQBlockedBy {
  if (value === "actor_offline" || value === "qq_disabled") {
    return value;
  }
  return null;
}
