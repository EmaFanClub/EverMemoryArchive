import "server-only";

import {
  resolveEmbeddingModelDefinition,
  resolveLLMModelDefinition,
  type EmbeddingConfig,
  type GlobalConfigRecord,
  type LLMConfig,
} from "ema";
import {
  createAccessTokenRecord,
  hasAccessTokenConfig,
} from "@/server/services/access-token";
import {
  isEmbeddingConfigComplete,
  isLLMConfigComplete,
  initialDraft,
  setupSteps,
  validateSetupDraft,
  type SetupCheckPhase,
  type SetupCheckErrorCode,
  type SetupCheckTarget,
  type SetupDiagnostics,
  type SetupDraft,
  type SetupDryRunResponse,
  type SetupCommitResponse,
  type SetupServiceCheckRequest,
  type SetupServiceCheckResponse,
  type SetupStatusResponse,
  type SetupValidationIssue,
} from "@/types/setup/v1beta1";
import { ensureEmaServer } from "@/server/ema-server";
import { randomUUID } from "node:crypto";

const API_VERSION = "v1beta1" as const;

function now() {
  return new Date().toISOString();
}

function createCheckResponse({
  target,
  phase,
  startedAt,
  ok,
  diagnostics,
  errorCode,
  errorDetails,
  retryable = true,
}: {
  target: SetupCheckTarget;
  phase: SetupCheckPhase;
  startedAt: string;
  ok: boolean;
  diagnostics: SetupDiagnostics;
  errorCode?: SetupCheckErrorCode;
  errorDetails?: SetupDiagnostics;
  retryable?: boolean;
}): SetupServiceCheckResponse {
  const finishedAt = now();
  const durationMs = Math.max(
    1,
    new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  );

  return {
    apiVersion: API_VERSION,
    ok,
    check: {
      id: randomUUID(),
      target,
      phase,
      status: ok ? "passed" : "failed",
      startedAt,
      finishedAt,
      durationMs,
      error: ok
        ? undefined
        : {
            code: errorCode ?? "CHECK_FAILED",
            retryable,
            details: errorDetails ?? {},
          },
      diagnostics,
    },
  };
}

function failureFromIssues(
  target: SetupCheckTarget,
  phase: SetupCheckPhase,
  startedAt: string,
  issues: SetupValidationIssue[],
): SetupServiceCheckResponse {
  return createCheckResponse({
    target,
    phase,
    startedAt,
    ok: false,
    errorCode:
      issues[0]?.code === "unsupported" ? "UNSUPPORTED" : "INVALID_CONFIG",
    retryable: issues[0]?.code !== "unsupported",
    errorDetails: {
      issueCount: issues.length,
      issuePaths: issues.map((issue) => issue.path),
      issueCodes: issues.map((issue) => issue.code),
    },
    diagnostics: {
      issueCount: issues.length,
      firstIssuePath: issues[0]?.path ?? null,
    },
  });
}

function hostFromUrl(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value || null;
  }
}

function validationIssuesForCheck(
  target: SetupCheckTarget,
  config: SetupDraft[SetupCheckTarget] | undefined,
) {
  if (!config) {
    return [
      {
        path: target,
        code: "required",
      } satisfies SetupValidationIssue,
    ];
  }

  const draft: SetupDraft = {
    ...initialDraft,
    owner: {
      name: "Owner",
      accessToken: "AbC123xYz7890QwR",
      qq: "10000",
    },
    [target]: config,
  };

  return validateSetupDraftForServer(draft).filter(
    (issue) => issue.path === target || issue.path.startsWith(`${target}.`),
  );
}

