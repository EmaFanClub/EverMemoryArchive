import type {
  LLMConfig,
  LLMModelCapabilities,
  LLMModelConfig,
  LLMRequestDefaults,
} from "./base";
import { PromptCaching, ThinkingLevel } from "./base";

/**
 * Static model registry entry used to resolve user config into AgentHub config.
 *
 * The values in this interface are the source of truth for model support in
 * EMA's AgentHub-backed LLM layer.
 */
export interface LLMModelDefinition {
  /** User-facing model id. */
  model: string;
  /** Provider group used by product/UI layers for display and filtering. */
  provider: LLMProvider;
  /** AgentHub AutoLLMClient routing hint. */
  clientType: string;
  /** Provider-compatible default base URL exposed to the upper config layer. */
  defaultBaseUrl: string;
  /** EMA-facing feature capabilities for this model. */
  capabilities: LLMModelCapabilities;
  /** Default request settings to apply for this model. */
  requestDefaults: LLMRequestDefaults;
}

/** Provider group used by product/UI layers for display and filtering. */
export type LLMProvider =
  | "openai"
  | "google"
  | "anthropic"
  | "zai"
  | "moonshot"
  | "qwen";

const FULL_THINKING_LEVELS = [
  ThinkingLevel.NONE,
  ThinkingLevel.LOW,
  ThinkingLevel.MEDIUM,
  ThinkingLevel.HIGH,
] as const;

const REQUIRED_THINKING_LEVELS = [
  ThinkingLevel.LOW,
  ThinkingLevel.MEDIUM,
  ThinkingLevel.HIGH,
] as const;

const ENABLED_OR_DISABLED_THINKING_LEVELS = [
  ThinkingLevel.NONE,
  ThinkingLevel.MEDIUM,
] as const;

/**
 * Supported models and their AgentHub routing/default configuration.
 *
 * `clientType` values are matched by AgentHub's `AutoLLMClient` routing logic.
 */
export const LLM_MODEL_DEFINITIONS = [
  {
    model: "gpt-5.5",
    provider: "openai",
    clientType: "gpt-5.5",
    defaultBaseUrl: "https://api.openai.com/v1",
    capabilities: {
      thinkingLevels: FULL_THINKING_LEVELS,
      tools: true,
      images: true,
    },
    requestDefaults: {
      thinkingLevel: ThinkingLevel.MEDIUM,
      thinkingSummary: true,
      promptCaching: PromptCaching.ENABLE,
    },
  },
  {
    model: "gpt-5.4",
    provider: "openai",
    clientType: "gpt-5.4",
    defaultBaseUrl: "https://api.openai.com/v1",
    capabilities: {
      thinkingLevels: FULL_THINKING_LEVELS,
      tools: true,
      images: true,
    },
    requestDefaults: {
      thinkingLevel: ThinkingLevel.MEDIUM,
      thinkingSummary: true,
      promptCaching: PromptCaching.ENABLE,
    },
  },
  {
    model: "gemini-3.5-flash",
    provider: "google",
    clientType: "gemini-3-client",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    capabilities: {
      thinkingLevels: FULL_THINKING_LEVELS,
      tools: true,
      images: true,
    },
    requestDefaults: {
      thinkingLevel: ThinkingLevel.MEDIUM,
      thinkingSummary: true,
      promptCaching: PromptCaching.ENABLE,
    },
  },
  {
    model: "gemini-3.1-pro-preview",
    provider: "google",
    clientType: "gemini-3-client",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    capabilities: {
      thinkingLevels: REQUIRED_THINKING_LEVELS,
      tools: true,
      images: true,
    },
    requestDefaults: {
      thinkingLevel: ThinkingLevel.MEDIUM,
      thinkingSummary: true,
      promptCaching: PromptCaching.ENABLE,
    },
  },
  {
    model: "gemini-3.1-flash-lite-preview",
    provider: "google",
    clientType: "gemini-3-client",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    capabilities: {
      thinkingLevels: FULL_THINKING_LEVELS,
      tools: true,
      images: true,
    },
    requestDefaults: {
      thinkingLevel: ThinkingLevel.MEDIUM,
      thinkingSummary: true,
      promptCaching: PromptCaching.ENABLE,
    },
  },
  {
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    clientType: "claude-4-6",
    defaultBaseUrl: "https://api.anthropic.com",
    capabilities: {
      thinkingLevels: FULL_THINKING_LEVELS,
      tools: true,
      images: true,
    },
    requestDefaults: {
      thinkingLevel: ThinkingLevel.MEDIUM,
      thinkingSummary: true,
      promptCaching: PromptCaching.ENABLE,
    },
  },
  {
    model: "z-ai/glm-5",
    provider: "zai",
    clientType: "glm-5",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4/",
    capabilities: {
      thinkingLevels: ENABLED_OR_DISABLED_THINKING_LEVELS,
      tools: true,
      images: false,
    },
    requestDefaults: {
      thinkingLevel: ThinkingLevel.MEDIUM,
      promptCaching: PromptCaching.ENABLE,
    },
  },
  {
    model: "kimi-k2.5",
    provider: "moonshot",
    clientType: "kimi-k2.5",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    capabilities: {
      thinkingLevels: ENABLED_OR_DISABLED_THINKING_LEVELS,
      tools: true,
      images: true,
    },
    requestDefaults: {
      thinkingLevel: ThinkingLevel.MEDIUM,
      promptCaching: PromptCaching.ENABLE,
    },
  },
  {
    model: "qwen3",
    provider: "qwen",
    clientType: "qwen3",
    defaultBaseUrl: "http://127.0.0.1:8000/v1/",
    capabilities: {
      thinkingLevels: [],
      tools: true,
      images: false,
    },
    requestDefaults: {
      promptCaching: PromptCaching.ENABLE,
    },
  },
] as const satisfies readonly LLMModelDefinition[];

