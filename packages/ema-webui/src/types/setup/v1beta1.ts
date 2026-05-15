export type SetupStepId = "llm" | "embedding" | "owner" | "review";

export type LlmModelProvider =
  | "openai"
  | "google"
  | "anthropic"
  | "zai"
  | "moonshot"
  | "qwen";
export type LlmThinkingLevel = "none" | "low" | "medium" | "high";
export type EmbeddingProvider = "google" | "openai";
export type SetupCheckTarget = "llm" | "embedding";
export type SetupCheckPhase = "step" | "final";
export type SetupCheckStatus = "passed" | "failed";
export type SetupCheckErrorCode =
  | "INVALID_CONFIG"
  | "UNSUPPORTED"
  | "LLM_PROVIDER_ERROR"
  | "LLM_NETWORK_ERROR"
  | "EMBEDDING_PROVIDER_ERROR"
  | "EMBEDDING_NETWORK_ERROR"
  | "CHECK_FAILED";
export type SetupDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | boolean[];
export type SetupDiagnostics = Record<string, SetupDiagnosticValue>;

export interface SetupDraft {
  llm: {
    model: string;
    baseUrl: string;
    apiKey: string;
    thinkingLevel?: LlmThinkingLevel;
  };
  embedding: {
    provider: EmbeddingProvider;
    model: string;
    baseUrl: string;
    apiKey: string;
  };
  owner: {
    name: string;
    accessToken: string;
    qq: string;
  };
}

export interface SetupStepDefinition {
  id: SetupStepId;
  title: string;
  description: string;
}

export interface SetupValidationIssue {
  path: string;
  code: "required" | "unsupported" | "invalid";
}

export interface SetupServiceCheckRequest<TConfig = unknown> {
  requestId?: string;
  phase: SetupCheckPhase;
  attempt?: number;
  config: TConfig;
}

export interface SetupServiceCheckResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  check: {
    id: string;
    target: SetupCheckTarget;
    phase: SetupCheckPhase;
    status: SetupCheckStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
      code: SetupCheckErrorCode;
      retryable: boolean;
      details: SetupDiagnostics;
    };
    diagnostics: SetupDiagnostics;
  };
}

export interface LlmModelOption {
  model: string;
  provider: LlmModelProvider;
  defaultBaseUrl: string;
  capabilities: {
    thinkingLevels: LlmThinkingLevel[];
    tools: boolean;
    images: boolean;
  };
  requestDefaults: {
    thinkingLevel?: LlmThinkingLevel;
  };
}

export interface SetupDryRunRequest {
  draft: SetupDraft;
}

export interface SetupDryRunResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  status: "ready" | "blocked";
  validation: {
    valid: boolean;
    issues: SetupValidationIssue[];
  };
  plan: {
    configPath: string;
    operations: Array<{
      id: string;
      title: string;
      status: "ready" | "blocked";
    }>;
  };
}

export interface SetupCommitRequest {
  draft: SetupDraft;
}

export interface SetupCommitResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  user?: {
    id: string;
    name: string;
  };
  error?: {
    code: "INVALID_CONFIG" | "COMMIT_FAILED";
    retryable: boolean;
    details: SetupDiagnostics;
  };
}

export interface SetupStatusResponse {
  apiVersion: "v1beta1";
  needsInitialization: boolean;
  reason: "CONFIG_MISSING" | "CONFIG_INCOMPLETE" | "CONFIG_STALE" | null;
  setupState: {
    status: "required" | "complete";
    configPath: string;
    detectedConfig: boolean;
  };
  recommendedSteps: SetupStepDefinition[];
  capabilities: {
    llmModels: LlmModelOption[];
    embeddingProviders: EmbeddingProvider[];
    unsupported: Array<{
      path: string;
      reason: string;
    }>;
  };
}

export const setupSteps: SetupStepDefinition[] = [
  {
    id: "llm",
    title: "配置默认 LLM 服务",
    description: "选择负责思考与回应的模型",
  },
  {
    id: "embedding",
    title: "配置默认 Embedding 服务",
    description: "让记忆可以被准确检索",
  },
  {
    id: "owner",
    title: "初始化个人信息",
    description: "告诉 EMA 如何识别你",
  },
  {
    id: "review",
    title: "确认",
    description: "确认一切准备就绪",
  },
];

export const embeddingDefaults: Record<
  EmbeddingProvider,
  SetupDraft["embedding"]
> = {
  google: {
    provider: "google",
    model: "gemini-embedding-001",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
  },
  openai: {
    provider: "openai",
    model: "text-embedding-3-large",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
  },
};

export const initialDraft: SetupDraft = {
  llm: {
    model: "",
    baseUrl: "",
    apiKey: "",
  },
  embedding: embeddingDefaults.google,
  owner: {
    name: "",
    accessToken: "",
    qq: "",
  },
};

export const hasRequiredValue = (value: string) => value.trim().length > 0;

export const VERTEX_CREDENTIALS_JSON_LIMIT = 16_384;
export const LLM_CREDENTIAL_LIMIT = VERTEX_CREDENTIALS_JSON_LIMIT;