export async function runSetupServiceCheck(
  target: SetupCheckTarget,
  request: SetupServiceCheckRequest,
): Promise<SetupServiceCheckResponse> {
  const startedAt = now();
  const phase = request.phase ?? "step";

  if (target === "llm") {
    const config = request.config as SetupDraft["llm"] | undefined;
    const issues = validationIssuesForCheck("llm", config);
    if (!config || issues.length > 0 || !isLLMConfigComplete(config)) {
      return failureFromIssues(
        target,
        phase,
        startedAt,
        issues.length > 0 ? issues : validationIssuesForCheck("llm", config),
      );
    }

    const resolved = buildLlmConfigForCheck(config);
    const server = await ensureEmaServer();
    const probe = await server.controller.settings.probeLlmConfig(
      resolved.config,
    );
    return createProbeCheckResponse({
      target,
      phase,
      startedAt,
      provider: diagnosticProviderForModel(config.model),
      model: config.model,
      probe,
      diagnostics: {
        provider: diagnosticProviderForModel(config.model),
        model: config.model,
        endpoint: hostFromUrl(config.baseUrl),
        credential: "configured",
        ...(config.thinkingLevel
          ? { thinkingLevel: config.thinkingLevel }
          : {}),
      },
    });
  }

  const config = request.config as SetupDraft["embedding"] | undefined;
  const issues = validationIssuesForCheck("embedding", config);
  if (!config || issues.length > 0 || !isEmbeddingConfigComplete(config)) {
    return failureFromIssues(
      target,
      phase,
      startedAt,
      issues.length > 0
        ? issues
        : validationIssuesForCheck("embedding", config),
    );
  }

  const resolved = buildEmbeddingConfigForCheck(config);
  const server = await ensureEmaServer();
  const probe = await server.controller.settings.probeEmbeddingConfig(
    resolved.config,
  );
  return createProbeCheckResponse({
    target,
    phase,
    startedAt,
    provider: diagnosticEmbeddingProviderForModel(config.model),
    model: config.model,
    probe,
    diagnostics: {
      provider: diagnosticEmbeddingProviderForModel(config.model),
      model: config.model,
      endpoint: hostFromUrl(config.baseUrl),
      credential: "configured",
      ...(config.dimensions ? { dimensions: config.dimensions } : {}),
    },
  });
}

interface ProbeResult {
  ok: boolean;
  unsupported: boolean;
  message: string;
  diagnostics?: SetupDiagnostics;
}

function createProbeCheckResponse({
  target,
  phase,
  startedAt,
  provider,
  model,
  probe,
  diagnostics,
}: {
  target: Extract<SetupCheckTarget, "llm" | "embedding">;
  phase: SetupCheckPhase;
  startedAt: string;
  provider: string;
  model: string;
  probe: ProbeResult;
  diagnostics: SetupDiagnostics;
}): SetupServiceCheckResponse {
  const errorCode = probe.ok
    ? undefined
    : probe.unsupported
      ? "UNSUPPORTED"
      : classifyProbeError(target, probe.message);
  return createCheckResponse({
    target,
    phase,
    startedAt,
    ok: probe.ok,
    retryable: !probe.unsupported,
    errorCode,
    errorDetails: probe.ok
      ? undefined
      : {
          provider,
          model,
          providerErrorType: probe.unsupported
            ? "unsupported"
            : "provider_probe_failed",
          providerErrorMessage: probe.message,
        },
    diagnostics: {
      ...diagnostics,
      ...(probe.diagnostics ?? {}),
    },
  });
}

function classifyProbeError(
  target: Extract<SetupCheckTarget, "llm" | "embedding">,
  message: string,
): SetupCheckErrorCode {
  const normalized = message.toLowerCase();
  const networkLike =
    normalized.includes("timeout") ||
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("econn") ||
    normalized.includes("enotfound") ||
    normalized.includes("etimedout") ||
    normalized.includes("abort");
  if (networkLike) {
    return target === "llm" ? "LLM_NETWORK_ERROR" : "EMBEDDING_NETWORK_ERROR";
  }
  return target === "llm" ? "LLM_PROVIDER_ERROR" : "EMBEDDING_PROVIDER_ERROR";
}

function diagnosticProviderForModel(model: string) {
  try {
    return resolveLLMModelDefinition(model).provider;
  } catch {
    return "unknown";
  }
}

function diagnosticEmbeddingProviderForModel(model: string) {
  try {
    return resolveEmbeddingModelDefinition(model).provider;
  } catch {
    return "unknown";
  }
}

function buildLlmConfigForCheck(config: SetupDraft["llm"]): {
  config: LLMConfig;
} {
  const draft: SetupDraft = {
    ...initialDraft,
    llm: config,
  };
  return {
    config: buildLlmConfig(draft),
  };
}

function buildEmbeddingConfigForCheck(config: SetupDraft["embedding"]): {
  config: EmbeddingConfig;
} {
  const draft: SetupDraft = {
    ...initialDraft,
    embedding: config,
  };
  return {
    config: buildEmbeddingConfig(draft),
  };
}

