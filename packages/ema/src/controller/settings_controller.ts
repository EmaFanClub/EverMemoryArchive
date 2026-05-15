import {
  GlobalConfig,
  normalizeLLMConfig,
  parseGlobalConfigRecord,
  type EmbeddingConfig,
  type LLMConfig,
  type WebSearchConfig,
} from "../config";
import { LLMClient, resolveLLMModelConfig, RetryConfig } from "../agent_hub";
import { EmbeddingClient } from "../memory/embedding_client";
import type { UsageMetadata } from "../agent_hub/schema";
import { isTextItem } from "../agent_hub/utils";
import type { Server } from "../server";
import type {
  EffectiveActorSettings,
  EmbeddingProbeResult,
  LlmProbeResult,
  SaveGlobalEmbeddingConfigResult,
} from "./types";

export class SettingsController {
  constructor(private readonly server: Server) {}

  async getEffective(actorId: number): Promise<EffectiveActorSettings> {
    return {
      llm: await this.server.dbService.getActorLLMConfig(actorId),
      webSearch: await this.server.dbService.getActorWebSearchConfig(actorId),
      channel: await this.server.dbService.getActorChannelConfig(actorId),
    };
  }

  async probeLlmConfig(config: LLMConfig): Promise<LlmProbeResult> {
    const prepared = prepareLlmConfig(config);
    if (!prepared.ok) {
      return {
        ok: false,
        unsupported: false,
        message: prepared.error,
      };
    }
    const startedAt = Date.now();
    try {
      const client = new LLMClient(prepared.config, new RetryConfig(false));
      const response = await client.generate({
        messages: [
          {
            role: "user",
            contents: [{ type: "text", text: "Reply with OK." }],
          },
        ],
        systemPrompt: "You are a connection probe. Reply with OK only.",
      });
      const text = response.contents
        .filter(isTextItem)
        .map((item) => item.text.trim())
        .join("");
      if (!text) {
        return {
          ok: false,
          unsupported: false,
          message: "LLM provider returned an empty response.",
        };
      }
      return {
        ok: true,
        unsupported: false,
        message: "ok",
        diagnostics: {
          latencyMs: Date.now() - startedAt,
          ...diagnosticsFromUsage(response.metadata?.usageMetadata),
          finishReason: response.metadata?.finishReason ?? "UNKNOWN",
        },
      };
    } catch (error) {
      return {
        ok: false,
        unsupported: false,
        message: errorMessage(error),
        diagnostics: {
          latencyMs: Date.now() - startedAt,
        },
      };
    }
  }

  async probeEmbeddingConfig(
    config: EmbeddingConfig,
  ): Promise<EmbeddingProbeResult> {
    const incompleteMessage = validateEmbeddingProbeConfig(config);
    if (incompleteMessage) {
      return {
        ok: false,
        unsupported: false,
        message: incompleteMessage,
      };
    }
    const startedAt = Date.now();
    try {
      const result = await new EmbeddingClient(config).probe();
      return {
        ok: true,
        unsupported: false,
        message: "ok",
        diagnostics: {
          latencyMs: Date.now() - startedAt,
          vectorDimensions: result.dimensions,
        },
      };
    } catch (error) {
      return {
        ok: false,
        unsupported: false,
        message: errorMessage(error),
        diagnostics: {
          latencyMs: Date.now() - startedAt,
        },
      };
    }
  }

  async saveLlmConfig(
    actorId: number,
    config: LLMConfig | null,
  ): Promise<LLMConfig | null> {
    if (config === null) {
      await this.requireActor(actorId);
      await this.server.dbService.actorDB.clearActorLlmConfig(actorId);
      await this.server.controller.actor.publishUpdated(actorId);
      return null;
    }

    const prepared = prepareLlmConfig(config);
    if (!prepared.ok) {
      throw new Error(prepared.error);
    }
    const actor = await this.requireActor(actorId);
    await this.server.dbService.actorDB.upsertActor({
      ...actor,
      llmConfig: prepared.config,
    });
    await this.server.controller.actor.publishUpdated(actorId);
    return prepared.config;
  }