export type LLMModel = (typeof LLM_MODEL_DEFINITIONS)[number]["model"];

export type LLMClientType =
  (typeof LLM_MODEL_DEFINITIONS)[number]["clientType"];

/**
 * Finds the static model definition for a user-facing model id.
 *
 * @param model - User-facing model identifier.
 * @returns Matching model definition.
 * @throws Error when the model is not present in `LLM_MODEL_DEFINITIONS`.
 */
export function resolveLLMModelDefinition(model: string): LLMModelDefinition {
  const definition = LLM_MODEL_DEFINITIONS.find(
    (candidate) => candidate.model === model,
  );
  if (!definition) {
    throw new Error(`Unsupported LLM model: ${model}`);
  }
  return definition;
}

/**
 * Lists supported model definitions as detached objects for API mapping.
 *
 * @returns Supported model definitions in registry order.
 */
export function listLLMModelDefinitions(): LLMModelDefinition[] {
  return LLM_MODEL_DEFINITIONS.map((definition) => ({
    ...definition,
    capabilities: {
      ...definition.capabilities,
      thinkingLevels: [...definition.capabilities.thinkingLevels],
    },
    requestDefaults: {
      ...definition.requestDefaults,
    },
  }));
}

/**
 * Resolves complete user-facing config into validated runtime model config.
 *
 * @param config - User-provided LLM configuration.
 * @returns Runtime model config with registry metadata attached.
 * @throws Error when the requested thinking level is unsupported.
 */
export function resolveLLMModelConfig(config: LLMConfig): LLMModelConfig {
  const definition = resolveLLMModelDefinition(config.model);
  const thinkingLevel =
    config.thinkingLevel ?? definition.requestDefaults.thinkingLevel;
  if (
    thinkingLevel &&
    !definition.capabilities.thinkingLevels.includes(thinkingLevel)
  ) {
    throw new Error(
      `${config.model} does not support thinking level: ${thinkingLevel}`,
    );
  }

  return {
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    clientType: definition.clientType,
    capabilities: definition.capabilities,
    requestDefaults: {
      ...definition.requestDefaults,
      thinkingLevel,
    },
  };
}
