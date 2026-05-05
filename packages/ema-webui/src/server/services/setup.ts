import "server-only";

import {
  DEFAULT_CHANNEL_CONFIG,
  DEFAULT_WEB_SEARCH_CONFIG,
  type EmbeddingConfig,
  type GlobalConfigRecord,
  type LLMConfig,
} from "ema";
import {
  isEmbeddingConfigComplete,
  isLLMConfigComplete,
  isLLMConfigSupported,
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
      qq: "10000",
    },
    [target]: config,
  };

  return validateSetupDraft(draft).filter(
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
    if (!config || !isLLMConfigSupported(config)) {
      return failureFromIssues(target, phase, startedAt, [
        {
          path: "llm.provider",
          code: "unsupported",
        },
      ]);
    }
    if (!isLLMConfigComplete(config)) {
      return failureFromIssues(
        target,
        phase,
        startedAt,
        validationIssuesForCheck("llm", config),
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
      provider: config.provider,
      model: config.model,
      probe,
      diagnostics: {
        provider: config.provider,
        model: config.model,
        mode: config.provider === "openai" ? config.mode : "native",
        endpoint: config.useVertexAi
          ? "vertex-ai"
          : hostFromUrl(config.baseUrl),
        credential: config.useVertexAi ? "credentials-json" : "api-key",
      },
    });
  }

  const config = request.config as SetupDraft["embedding"] | undefined;
  if (!config || !isEmbeddingConfigComplete(config)) {
    return failureFromIssues(
      target,
      phase,
      startedAt,
      validationIssuesForCheck("embedding", config),
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
    provider: config.provider,
    model: config.model,
    probe,
    diagnostics: {
      provider: config.provider,
      model: config.model,
      endpoint: config.useVertexAi ? "vertex-ai" : hostFromUrl(config.baseUrl),
      credential: config.useVertexAi ? "credentials-json" : "api-key",
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
  const status = await server.controller.setup.getStatus();
  return {
    apiVersion: API_VERSION,
    needsInitialization: !status.complete,
    reason: status.complete ? null : "CONFIG_MISSING",
    setupState: {
      status: status.complete ? "complete" : "required",
      configPath: "database:global_config",
      detectedConfig: status.hasGlobalConfig,
    },
    recommendedSteps: setupSteps,
    capabilities: {
      llmProviders: ["google", "openai", "anthropic"],
      embeddingProviders: ["google", "openai"],
      unsupported: [
        {
          path: "default_llm.anthropic",
          reason:
            "Provider UI is visible but backend adapter is not wired yet.",
        },
        {
          path: "default_llm.openai.mode=chat",
          reason:
            "Chat Completions mode is reserved for a later backend adapter.",
        },
      ],
    },
  };
}

export function buildDryRunResponse(draft: SetupDraft): SetupDryRunResponse {
  const issues = validateSetupDraft(draft);

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
          status: draft.owner.name.trim() ? "ready" : "blocked",
        },
      ],
    },
  };
}

export async function commitSetupDraft(
  draft: SetupDraft,
): Promise<SetupCommitResponse> {
  const issues = validateSetupDraft(draft);
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
    system: {
      httpsProxy: "",
    },
    defaultLlm: buildLlmConfig(draft),
    defaultEmbedding: buildEmbeddingConfig(draft),
    defaultWebSearch: DEFAULT_WEB_SEARCH_CONFIG,
    defaultChannel: DEFAULT_CHANNEL_CONFIG,
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
    provider: draft.llm.provider === "openai" ? "openai" : "google",
    openai: {
      mode: draft.llm.mode,
      model: draft.llm.provider === "openai" ? draft.llm.model.trim() : "",
      baseUrl: draft.llm.provider === "openai" ? draft.llm.baseUrl.trim() : "",
      apiKey: draft.llm.provider === "openai" ? draft.llm.apiKey.trim() : "",
    },
    google: {
      model: draft.llm.provider === "google" ? draft.llm.model.trim() : "",
      baseUrl:
        draft.llm.provider === "google" && !draft.llm.useVertexAi
          ? draft.llm.baseUrl.trim()
          : "",
      apiKey:
        draft.llm.provider === "google" && !draft.llm.useVertexAi
          ? draft.llm.apiKey.trim()
          : "",
      useVertexAi: draft.llm.provider === "google" && draft.llm.useVertexAi,
      project:
        draft.llm.provider === "google" && draft.llm.useVertexAi
          ? draft.llm.project.trim()
          : "",
      location:
        draft.llm.provider === "google" && draft.llm.useVertexAi
          ? draft.llm.location.trim()
          : "",
      credentialsFile:
        draft.llm.provider === "google" && draft.llm.useVertexAi
          ? draft.llm.credentialsFile.trim()
          : "",
    },
  };
}

function buildEmbeddingConfig(draft: SetupDraft): EmbeddingConfig {
  return {
    provider: draft.embedding.provider,
    openai: {
      model:
        draft.embedding.provider === "openai"
          ? draft.embedding.model.trim()
          : "",
      baseUrl:
        draft.embedding.provider === "openai"
          ? draft.embedding.baseUrl.trim()
          : "",
      apiKey:
        draft.embedding.provider === "openai"
          ? draft.embedding.apiKey.trim()
          : "",
    },
    google: {
      model:
        draft.embedding.provider === "google"
          ? draft.embedding.model.trim()
          : "",
      baseUrl:
        draft.embedding.provider === "google" && !draft.embedding.useVertexAi
          ? draft.embedding.baseUrl.trim()
          : "",
      apiKey:
        draft.embedding.provider === "google" && !draft.embedding.useVertexAi
          ? draft.embedding.apiKey.trim()
          : "",
      useVertexAi:
        draft.embedding.provider === "google" && draft.embedding.useVertexAi,
      project:
        draft.embedding.provider === "google" && draft.embedding.useVertexAi
          ? draft.embedding.project.trim()
          : "",
      location:
        draft.embedding.provider === "google" && draft.embedding.useVertexAi
          ? draft.embedding.location.trim()
          : "",
      credentialsFile:
        draft.embedding.provider === "google" && draft.embedding.useVertexAi
          ? draft.embedding.credentialsFile.trim()
          : "",
    },
  };
}