  async saveWebSearchConfig(
    actorId: number,
    config: WebSearchConfig,
  ): Promise<WebSearchConfig> {
    if (config.enabled && !config.tavilyApiKey.trim()) {
      throw new Error("Tavily ApiKey is required when web search is enabled.");
    }
    const actor = await this.requireActor(actorId);
    await this.server.dbService.actorDB.upsertActor({
      ...actor,
      webSearchConfig: config,
    });
    await this.server.controller.actor.publishUpdated(actorId);
    return config;
  }

  async saveGlobalLlmConfig(config: LLMConfig): Promise<LLMConfig> {
    const prepared = prepareLlmConfig(config);
    if (!prepared.ok) {
      throw new Error(prepared.error);
    }
    const record = parseGlobalConfigRecord(await this.requireGlobalConfig());
    await this.server.dbService.globalConfigDB.upsertGlobalConfig({
      ...record,
      defaultLlm: prepared.config,
    });
    GlobalConfig.updateDefaultLlm(prepared.config);
    return prepared.config;
  }

  async saveGlobalEmbeddingConfig(
    config: EmbeddingConfig,
  ): Promise<SaveGlobalEmbeddingConfigResult> {
    const invalidMessage = validateEmbeddingProbeConfig(config);
    if (invalidMessage) {
      throw new Error(invalidMessage);
    }
    const record = await this.requireGlobalConfig();
    await this.server.dbService.globalConfigDB.upsertGlobalConfig({
      ...record,
      defaultEmbedding: config,
    });
    return {
      config,
      restartRequired: true,
      vectorIndex:
        this.server.dbService.longTermMemoryDB.getVectorIndexStatus(),
    };
  }

  getGlobalDefaults(): {
    llm: LLMConfig;
    embedding: EmbeddingConfig;
    webSearch: WebSearchConfig;
  } {
    return {
      llm: GlobalConfig.defaultLlm,
      embedding: GlobalConfig.defaultEmbedding,
      webSearch: GlobalConfig.defaultWebSearch,
    };
  }

  private async requireActor(actorId: number) {
    const actor = await this.server.dbService.actorDB.getActor(actorId);
    if (!actor || typeof actor.id !== "number") {
      throw new Error(`Actor ${actorId} not found.`);
    }
    return actor as typeof actor & { id: number };
  }

  private async requireGlobalConfig() {
    const record = await this.server.dbService.globalConfigDB.getGlobalConfig();
    if (!record) {
      throw new Error("Global config not found.");
    }
    return record;
  }
}

function prepareLlmConfig(
  config: LLMConfig,
): { ok: true; config: LLMConfig } | { ok: false; error: string } {
  let normalized: LLMConfig;
  try {
    normalized = normalizeLLMConfig(config);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }

  if (
    !normalized.model.trim() ||
    !normalized.baseUrl.trim() ||
    !normalized.apiKey.trim()
  ) {
    return { ok: false, error: "LLM config is incomplete." };
  }

  try {
    resolveLLMModelConfig(normalized);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  return { ok: true, config: normalized };
}

function diagnosticsFromUsage(
  usageMetadata: UsageMetadata | undefined,
): Record<string, number> {
  if (!usageMetadata) {
    return {};
  }
  const totalTokens = [
    usageMetadata.cachedTokens,
    usageMetadata.promptTokens,
    usageMetadata.thoughtTokens,
    usageMetadata.responseTokens,
  ].reduce<number>(
    (sum, value) => sum + (typeof value === "number" ? value : 0),
    0,
  );
  return totalTokens > 0 ? { totalTokens } : {};
}

function validateEmbeddingProbeConfig(config: EmbeddingConfig): string | null {
  if (config.provider === "openai") {
    return !config.openai.model.trim() ||
      !config.openai.baseUrl.trim() ||
      !config.openai.apiKey.trim()
      ? "Embedding config is incomplete."
      : null;
  }
  if (!config.google.model.trim()) {
    return "Embedding config is incomplete.";
  }
  if (config.google.useVertexAi) {
    return !config.google.project.trim() ||
      !config.google.location.trim() ||
      !config.google.credentialsFile.trim()
      ? "Google Vertex AI project, location, and credentials JSON are required."
      : null;
  }
  return !config.google.baseUrl.trim() || !config.google.apiKey.trim()
    ? "Embedding config is incomplete."
    : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
