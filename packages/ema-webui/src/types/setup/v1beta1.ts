export type SetupStepId = "llm" | "embedding" | "owner" | "review";

export type LLMProvider = "google" | "openai" | "anthropic";
export type OpenAIMode = "responses" | "chat";
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
    provider: LLMProvider;
    mode: OpenAIMode;
    model: string;
    baseUrl: string;
    envKey: string;
    useVertexAi: boolean;
    projectEnvKey: string;
    locationEnvKey: string;
    credentialsEnvKey: string;
  };
  embedding: {
    provider: EmbeddingProvider;
    model: string;
    baseUrl: string;
    envKey: string;
    useVertexAi: boolean;
    projectEnvKey: string;
    locationEnvKey: string;
    credentialsEnvKey: string;
  };
  owner: {
    name: string;
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
    envKeys: string[];
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
  reason: "CONFIG_MISSING" | null;
  setupState: {
    status: "required" | "complete";
    configPath: string;
    detectedConfig: boolean;
  };
  recommendedSteps: SetupStepDefinition[];
  capabilities: {
    llmProviders: LLMProvider[];
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

export const llmDefaults: Record<LLMProvider, SetupDraft["llm"]> = {
  google: {
    provider: "google",
    mode: "responses",
    model: "gemini-3.1-pro-preview",
    baseUrl: "https://generativelanguage.googleapis.com",
    envKey: "GEMINI_API_KEY",
    useVertexAi: false,
    projectEnvKey: "GOOGLE_CLOUD_PROJECT",
    locationEnvKey: "GOOGLE_CLOUD_LOCATION",
    credentialsEnvKey: "GOOGLE_APPLICATION_CREDENTIALS",
  },
  openai: {
    provider: "openai",
    mode: "chat",
    model: "",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    useVertexAi: false,
    projectEnvKey: "",
    locationEnvKey: "",
    credentialsEnvKey: "",
  },
  anthropic: {
    provider: "anthropic",
    mode: "chat",
    model: "",
    baseUrl: "https://api.anthropic.com",
    envKey: "ANTHROPIC_API_KEY",
    useVertexAi: false,
    projectEnvKey: "",
    locationEnvKey: "",
    credentialsEnvKey: "",
  },
};

export const embeddingDefaults: Record<
  EmbeddingProvider,
  SetupDraft["embedding"]
> = {
  google: {
    provider: "google",
    model: "gemini-embedding-001",
    baseUrl: "https://generativelanguage.googleapis.com",
    envKey: "GEMINI_API_KEY",
    useVertexAi: false,
    projectEnvKey: "GOOGLE_CLOUD_PROJECT",
    locationEnvKey: "GOOGLE_CLOUD_LOCATION",
    credentialsEnvKey: "GOOGLE_APPLICATION_CREDENTIALS",
  },
  openai: {
    provider: "openai",
    model: "text-embedding-3-large",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    useVertexAi: false,
    projectEnvKey: "",
    locationEnvKey: "",
    credentialsEnvKey: "",
  },
};

export const initialDraft: SetupDraft = {
  llm: llmDefaults.google,
  embedding: embeddingDefaults.google,
  owner: {
    name: "",
    qq: "",
  },
};

export const hasRequiredValue = (value: string) => value.trim().length > 0;

const qqPattern = /^[1-9]\d{4,11}$/;
const envKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isEnvKey(value: string) {
  return envKeyPattern.test(value);
}

export function isLLMConfigSupported(llm: SetupDraft["llm"]) {
  return !(
    llm.provider === "anthropic" ||
    (llm.provider === "openai" && llm.mode !== "responses")
  );
}

export function isLLMConfigComplete(llm: SetupDraft["llm"]) {
  if (
    !isLLMConfigSupported(llm) ||
    !hasRequiredValue(llm.model) ||
    llm.model.trim().length > 128
  ) {
    return false;
  }

  if (llm.provider === "google" && llm.useVertexAi) {
    return (
      hasRequiredValue(llm.projectEnvKey) &&
      llm.projectEnvKey.trim().length <= 128 &&
      isEnvKey(llm.projectEnvKey.trim()) &&
      hasRequiredValue(llm.locationEnvKey) &&
      llm.locationEnvKey.trim().length <= 128 &&
      isEnvKey(llm.locationEnvKey.trim()) &&
      hasRequiredValue(llm.credentialsEnvKey) &&
      llm.credentialsEnvKey.trim().length <= 128 &&
      isEnvKey(llm.credentialsEnvKey.trim())
    );
  }

  return (
    hasRequiredValue(llm.baseUrl) &&
    llm.baseUrl.trim().length <= 512 &&
    isHttpUrl(llm.baseUrl.trim()) &&
    hasRequiredValue(llm.envKey) &&
    llm.envKey.trim().length <= 128 &&
    isEnvKey(llm.envKey.trim())
  );
}

export function isEmbeddingConfigComplete(embedding: SetupDraft["embedding"]) {
  if (
    !hasRequiredValue(embedding.model) ||
    embedding.model.trim().length > 128
  ) {
    return false;
  }

  if (embedding.provider === "google" && embedding.useVertexAi) {
    return (
      hasRequiredValue(embedding.projectEnvKey) &&
      embedding.projectEnvKey.trim().length <= 128 &&
      isEnvKey(embedding.projectEnvKey.trim()) &&
      hasRequiredValue(embedding.locationEnvKey) &&
      embedding.locationEnvKey.trim().length <= 128 &&
      isEnvKey(embedding.locationEnvKey.trim()) &&
      hasRequiredValue(embedding.credentialsEnvKey) &&
      embedding.credentialsEnvKey.trim().length <= 128 &&
      isEnvKey(embedding.credentialsEnvKey.trim())
    );
  }

  return (
    hasRequiredValue(embedding.baseUrl) &&
    embedding.baseUrl.trim().length <= 512 &&
    isHttpUrl(embedding.baseUrl.trim()) &&
    hasRequiredValue(embedding.envKey) &&
    embedding.envKey.trim().length <= 128 &&
    isEnvKey(embedding.envKey.trim())
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

  if (!isLLMConfigSupported(draft.llm)) {
    issues.push({
      path: "llm.provider",
      code: "unsupported",
    });
  } else if (!isLLMConfigComplete(draft.llm)) {
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
    if (draft.llm.provider === "google" && draft.llm.useVertexAi) {
      if (!hasRequiredValue(draft.llm.projectEnvKey)) {
        issues.push({
          path: "llm.projectEnvKey",
          code: "required",
        });
      } else if (
        draft.llm.projectEnvKey.trim().length > 128 ||
        !isEnvKey(draft.llm.projectEnvKey.trim())
      ) {
        issues.push({
          path: "llm.projectEnvKey",
          code: "invalid",
        });
      }
      if (!hasRequiredValue(draft.llm.locationEnvKey)) {
        issues.push({
          path: "llm.locationEnvKey",
          code: "required",
        });
      } else if (
        draft.llm.locationEnvKey.trim().length > 128 ||
        !isEnvKey(draft.llm.locationEnvKey.trim())
      ) {
        issues.push({
          path: "llm.locationEnvKey",
          code: "invalid",
        });
      }
      if (!hasRequiredValue(draft.llm.credentialsEnvKey)) {
        issues.push({
          path: "llm.credentialsEnvKey",
          code: "required",
        });
      } else if (
        draft.llm.credentialsEnvKey.trim().length > 128 ||
        !isEnvKey(draft.llm.credentialsEnvKey.trim())
      ) {
        issues.push({
          path: "llm.credentialsEnvKey",
          code: "invalid",
        });
      }
    } else {
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
      if (!hasRequiredValue(draft.llm.envKey)) {
        issues.push({
          path: "llm.envKey",
          code: "required",
        });
      } else if (
        draft.llm.envKey.trim().length > 128 ||
        !isEnvKey(draft.llm.envKey.trim())
      ) {
        issues.push({
          path: "llm.envKey",
          code: "invalid",
        });
      }
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
    if (draft.embedding.provider === "google" && draft.embedding.useVertexAi) {
      if (!hasRequiredValue(draft.embedding.projectEnvKey)) {
        issues.push({
          path: "embedding.projectEnvKey",
          code: "required",
        });
      } else if (
        draft.embedding.projectEnvKey.trim().length > 128 ||
        !isEnvKey(draft.embedding.projectEnvKey.trim())
      ) {
        issues.push({
          path: "embedding.projectEnvKey",
          code: "invalid",
        });
      }
      if (!hasRequiredValue(draft.embedding.locationEnvKey)) {
        issues.push({
          path: "embedding.locationEnvKey",
          code: "required",
        });
      } else if (
        draft.embedding.locationEnvKey.trim().length > 128 ||
        !isEnvKey(draft.embedding.locationEnvKey.trim())
      ) {
        issues.push({
          path: "embedding.locationEnvKey",
          code: "invalid",
        });
      }
      if (!hasRequiredValue(draft.embedding.credentialsEnvKey)) {
        issues.push({
          path: "embedding.credentialsEnvKey",
          code: "required",
        });
      } else if (
        draft.embedding.credentialsEnvKey.trim().length > 128 ||
        !isEnvKey(draft.embedding.credentialsEnvKey.trim())
      ) {
        issues.push({
          path: "embedding.credentialsEnvKey",
          code: "invalid",
        });
      }
    } else {
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
      if (!hasRequiredValue(draft.embedding.envKey)) {
        issues.push({
          path: "embedding.envKey",
          code: "required",
        });
      } else if (
        draft.embedding.envKey.trim().length > 128 ||
        !isEnvKey(draft.embedding.envKey.trim())
      ) {
        issues.push({
          path: "embedding.envKey",
          code: "invalid",
        });
      }
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