export async function buildSetupStatus(): Promise<SetupStatusResponse> {
  const server = await ensureEmaServer();
  const [status, globalConfig] = await Promise.all([
    server.controller.setup.getStatus(),
    server.dbService.globalConfigDB.getGlobalConfig(),
  ]);
  const reason = getSetupInitializationReason(
    Boolean(status.owner),
    globalConfig,
  );
  const complete = reason === null;
  return {
    apiVersion: API_VERSION,
    needsInitialization: !complete,
    reason,
    setupState: {
      status: complete ? "complete" : "required",
      configPath: "database:global_config",
      detectedConfig: Boolean(globalConfig),
    },
    recommendedSteps: setupSteps,
    capabilities: {
      llmModels: server.controller.settings.listLlmModels(),
      embeddingModels: server.controller.settings.listEmbeddingModels(),
      unsupported: [],
    },
  };
}

function getSetupInitializationReason(
  hasOwner: boolean,
  config: GlobalConfigRecord | null,
): SetupStatusResponse["reason"] {
  if (!hasOwner || !config) {
    return "CONFIG_MISSING";
  }
  if (!hasAccessTokenConfig(config)) {
    return "CONFIG_INCOMPLETE";
  }

  const llm = setupLlmFromGlobalConfig(config.defaultLlm);
  const embedding = setupEmbeddingFromGlobalConfig(config.defaultEmbedding);
  if (isStoredLlmConfigStale(llm) || isStoredEmbeddingConfigStale(embedding)) {
    return "CONFIG_STALE";
  }
  if (
    !isLLMConfigComplete(llm) ||
    !isEmbeddingConfigComplete(embedding) ||
    validateLlmModelConfig(llm).length > 0 ||
    validateEmbeddingModelConfig(embedding).length > 0
  ) {
    return "CONFIG_INCOMPLETE";
  }
  return null;
}

function setupLlmFromGlobalConfig(config: LLMConfig): SetupDraft["llm"] {
  return {
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ...(config.thinkingLevel ? { thinkingLevel: config.thinkingLevel } : {}),
  };
}

function setupEmbeddingFromGlobalConfig(
  config: EmbeddingConfig,
): SetupDraft["embedding"] {
  return {
    ...initialDraft.embedding,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ...(config.dimensions !== undefined
      ? { dimensions: config.dimensions }
      : {}),
  };
}

function isStoredLlmConfigStale(config: SetupDraft["llm"]) {
  return looksLikeEnvReference(config.apiKey);
}

function isStoredEmbeddingConfigStale(config: { apiKey: string }) {
  return looksLikeEnvReference(config.apiKey);
}

function looksLikeEnvReference(value: string) {
  const trimmed = value.trim();
  return (
    /^[A-Z][A-Z0-9_]*$/.test(trimmed) &&
    (trimmed.endsWith("_API_KEY") ||
      trimmed.endsWith("_CREDENTIALS") ||
      trimmed.endsWith("_PROJECT") ||
      trimmed.endsWith("_LOCATION"))
  );
}

function validateLlmModelConfig(
  config: SetupDraft["llm"],
): SetupValidationIssue[] {
  if (!config.model.trim()) {
    return [];
  }

  try {
    const definition = resolveLLMModelDefinition(config.model.trim());
    const thinkingLevel = toCoreThinkingLevel(config.thinkingLevel);
    if (
      thinkingLevel &&
      !definition.capabilities.thinkingLevels.includes(thinkingLevel)
    ) {
      return [{ path: "llm.thinkingLevel", code: "unsupported" }];
    }
    return [];
  } catch {
    return [{ path: "llm.model", code: "unsupported" }];
  }
}

function validateEmbeddingModelConfig(
  config: SetupDraft["embedding"],
): SetupValidationIssue[] {
  if (!config.model.trim()) {
    return [];
  }

  try {
    const definition = resolveEmbeddingModelDefinition(config.model.trim());
    if (
      config.dimensions !== undefined &&
      !definition.capabilities.dimensions.includes(config.dimensions)
    ) {
      return [{ path: "embedding.dimensions", code: "unsupported" }];
    }
    return [];
  } catch {
    return [{ path: "embedding.model", code: "unsupported" }];
  }
}