const qqPattern = /^[1-9]\d{4,11}$/;
const thinkingLevels = new Set<LlmThinkingLevel>([
  "none",
  "low",
  "medium",
  "high",
]);

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isLLMConfigComplete(llm: SetupDraft["llm"]) {
  if (!hasRequiredValue(llm.model) || llm.model.trim().length > 128) {
    return false;
  }

  if (llm.thinkingLevel && !thinkingLevels.has(llm.thinkingLevel)) {
    return false;
  }

  return (
    hasRequiredValue(llm.baseUrl) &&
    llm.baseUrl.trim().length <= 512 &&
    isHttpUrl(llm.baseUrl.trim()) &&
    hasRequiredValue(llm.apiKey) &&
    llm.apiKey.trim().length <= LLM_CREDENTIAL_LIMIT
  );
}

export function isEmbeddingConfigComplete(embedding: SetupDraft["embedding"]) {
  if (
    !hasRequiredValue(embedding.model) ||
    embedding.model.trim().length > 128
  ) {
    return false;
  }

  return (
    hasRequiredValue(embedding.baseUrl) &&
    embedding.baseUrl.trim().length <= 512 &&
    isHttpUrl(embedding.baseUrl.trim()) &&
    hasRequiredValue(embedding.apiKey) &&
    embedding.apiKey.trim().length <= VERTEX_CREDENTIALS_JSON_LIMIT
  );
}

export function isLLMComplete(draft: SetupDraft) {
  return isLLMConfigComplete(draft.llm);
}

export function isEmbeddingComplete(draft: SetupDraft) {
  return isEmbeddingConfigComplete(draft.embedding);
}

export function isOwnerComplete(draft: SetupDraft) {
  return (
    hasRequiredValue(draft.owner.name) &&
    draft.owner.name.trim().length <= 48 &&
    !/\r|\n/.test(draft.owner.name) &&
    hasRequiredValue(draft.owner.accessToken) &&
    (!hasRequiredValue(draft.owner.qq) || qqPattern.test(draft.owner.qq.trim()))
  );
}

export function isStepComplete(stepId: SetupStepId, draft: SetupDraft) {
  switch (stepId) {
    case "llm":
      return isLLMComplete(draft);
    case "embedding":
      return isEmbeddingComplete(draft);
    case "owner":
      return isOwnerComplete(draft);
    case "review":
      return validateSetupDraft(draft).length === 0;
  }
}

export function validateSetupDraft(draft: SetupDraft): SetupValidationIssue[] {
  const issues: SetupValidationIssue[] = [];

  if (!isLLMConfigComplete(draft.llm)) {
    if (!hasRequiredValue(draft.llm.model)) {
      issues.push({
        path: "llm.model",
        code: "required",
      });
    } else if (draft.llm.model.trim().length > 128) {
      issues.push({
        path: "llm.model",
        code: "invalid",
      });
    }
    if (!hasRequiredValue(draft.llm.baseUrl)) {
      issues.push({
        path: "llm.baseUrl",
        code: "required",
      });
    } else if (
      draft.llm.baseUrl.trim().length > 512 ||
      !isHttpUrl(draft.llm.baseUrl.trim())
    ) {
      issues.push({
        path: "llm.baseUrl",
        code: "invalid",
      });
    }
    if (!hasRequiredValue(draft.llm.apiKey)) {
      issues.push({
        path: "llm.apiKey",
        code: "required",
      });
    } else if (draft.llm.apiKey.trim().length > LLM_CREDENTIAL_LIMIT) {
      issues.push({
        path: "llm.apiKey",
        code: "invalid",
      });
    }
    if (
      draft.llm.thinkingLevel &&
      !thinkingLevels.has(draft.llm.thinkingLevel)
    ) {
      issues.push({
        path: "llm.thinkingLevel",
        code: "invalid",
      });
    }
  }

  if (!isEmbeddingConfigComplete(draft.embedding)) {
    if (!hasRequiredValue(draft.embedding.model)) {
      issues.push({
        path: "embedding.model",
        code: "required",
      });
    } else if (draft.embedding.model.trim().length > 128) {
      issues.push({
        path: "embedding.model",
        code: "invalid",
      });
    }
    if (!hasRequiredValue(draft.embedding.baseUrl)) {
      issues.push({
        path: "embedding.baseUrl",
        code: "required",
      });
    } else if (
      draft.embedding.baseUrl.trim().length > 512 ||
      !isHttpUrl(draft.embedding.baseUrl.trim())
    ) {
      issues.push({
        path: "embedding.baseUrl",
        code: "invalid",
      });
    }
    if (!hasRequiredValue(draft.embedding.apiKey)) {
      issues.push({
        path: "embedding.apiKey",
        code: "required",
      });
    } else if (
      draft.embedding.apiKey.trim().length > VERTEX_CREDENTIALS_JSON_LIMIT
    ) {
      issues.push({
        path: "embedding.apiKey",
        code: "invalid",
      });
    }
  }

  if (!hasRequiredValue(draft.owner.name)) {
    issues.push({
      path: "owner.name",
      code: "required",
    });
  } else if (
    draft.owner.name.trim().length > 48 ||
    /\r|\n/.test(draft.owner.name)
  ) {
    issues.push({
      path: "owner.name",
      code: "invalid",
    });
  }

  if (!hasRequiredValue(draft.owner.accessToken)) {
    issues.push({
      path: "owner.accessToken",
      code: "required",
    });
  }

  if (
    hasRequiredValue(draft.owner.qq) &&
    !qqPattern.test(draft.owner.qq.trim())
  ) {
    issues.push({
      path: "owner.qq",
      code: "invalid",
    });
  }

  return issues;
}