function validateSetupDraftForServer(
  draft: SetupDraft,
): SetupValidationIssue[] {
  return [
    ...validateSetupDraft(draft),
    ...validateLlmModelConfig(draft.llm),
    ...validateEmbeddingModelConfig(draft.embedding),
  ];
}

export function buildDryRunResponse(draft: SetupDraft): SetupDryRunResponse {
  const issues = validateSetupDraftForServer(draft);

  return {
    apiVersion: API_VERSION,
    ok: issues.length === 0,
    status: issues.length === 0 ? "ready" : "blocked",
    validation: {
      valid: issues.length === 0,
      issues,
    },
    plan: {
      configPath: "database:global_config",
      operations: [
        {
          id: "write-config",
          title: "写入全局配置",
          status: issues.length === 0 ? "ready" : "blocked",
        },
        {
          id: "initialize-owner",
          title: "初始化个人信息",
          status:
            draft.owner.name.trim() && draft.owner.accessToken.trim()
              ? "ready"
              : "blocked",
        },
      ],
    },
  };
}

export async function commitSetupDraft(
  draft: SetupDraft,
): Promise<SetupCommitResponse> {
  const issues = validateSetupDraftForServer(draft);
  if (issues.length > 0) {
    return {
      apiVersion: API_VERSION,
      ok: false,
      error: {
        code: "INVALID_CONFIG",
        retryable: true,
        details: {
          issueCount: issues.length,
          issuePaths: issues.map((issue) => issue.path),
          issueCodes: issues.map((issue) => issue.code),
        },
      },
    };
  }

  const server = await ensureEmaServer();
  const qq = draft.owner.qq.trim();
  const status = await server.controller.setup.commit({
    owner: {
      id: 1,
      name: draft.owner.name.trim(),
      description: "",
      avatar: "",
    },
    globalConfig: buildGlobalConfigRecord(draft),
    identityBindings: qq ? [{ channel: "qq", uid: qq }] : [],
  });
  const user = status.owner;
  if (!status.complete || !user) {
    return {
      apiVersion: API_VERSION,
      ok: false,
      error: {
        code: "COMMIT_FAILED",
        retryable: true,
        details: {
          reason: "setup_status_incomplete",
        },
      },
    };
  }

  return {
    apiVersion: API_VERSION,
    ok: true,
    user: {
      id: String(user.id),
      name: user.name,
    },
  };
}

function buildGlobalConfigRecord(draft: SetupDraft): GlobalConfigRecord {
  const nowMs = Date.now();
  return {
    id: "global",
    version: 1,
    ...createAccessTokenRecord(draft.owner.accessToken),
    defaultLlm: buildLlmConfig(draft),
    defaultEmbedding: buildEmbeddingConfig(draft),
    createdAt: nowMs,
    updatedAt: nowMs,
  };
}

export function buildLlmConfigFromSetupInput(
  config: SetupDraft["llm"],
): LLMConfig {
  return buildLlmConfig({
    ...initialDraft,
    llm: config,
  });
}

export function buildEmbeddingConfigFromSetupInput(
  config: SetupDraft["embedding"],
): EmbeddingConfig {
  return buildEmbeddingConfig({
    ...initialDraft,
    embedding: config,
  });
}

function buildLlmConfig(draft: SetupDraft): LLMConfig {
  return {
    model: draft.llm.model.trim(),
    baseUrl: draft.llm.baseUrl.trim(),
    apiKey: draft.llm.apiKey.trim(),
    ...(toCoreThinkingLevel(draft.llm.thinkingLevel)
      ? { thinkingLevel: toCoreThinkingLevel(draft.llm.thinkingLevel) }
      : {}),
  };
}

function toCoreThinkingLevel(
  value: SetupDraft["llm"]["thinkingLevel"],
): LLMConfig["thinkingLevel"] {
  return value as LLMConfig["thinkingLevel"];
}

function buildEmbeddingConfig(draft: SetupDraft): EmbeddingConfig {
  return {
    model: draft.embedding.model.trim(),
    baseUrl: draft.embedding.baseUrl.trim(),
    apiKey: draft.embedding.apiKey.trim(),
    ...(draft.embedding.dimensions !== undefined
      ? { dimensions: draft.embedding.dimensions }
      : {}),
  };
}
