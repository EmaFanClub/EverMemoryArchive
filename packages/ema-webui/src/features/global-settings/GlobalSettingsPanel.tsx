"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  KeyRound,
  LoaderCircle,
  Network,
  User,
  X,
} from "lucide-react";

import styles from "@/app/dashboard/page.module.css";
import {
  getGlobalSettings,
  runGlobalEmbeddingCheck,
  runGlobalLlmCheck,
  saveGlobalAccessToken,
  saveGlobalEmbeddingConfig,
  saveGlobalLlmConfig,
  saveOwnerQqBinding,
} from "@/transport/dashboard";
import {
  dashboardTransportFailureFeedback,
  diagnosticMetaFromDiagnostics,
  localDashboardFeedback,
  technicalDetailFromDiagnostics,
  type DashboardCheckFeedback,
} from "@/types/dashboard/feedback";
import type {
  GlobalEmbeddingConfig,
  GlobalEmbeddingIndexStatus,
  GlobalLlmConfig,
  GlobalSettingsResponse,
  LlmModelOption,
  LlmModelProvider,
  LlmThinkingLevel,
} from "@/types/dashboard/v1beta1";
import {
  embeddingDefaults,
  type EmbeddingProvider,
} from "@/types/setup/v1beta1";

type DetailTitle = "Web UI" | "QQ号绑定" | "默认LLM服务" | "默认Embedding服务";
type CheckStatus = "idle" | "testing" | "success" | "error";
type LegacyOpenAiMode = "responses" | "chat";

interface ServiceProviderFields {
  mode: LegacyOpenAiMode;
  model: string;
  baseUrl: string;
  apiKey: string;
}

interface ServiceDraft {
  provider: EmbeddingProvider;
  google: ServiceProviderFields;
  openai: ServiceProviderFields;
}

interface LlmServiceDraft {
  model: string;
  baseUrl: string;
  apiKey: string;
  thinkingLevel?: LlmThinkingLevel;
}

interface ToastState {
  id: number;
  message: string;
  kind: "success" | "error";
}

const COPY_TOAST_DURATION = 1400;
const EMBEDDING_MODELS: Record<EmbeddingProvider, string[]> = {
  google: ["gemini-embedding-001"],
  openai: ["text-embedding-3-large"],
};
const EMBEDDING_PROVIDER_LABELS: Record<EmbeddingProvider, string> = {
  google: "Google",
  openai: "OpenAI",
};
const EMBEDDING_API_KEY_PLACEHOLDERS: Record<EmbeddingProvider, string> = {
  google: "AIzaSyA7fK...D5eJ 或 Vertex AI 凭据 JSON",
  openai: "sk-u1Kv9xP...ZTyU",
};
const LLM_PROVIDER_LABELS: Record<LlmModelProvider, string> = {
  openai: "OpenAI",
  google: "Google",
  anthropic: "Anthropic",
  zai: "Z.ai",
  moonshot: "Moonshot",
  qwen: "Qwen",
};
const LLM_API_KEY_PLACEHOLDERS: Record<LlmModelProvider, string> = {
  google: "AIzaSyA7fK...D5eJ 或 Vertex AI 凭据 JSON",
  openai: "sk-u1Kv9xP...ZTyU",
  anthropic: "sk-ant-9xW...G0hJ",
  zai: "zai_...",
  moonshot: "sk-...",
  qwen: "本地服务可填写任意占位值",
};
const THINKING_LEVEL_LABELS: Record<LlmThinkingLevel, string> = {
  none: "关闭",
  low: "低",
  medium: "中",
  high: "高",
};
const VERTEX_CREDENTIALS_JSON_LIMIT = 16_384;
const LLM_CREDENTIAL_LIMIT = VERTEX_CREDENTIALS_JSON_LIMIT;
function fieldsFromSetupDefaults(defaults: {
  mode?: LegacyOpenAiMode;
  model: string;
  baseUrl: string;
  apiKey: string;
}): ServiceProviderFields {
  return {
    mode: defaults.mode ?? "responses",
    model: defaults.model,
    baseUrl: defaults.baseUrl,
    apiKey: defaults.apiKey,
  };
}

function valueOrDefault(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

const DEFAULT_LLM_DRAFT: LlmServiceDraft = {
  model: "",
  baseUrl: "",
  apiKey: "",
};
const DEFAULT_EMBEDDING_DRAFT: ServiceDraft = {
  provider: "google",
  google: fieldsFromSetupDefaults(embeddingDefaults.google),
  openai: fieldsFromSetupDefaults(embeddingDefaults.openai),
};
const EMPTY_INDEX_STATUS: GlobalEmbeddingIndexStatus = {
  state: "not_started",
  activeFingerprint: null,
  activeProvider: null,
  activeModel: null,
};

function userInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "U";
}

function serviceDraftFromLlmConfig(
  config: GlobalSettingsResponse["services"]["llm"],
  models: LlmModelOption[],
): LlmServiceDraft {
  const selected =
    models.find((option) => option.model === config.model) ?? models[0] ?? null;
  return {
    model: valueOrDefault(config.model, selected?.model ?? ""),
    baseUrl: valueOrDefault(config.baseUrl, selected?.defaultBaseUrl ?? ""),
    apiKey: config.apiKey,
    thinkingLevel: selected
      ? normalizeThinkingLevel(selected, config.thinkingLevel)
      : config.thinkingLevel,
  };
}

function serviceDraftFromEmbeddingConfig(
  config: GlobalEmbeddingConfig,
): ServiceDraft {
  const providerFields =
    config.provider === "openai"
      ? DEFAULT_EMBEDDING_DRAFT.openai
      : DEFAULT_EMBEDDING_DRAFT.google;
  return {
    ...DEFAULT_EMBEDDING_DRAFT,
    provider: config.provider,
    [config.provider]: {
      ...providerFields,
      model: valueOrDefault(config.model, providerFields.model),
      baseUrl: valueOrDefault(config.baseUrl, providerFields.baseUrl),
      apiKey: valueOrDefault(config.apiKey, providerFields.apiKey),
    },
  };
}

function llmConfigFromDraft(draft: LlmServiceDraft): GlobalLlmConfig {
  return {
    model: draft.model.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    ...(draft.thinkingLevel ? { thinkingLevel: draft.thinkingLevel } : {}),
  };
}

function embeddingConfigFromDraft(draft: ServiceDraft): GlobalEmbeddingConfig {
  const provider = draft.provider === "openai" ? "openai" : "google";
  const active = draft[provider];
  return {
    provider,
    model: active.model.trim(),
    baseUrl: active.baseUrl.trim(),
    apiKey: active.apiKey.trim(),
  };
}

function areDraftsEqual(left: ServiceDraft, right: ServiceDraft) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areLlmDraftsEqual(left: LlmServiceDraft, right: LlmServiceDraft) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function draftSignature(draft: ServiceDraft) {
  return JSON.stringify(trimServiceDraft(draft));
}

function llmDraftSignature(draft: LlmServiceDraft) {
  return JSON.stringify(trimLlmDraft(draft));
}

function trimServiceFields(
  fields: ServiceProviderFields,
): ServiceProviderFields {
  return {
    mode: fields.mode,
    model: fields.model.trim(),
    baseUrl: fields.baseUrl.trim(),
    apiKey: fields.apiKey.trim(),
  };
}

function trimServiceDraft(draft: ServiceDraft): ServiceDraft {
  return {
    provider: draft.provider,
    google: trimServiceFields(draft.google),
    openai: trimServiceFields(draft.openai),
  };
}

function trimLlmDraft(draft: LlmServiceDraft): LlmServiceDraft {
  return {
    model: draft.model.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    ...(draft.thinkingLevel ? { thinkingLevel: draft.thinkingLevel } : {}),
  };
}

function isHttpUrlValue(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function defaultThinkingLevel(option: LlmModelOption) {
  if (option.capabilities.thinkingLevels.length === 0) {
    return undefined;
  }
  if (
    option.requestDefaults.thinkingLevel &&
    option.capabilities.thinkingLevels.includes(
      option.requestDefaults.thinkingLevel,
    )
  ) {
    return option.requestDefaults.thinkingLevel;
  }
  return option.capabilities.thinkingLevels[0];
}

function normalizeThinkingLevel(
  option: LlmModelOption,
  value: LlmThinkingLevel | undefined,
) {
  if (option.capabilities.thinkingLevels.length === 0) {
    return undefined;
  }
  return value && option.capabilities.thinkingLevels.includes(value)
    ? value
    : defaultThinkingLevel(option);
}

function llmDraftForModel(
  option: LlmModelOption,
  current: LlmServiceDraft,
): LlmServiceDraft {
  return {
    model: option.model,
    baseUrl: option.defaultBaseUrl,
    apiKey: current.apiKey,
    thinkingLevel: normalizeThinkingLevel(option, current.thinkingLevel),
  };
}

function validateLlmDraft(draft: LlmServiceDraft, models: LlmModelOption[]) {
  if (!draft.model.trim()) {
    return localDashboardFeedback("模型未填写", "模型名称是必填项。");
  }
  const selected = models.find((option) => option.model === draft.model.trim());
  if (!selected) {
    return localDashboardFeedback(
      "模型暂不支持",
      "请从模型列表中选择一个支持的模型。",
      "UNSUPPORTED",
    );
  }
  if (!draft.baseUrl.trim() || !isHttpUrlValue(draft.baseUrl.trim())) {
    return localDashboardFeedback(
      "接口地址格式错误",
      "请填写以 http:// 或 https:// 开头的有效接口地址。",
    );
  }
  if (!draft.apiKey.trim()) {
    return localDashboardFeedback("ApiKey未填写", "ApiKey 是必填项。");
  }
  if (draft.apiKey.trim().length > LLM_CREDENTIAL_LIMIT) {
    return localDashboardFeedback(
      "ApiKey过长",
      `ApiKey 不能超过 ${LLM_CREDENTIAL_LIMIT} 个字符。`,
    );
  }
  if (
    draft.thinkingLevel &&
    !selected.capabilities.thinkingLevels.includes(draft.thinkingLevel)
  ) {
    return localDashboardFeedback(
      "思考等级暂不支持",
      "当前模型不支持所选思考等级。",
      "UNSUPPORTED",
    );
  }
  return null;
}

function validateServiceDraft(draft: ServiceDraft) {
  const active = draft[draft.provider];
  if (!active.model.trim()) {
    return localDashboardFeedback("模型未填写", "模型名称是必填项。");
  }

  if (!active.baseUrl.trim() || !isHttpUrlValue(active.baseUrl.trim())) {
    return localDashboardFeedback(
      "接口地址格式错误",
      "请填写以 http:// 或 https:// 开头的有效接口地址。",
    );
  }
  if (!active.apiKey.trim()) {
    return localDashboardFeedback("ApiKey未填写", "ApiKey 是必填项。");
  }
  if (active.apiKey.trim().length > VERTEX_CREDENTIALS_JSON_LIMIT) {
    return localDashboardFeedback(
      "ApiKey过长",
      `ApiKey 不能超过 ${VERTEX_CREDENTIALS_JSON_LIMIT} 个字符。`,
    );
  }
  return null;
}

function feedbackFromErrorResponse(
  response:
    | Awaited<ReturnType<typeof runGlobalLlmCheck>>
    | Awaited<ReturnType<typeof runGlobalEmbeddingCheck>>,
): DashboardCheckFeedback {
  if (response.ok) {
    return {
      summary: "检查通过",
      detail: null,
      code: null,
      technicalDetail: null,
      meta: [{ label: "耗时", value: `${response.check.durationMs} ms` }],
    };
  }
  const error = response.check.error;
  const details = error?.details ?? {};
  const diagnostics = response.check.diagnostics;
  return {
    summary:
      error?.code === "UNSUPPORTED"
        ? "当前模式暂不可用"
        : error?.code === "INVALID_CONFIG"
          ? "配置项还不完整"
          : "检查未通过",
    detail:
      typeof details.providerErrorMessage === "string"
        ? details.providerErrorMessage
        : null,
    code: error?.code ?? "CHECK_FAILED",
    technicalDetail:
      technicalDetailFromDiagnostics(details) ??
      technicalDetailFromDiagnostics(diagnostics),
    meta: [
      ...diagnosticMetaFromDiagnostics(diagnostics),
      { label: "耗时", value: `${response.check.durationMs} ms` },
    ],
  };
}

function indexStatusCard(
  index: GlobalEmbeddingIndexStatus,
  restartRequired: boolean,
  dirty: boolean,
) {
  const progress =
    typeof index.indexedMemories === "number" &&
    typeof index.totalMemories === "number"
      ? `已索引 ${index.indexedMemories}/${index.totalMemories} 条长期记忆。`
      : null;
  if (dirty) {
    return {
      tone: "warning" as const,
      title: "保存后将在下次启动后生效",
      detail:
        "下次启动会使用新的 Embedding 服务重新嵌入所有长期记忆，可能产生较高 API 费用和耗时。",
    };
  }
  if (restartRequired) {
    return {
      tone: "warning" as const,
      title: "新的 Embedding 配置将在下次启动后生效",
      detail:
        "当前服务仍使用启动时的 Embedding 配置和索引；下次启动会重新嵌入所有长期记忆，可能产生较高 API 费用和耗时。",
    };
  }
  if (index.state === "indexing") {
    return {
      tone: "warning" as const,
      title: "正在建立 Embedding 索引",
      detail: `${progress ?? "索引进度正在更新。"}长期记忆检索会在索引完成后恢复。`,
    };
  }
  if (index.state === "degraded") {
    return {
      tone: "warning" as const,
      title: "Embedding 索引不完整",
      detail: `${progress ?? "部分长期记忆未完成索引。"}长期记忆检索暂不可用。${
        index.error ? `错误：${index.error}` : ""
      }`,
    };
  }
  if (index.state === "failed") {
    return {
      tone: "error" as const,
      title: "Embedding 索引建立失败",
      detail: index.error || "长期记忆搜索可能暂不可用。",
    };
  }
  if (index.state === "ready") {
    return {
      tone: "info" as const,
      title: "Embedding 索引正常",
      detail: progress ?? "长期记忆搜索可用。",
    };
  }
  return {
    tone: "warning" as const,
    title: "Embedding 索引未开始",
    detail: "服务启动后会自动建立索引，长期记忆检索会在索引完成后恢复。",
  };
}

export function GlobalSettingsPanel() {
  const [settings, setSettings] = useState<GlobalSettingsResponse | null>(null);
  const [detailTitle, setDetailTitle] = useState<DetailTitle | null>(null);
  const [detailClosing, setDetailClosing] = useState(false);
  const [unsavedDialogVisible, setUnsavedDialogVisible] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [qqDraft, setQqDraft] = useState("");
  const [savedQq, setSavedQq] = useState("");
  const [qqSaving, setQqSaving] = useState(false);
  const [webuiTokenDraft, setWebuiTokenDraft] = useState("");
  const [webuiTokenConfigured, setWebuiTokenConfigured] = useState(false);
  const [webuiTokenSaving, setWebuiTokenSaving] = useState(false);
  const [savedLlm, setSavedLlm] = useState<LlmServiceDraft>(DEFAULT_LLM_DRAFT);
  const [llmDraft, setLlmDraft] = useState<LlmServiceDraft>(DEFAULT_LLM_DRAFT);
  const [llmStatus, setLlmStatus] = useState<CheckStatus>("idle");
  const [llmFeedback, setLlmFeedback] = useState<DashboardCheckFeedback | null>(
    null,
  );
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmLastPassed, setLlmLastPassed] = useState<string | null>(null);
  const [savedEmbedding, setSavedEmbedding] = useState<ServiceDraft>(
    DEFAULT_EMBEDDING_DRAFT,
  );
  const [embeddingDraft, setEmbeddingDraft] = useState<ServiceDraft>(
    DEFAULT_EMBEDDING_DRAFT,
  );
  const [embeddingStatus, setEmbeddingStatus] = useState<CheckStatus>("idle");
  const [embeddingFeedback, setEmbeddingFeedback] =
    useState<DashboardCheckFeedback | null>(null);
  const [embeddingSaving, setEmbeddingSaving] = useState(false);
  const [embeddingLastPassed, setEmbeddingLastPassed] = useState<string | null>(
    null,
  );
  const [embeddingRestartRequired, setEmbeddingRestartRequired] =
    useState(false);
  const [embeddingIndex, setEmbeddingIndex] =
    useState<GlobalEmbeddingIndexStatus>(EMPTY_INDEX_STATUS);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGlobalSettings()
      .then((response) => {
        if (cancelled) return;
        setSettings(response);
        setQqDraft(response.identityBindings.qq.uid);
        setSavedQq(response.identityBindings.qq.uid);
        setWebuiTokenDraft("");
        setWebuiTokenConfigured(response.access.webui.configured);
        const nextLlm = serviceDraftFromLlmConfig(
          response.services.llm,
          response.services.llmModels,
        );
        const nextEmbedding = serviceDraftFromEmbeddingConfig(
          response.services.embedding,
        );
        setSavedLlm(nextLlm);
        setLlmDraft(nextLlm);
        setLlmStatus("idle");
        setLlmFeedback(null);
        setSavedEmbedding(nextEmbedding);
        setEmbeddingDraft(nextEmbedding);
        setEmbeddingStatus("idle");
        setEmbeddingFeedback(null);
        setEmbeddingRestartRequired(response.services.embeddingRestartRequired);
        setEmbeddingIndex(response.services.embeddingIndex);
      })
      .catch((error) =>
        showToast(`设置加载失败：${messageFromError(error)}`, "error"),
      );
    return () => {
      cancelled = true;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (embeddingIndex.state !== "indexing") {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      getGlobalSettings()
        .then((response) => {
          if (cancelled) return;
          setEmbeddingRestartRequired(
            response.services.embeddingRestartRequired,
          );
          setEmbeddingIndex(response.services.embeddingIndex);
        })
        .catch(() => {
          // Keep the last known indexing state; the next poll may recover.
        });
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [embeddingIndex.state]);

  const userName = settings?.user.name ?? "你";
  const llmDirty = !areLlmDraftsEqual(llmDraft, savedLlm);
  const embeddingDirty = !areDraftsEqual(embeddingDraft, savedEmbedding);
  const qqDirty = qqDraft.trim() !== savedQq;
  const webuiTokenDirty = Boolean(webuiTokenDraft.trim());

  function showToast(message: string, kind: ToastState["kind"]) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast((current) => ({
      id: (current?.id ?? 0) + 1,
      message,
      kind,
    }));
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, COPY_TOAST_DURATION);
  }

  function openDetail(title: DetailTitle) {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setDetailTitle(title);
    setDetailClosing(false);
    if (title === "默认Embedding服务") {
      getGlobalSettings()
        .then((response) => {
          setEmbeddingRestartRequired(
            response.services.embeddingRestartRequired,
          );
          setEmbeddingIndex(response.services.embeddingIndex);
        })
        .catch(() => {
          // Keep the last known index status; the detail can still be edited.
        });
    }
  }

  function closeDetail() {
    if (!detailTitle || detailClosing) return;
    setUnsavedDialogVisible(false);
    setDetailClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setDetailTitle(null);
      setDetailClosing(false);
      closeTimerRef.current = null;
    }, 240);
  }

  function isCurrentDetailDirty() {
    if (detailTitle === "Web UI") return webuiTokenDirty;
    if (detailTitle === "QQ号绑定") return qqDirty;
    if (detailTitle === "默认LLM服务") return llmDirty;
    if (detailTitle === "默认Embedding服务") return embeddingDirty;
    return false;
  }

  function updateLlmDraft(nextDraft: LlmServiceDraft) {
    setLlmDraft(nextDraft);
    setLlmStatus("idle");
    setLlmFeedback(null);
  }

  function updateEmbeddingDraft(nextDraft: ServiceDraft) {
    setEmbeddingDraft(nextDraft);
    setEmbeddingStatus("idle");
    setEmbeddingFeedback(null);
  }

  function requestCloseDetail() {
    if (isCurrentDetailDirty()) {
      setUnsavedDialogVisible(true);
      return;
    }
    closeDetail();
  }

  function discardCurrentDetailAndClose() {
    if (detailTitle === "Web UI") {
      setWebuiTokenDraft("");
      setWebuiTokenSaving(false);
    }
    if (detailTitle === "QQ号绑定") {
      setQqDraft(savedQq);
      setQqSaving(false);
    }
    if (detailTitle === "默认LLM服务") {
      setLlmDraft(savedLlm);
      setLlmStatus("idle");
      setLlmFeedback(null);
      setLlmSaving(false);
    }
    if (detailTitle === "默认Embedding服务") {
      setEmbeddingDraft(savedEmbedding);
      setEmbeddingStatus("idle");
      setEmbeddingFeedback(null);
      setEmbeddingSaving(false);
    }
    closeDetail();
  }

  async function testLlm() {
    const feedback = validateLlmDraft(
      llmDraft,
      settings?.services.llmModels ?? [],
    );
    if (feedback) {
      setLlmStatus("error");
      setLlmFeedback(feedback);
      return false;
    }
    const signature = llmDraftSignature(llmDraft);
    setLlmStatus("testing");
    setLlmFeedback(null);
    try {
      const response = await runGlobalLlmCheck(llmConfigFromDraft(llmDraft));
      setLlmStatus(response.ok ? "success" : "error");
      setLlmFeedback(response.ok ? null : feedbackFromErrorResponse(response));
      if (response.ok) setLlmLastPassed(signature);
      return response.ok;
    } catch (error) {
      setLlmStatus("error");
      setLlmFeedback(dashboardTransportFailureFeedback(error));
      return false;
    }
  }

  async function saveLlm() {
    if (!llmDirty || llmSaving) return;
    const signature = llmDraftSignature(llmDraft);
    if (!(llmStatus === "success" && llmLastPassed === signature)) {
      const ok = await testLlm();
      if (!ok) return;
    }
    setLlmSaving(true);
    try {
      const response = await saveGlobalLlmConfig(llmConfigFromDraft(llmDraft));
      if (response.ok) {
        setSavedLlm(llmDraft);
        setLlmStatus("idle");
        setLlmFeedback(null);
        showToast("默认 LLM 已保存", "success");
      } else {
        showToast("保存失败", "error");
      }
    } catch (error) {
      showToast(`保存失败：${messageFromError(error)}`, "error");
    } finally {
      setLlmSaving(false);
    }
  }

  async function testEmbedding() {
    const feedback = validateServiceDraft(embeddingDraft);
    if (feedback) {
      setEmbeddingStatus("error");
      setEmbeddingFeedback(feedback);
      return false;
    }
    const signature = draftSignature(embeddingDraft);
    setEmbeddingStatus("testing");
    setEmbeddingFeedback(null);
    try {
      const response = await runGlobalEmbeddingCheck(
        embeddingConfigFromDraft(embeddingDraft),
      );
      setEmbeddingStatus(response.ok ? "success" : "error");
      setEmbeddingFeedback(
        response.ok ? null : feedbackFromErrorResponse(response),
      );
      if (response.ok) setEmbeddingLastPassed(signature);
      return response.ok;
    } catch (error) {
      setEmbeddingStatus("error");
      setEmbeddingFeedback(dashboardTransportFailureFeedback(error));
      return false;
    }
  }

  async function saveEmbedding() {
    if (!embeddingDirty || embeddingSaving) return;
    const signature = draftSignature(embeddingDraft);
    if (!(embeddingStatus === "success" && embeddingLastPassed === signature)) {
      const ok = await testEmbedding();
      if (!ok) return;
    }
    setEmbeddingSaving(true);
    try {
      const response = await saveGlobalEmbeddingConfig(
        embeddingConfigFromDraft(embeddingDraft),
      );
      if (response.ok) {
        setSavedEmbedding(embeddingDraft);
        setEmbeddingStatus("idle");
        setEmbeddingFeedback(null);
        setEmbeddingRestartRequired(response.restartRequired);
        setEmbeddingIndex(response.embeddingIndex);
        showToast("默认 Embedding 已保存", "success");
      } else {
        showToast("保存失败", "error");
      }
    } catch (error) {
      showToast(`保存失败：${messageFromError(error)}`, "error");
    } finally {
      setEmbeddingSaving(false);
    }
  }

  async function saveQq() {
    if (!qqDirty || qqSaving) return;
    if (qqDraft.trim() && !/^\d+$/.test(qqDraft.trim())) {
      showToast("QQ号只能包含数字", "error");
      return;
    }
    setQqSaving(true);
    try {
      const response = await saveOwnerQqBinding(qqDraft.trim());
      if (response.ok) {
        setSavedQq(response.binding.uid);
        setQqDraft(response.binding.uid);
        showToast("QQ号绑定已保存", "success");
      } else {
        showToast(response.error?.message ?? "保存失败", "error");
      }
    } catch (error) {
      showToast(`保存失败：${messageFromError(error)}`, "error");
    } finally {
      setQqSaving(false);
    }
  }

  async function saveWebuiToken() {
    if (!webuiTokenDirty || webuiTokenSaving) return;
    setWebuiTokenSaving(true);
    try {
      const response = await saveGlobalAccessToken(webuiTokenDraft.trim());
      if (response.ok) {
        setWebuiTokenConfigured(response.access.webui.configured);
        setWebuiTokenDraft("");
        showToast("Web UI 访问 Token 已保存", "success");
      } else {
        showToast(response.error?.message ?? "保存失败", "error");
      }
    } catch (error) {
      showToast(`保存失败：${messageFromError(error)}`, "error");
    } finally {
      setWebuiTokenSaving(false);
    }
  }

  return (
    <div className={styles.actorSettings}>
      <div className={styles.actorSettingsScroll}>
        <div className={styles.actorSettingsContent}>
          <section className={styles.actorSettingsProfile}>
            <button
              type="button"
              className={styles.actorSettingsAvatarButton}
              aria-label="更换头像"
              onClick={() => showToast("暂不支持", "error")}
            >
              <span className={styles.actorSettingsAvatarText}>
                {userInitial(userName)}
              </span>
              <span className={styles.actorSettingsAvatarOverlay}>
                <Camera aria-hidden="true" />
              </span>
            </button>
            <h3 className={styles.actorSettingsProfileName}>{userName}</h3>
          </section>

          <section className={styles.actorSettingsSection}>
            <h3 className={styles.actorSettingsSectionTitle}>
              <span>访问</span>
            </h3>
            <div className={styles.actorSettingsMenuList}>
              <SettingsMenuButton
                icon={<KeyRound aria-hidden="true" />}
                title="Web UI"
                description="配置访问token等"
                onClick={() => openDetail("Web UI")}
              />
            </div>
          </section>

          <section className={styles.actorSettingsSection}>
            <h3 className={styles.actorSettingsSectionTitle}>
              <span>账号</span>
            </h3>
            <div className={styles.actorSettingsMenuList}>
              <SettingsMenuButton
                icon={<User aria-hidden="true" />}
                title="QQ号绑定"
                description={
                  savedQq ? `已绑定 ${savedQq}` : "用于识别你的 QQ 身份"
                }
                onClick={() => openDetail("QQ号绑定")}
              />
            </div>
          </section>

          <section className={styles.actorSettingsSection}>
            <h3 className={styles.actorSettingsSectionTitle}>
              <span>服务</span>
            </h3>
            <div className={styles.actorSettingsMenuList}>
              <SettingsMenuButton
                icon={<Bot aria-hidden="true" />}
                title="默认LLM服务"
                description="配置系统默认对话模型"
                onClick={() => openDetail("默认LLM服务")}
              />
              <SettingsMenuButton
                icon={<Network aria-hidden="true" />}
                title="默认Embedding服务"
                description="配置长期记忆检索向量服务"
                onClick={() => openDetail("默认Embedding服务")}
              />
            </div>
          </section>
        </div>
      </div>

      {detailTitle ? (
        <div
          className={`${styles.actorSettingsDetail} ${
            detailClosing ? styles.actorSettingsDetailClosing : ""
          }`}
          role="dialog"
          aria-modal="false"
          aria-label={`${detailTitle} 设置`}
        >
          <div className={styles.actorSettingsDetailHeader}>
            <div className={styles.actorSettingsDetailHeaderInner}>
              <h3>{detailTitle}</h3>
              <button
                type="button"
                className={styles.actorSettingsDetailClose}
                aria-label="关闭二级菜单"
                onClick={requestCloseDetail}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
          {detailTitle === "Web UI" ? (
            <WebUiAccessDetail
              value={webuiTokenDraft}
              configured={webuiTokenConfigured}
              dirty={webuiTokenDirty}
              isSaving={webuiTokenSaving}
              onChange={setWebuiTokenDraft}
              onSave={saveWebuiToken}
            />
          ) : detailTitle === "QQ号绑定" ? (
            <QqBindingDetail
              value={qqDraft}
              dirty={qqDirty}
              isSaving={qqSaving}
              onChange={setQqDraft}
              onSave={saveQq}
            />
          ) : detailTitle === "默认LLM服务" ? (
            <LlmServiceDetail
              draft={llmDraft}
              models={settings?.services.llmModels ?? []}
              dirty={llmDirty}
              status={llmStatus}
              feedback={llmFeedback}
              isSaving={llmSaving}
              onDraftChange={updateLlmDraft}
              onTestConnection={testLlm}
              onSave={saveLlm}
            />
          ) : (
            <ServiceDetail
              draft={embeddingDraft}
              dirty={embeddingDirty}
              status={embeddingStatus}
              feedback={embeddingFeedback}
              isSaving={embeddingSaving}
              embeddingIndex={embeddingIndex}
              embeddingRestartRequired={embeddingRestartRequired}
              onDraftChange={updateEmbeddingDraft}
              onTestConnection={testEmbedding}
              onSave={saveEmbedding}
            />
          )}
          {unsavedDialogVisible ? (
            <UnsavedDialog
              title={detailTitle}
              onCancel={() => setUnsavedDialogVisible(false)}
              onDiscard={discardCurrentDetailAndClose}
            />
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <div
          key={toast.id}
          className={`${styles.actorSettingsToast} ${
            toast.kind === "success"
              ? styles.actorSettingsToastSuccess
              : styles.actorSettingsToastError
          }`}
          role={toast.kind === "success" ? "status" : "alert"}
        >
          {toast.kind === "success" ? (
            <Check aria-hidden="true" />
          ) : (
            <X aria-hidden="true" />
          )}
          <span>{toast.message}</span>
        </div>
      ) : null}
    </div>
  );
}

function SettingsMenuButton({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.actorSettingsMenuItem}
      onClick={onClick}
    >
      <span className={styles.actorSettingsMenuIcon}>{icon}</span>
      <span className={styles.actorSettingsMenuText}>
        <span className={styles.actorSettingsMenuTitle}>{title}</span>
        <span className={styles.actorSettingsMenuDescription}>
          {description}
        </span>
      </span>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}

function WebUiAccessDetail({
  value,
  configured,
  dirty,
  isSaving,
  onChange,
  onSave,
}: {
  value: string;
  configured: boolean;
  dirty: boolean;
  isSaving: boolean;
  onChange: (value: string) => void;
  onSave: () => void | Promise<void>;
}) {
  return (
    <>
      <div className={styles.llmSettingsBody}>
        <div className={styles.llmSettingsContent}>
          <div className={styles.settingsInfoCard} role="note">
            <Info aria-hidden="true" />
            <span>
              <strong>
                {configured ? "访问 Token 已配置" : "访问 Token 未配置"}
              </strong>
              <small>保存新的 Token 后，当前浏览器会自动更新登录凭据。</small>
            </span>
          </div>
          <label className={styles.llmSettingsField}>
            <span className={styles.llmSettingsControlTitle}>访问 Token</span>
            <input
              value={value}
              placeholder="输入新的访问 Token"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onChange(event.currentTarget.value)}
            />
          </label>
        </div>
      </div>
      <SettingsFooter dirty={dirty} isSaving={isSaving} onSave={onSave} />
    </>
  );
}

function QqBindingDetail({
  value,
  dirty,
  isSaving,
  onChange,
  onSave,
}: {
  value: string;
  dirty: boolean;
  isSaving: boolean;
  onChange: (value: string) => void;
  onSave: () => void | Promise<void>;
}) {
  return (
    <>
      <div className={styles.llmSettingsBody}>
        <div className={styles.llmSettingsContent}>
          <label className={styles.llmSettingsField}>
            <span className={styles.llmSettingsControlTitle}>QQ号</span>
            <input
              value={value}
              inputMode="numeric"
              placeholder="未配置"
              onChange={(event) => onChange(event.currentTarget.value)}
            />
          </label>
        </div>
      </div>
      <SettingsFooter dirty={dirty} isSaving={isSaving} onSave={onSave} />
    </>
  );
}

function LlmServiceDetail({
  draft,
  models,
  dirty,
  status,
  feedback,
  isSaving,
  onDraftChange,
  onTestConnection,
  onSave,
}: {
  draft: LlmServiceDraft;
  models: LlmModelOption[];
  dirty: boolean;
  status: CheckStatus;
  feedback: DashboardCheckFeedback | null;
  isSaving: boolean;
  onDraftChange: (draft: LlmServiceDraft) => void;
  onTestConnection: () => void | Promise<unknown>;
  onSave: () => void | Promise<void>;
}) {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const selectedModel =
    models.find((option) => option.model === draft.model) ?? null;
  const isTesting = status === "testing";

  function updateDraft(patch: Partial<LlmServiceDraft>) {
    onDraftChange({ ...draft, ...patch });
  }

  function selectModel(option: LlmModelOption) {
    onDraftChange(llmDraftForModel(option, draft));
    setModelDropdownOpen(false);
  }

  return (
    <>
      <div className={styles.llmSettingsBody}>
        <div className={styles.llmSettingsContent}>
          <section className={styles.llmSettingsSection}>
            <div className={styles.llmSettingsFields}>
              <label className={styles.llmSettingsField}>
                <span className={styles.llmSettingsControlTitle}>模型</span>
                <div
                  className={styles.llmModelSelect}
                  onBlur={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (
                      nextTarget instanceof Node &&
                      event.currentTarget.contains(nextTarget)
                    ) {
                      return;
                    }
                    setModelDropdownOpen(false);
                  }}
                >
                  <button
                    type="button"
                    className={`${styles.llmModelSelectButton} ${
                      !draft.model ? styles.llmModelSelectPlaceholder : ""
                    } ${
                      modelDropdownOpen ? styles.llmModelSelectButtonOpen : ""
                    }`}
                    aria-haspopup="listbox"
                    aria-expanded={modelDropdownOpen}
                    onClick={() => setModelDropdownOpen((current) => !current)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setModelDropdownOpen(false);
                        event.currentTarget.blur();
                      }
                    }}
                  >
                    <span>{draft.model || "选择模型"}</span>
                    <ChevronDown aria-hidden="true" />
                  </button>
                  {modelDropdownOpen ? (
                    <div
                      className={styles.llmModelSelectMenu}
                      role="listbox"
                      aria-label="选择模型"
                    >
                      {models.length > 0 ? (
                        models.map((option, index) => {
                          const groupLabel =
                            LLM_PROVIDER_LABELS[option.provider];
                          const previous = models[index - 1];
                          const showGroup =
                            !previous || previous.provider !== option.provider;
                          return (
                            <div
                              key={option.model}
                              className={styles.llmModelSelectGroup}
                              role="presentation"
                            >
                              {showGroup ? (
                                <span
                                  className={styles.llmModelSelectGroupLabel}
                                >
                                  {groupLabel}
                                </span>
                              ) : null}
                              <button
                                type="button"
                                role="option"
                                aria-selected={draft.model === option.model}
                                className={`${styles.llmModelSelectOption} ${
                                  draft.model === option.model
                                    ? styles.llmModelSelectOptionActive
                                    : ""
                                }`}
                                onClick={() => selectModel(option)}
                              >
                                <span>{option.model}</span>
                                {draft.model === option.model ? (
                                  <Check aria-hidden="true" />
                                ) : null}
                              </button>
                            </div>
                          );
                        })
                      ) : (
                        <span
                          className={`${styles.llmModelSelectOption} ${styles.llmModelSelectOptionDisabled}`}
                          role="option"
                          aria-selected="false"
                          aria-disabled="true"
                        >
                          <span>暂无可用模型</span>
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              </label>

              {selectedModel?.capabilities.thinkingLevels.length ? (
                <div className={styles.llmSettingsControl}>
                  <span className={styles.llmSettingsControlTitle}>
                    思考等级
                  </span>
                  <div
                    className={styles.llmEndpointTabs}
                    role="tablist"
                    style={{
                      gridTemplateColumns: `repeat(${selectedModel.capabilities.thinkingLevels.length}, minmax(0, 1fr))`,
                    }}
                  >
                    {selectedModel.capabilities.thinkingLevels.map((level) => (
                      <button
                        key={level}
                        type="button"
                        role="tab"
                        aria-selected={draft.thinkingLevel === level}
                        className={`${styles.llmEndpointTab} ${
                          draft.thinkingLevel === level
                            ? styles.llmEndpointTabActive
                            : ""
                        }`}
                        onClick={() => updateDraft({ thinkingLevel: level })}
                      >
                        {THINKING_LEVEL_LABELS[level]}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <ServiceField
                title="Base URL"
                value={draft.baseUrl}
                placeholder={selectedModel?.defaultBaseUrl ?? ""}
                onChange={(baseUrl) => updateDraft({ baseUrl })}
              />
              <ServiceField
                title="ApiKey"
                value={draft.apiKey}
                placeholder={
                  selectedModel
                    ? LLM_API_KEY_PLACEHOLDERS[selectedModel.provider]
                    : "输入 API Key"
                }
                onChange={(apiKey) => updateDraft({ apiKey })}
              />
            </div>
          </section>

          <button
            type="button"
            className={`${styles.llmTestButton} ${
              status === "success" ? styles.llmTestButtonSuccess : ""
            } ${status === "error" ? styles.llmTestButtonError : ""}`}
            disabled={isTesting}
            onClick={() => {
              void onTestConnection();
            }}
          >
            {isTesting ? (
              <LoaderCircle aria-hidden="true" />
            ) : status === "success" ? (
              <Check aria-hidden="true" />
            ) : status === "error" ? (
              <X aria-hidden="true" />
            ) : null}
            <span>
              {isTesting
                ? "正在测试连接"
                : status === "success"
                  ? "Succeed"
                  : status === "error"
                    ? feedback?.code === "CLIENT_VALIDATION" ||
                      feedback?.code === "UNSUPPORTED"
                      ? (feedback.summary ?? "配置错误")
                      : "Failed"
                    : "测试连接状态"}
            </span>
          </button>

          {status === "error" && feedback ? (
            <div className={styles.llmErrorDetails} role="alert">
              <div className={styles.llmErrorDetailsHeader}>
                <span>错误</span>
                {feedback.code ? <code>{feedback.code}</code> : null}
              </div>
              {feedback.detail ? (
                <p className={styles.llmErrorDetailText}>{feedback.detail}</p>
              ) : null}
              {feedback.technicalDetail ? (
                <div className={styles.llmErrorTechnicalCard}>
                  {feedback.technicalDetail}
                </div>
              ) : null}
              {feedback.meta.length ? (
                <dl className={styles.llmErrorMeta}>
                  {feedback.meta.map((item) => (
                    <div key={`${item.label}:${item.value}`}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <SettingsFooter
        dirty={dirty}
        isSaving={isSaving}
        isChecking={isTesting}
        onSave={onSave}
      />
    </>
  );
}

function ServiceDetail({
  draft,
  dirty,
  status,
  feedback,
  isSaving,
  embeddingIndex,
  embeddingRestartRequired = false,
  onDraftChange,
  onTestConnection,
  onSave,
}: {
  draft: ServiceDraft;
  dirty: boolean;
  status: CheckStatus;
  feedback: DashboardCheckFeedback | null;
  isSaving: boolean;
  embeddingIndex?: GlobalEmbeddingIndexStatus;
  embeddingRestartRequired?: boolean;
  onDraftChange: (draft: ServiceDraft) => void;
  onTestConnection: () => void | Promise<unknown>;
  onSave: () => void | Promise<void>;
}) {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const embeddingProvider: EmbeddingProvider =
    draft.provider === "openai" ? "openai" : "google";
  const activeFields = draft[draft.provider];
  const models = EMBEDDING_MODELS[embeddingProvider];
  const isTesting = status === "testing";
  const indexCard = embeddingIndex
    ? indexStatusCard(embeddingIndex, embeddingRestartRequired, dirty)
    : null;

  function updateDraft(patch: Partial<ServiceDraft>) {
    onDraftChange({ ...draft, ...patch });
  }

  function updateProviderFields(
    provider: EmbeddingProvider,
    patch: Partial<ServiceProviderFields>,
  ) {
    onDraftChange({
      ...draft,
      [provider]: {
        ...draft[provider],
        ...patch,
      },
    });
  }

  function updateActiveFields(patch: Partial<ServiceProviderFields>) {
    updateProviderFields(draft.provider, patch);
  }

  function switchProvider(provider: EmbeddingProvider) {
    setModelDropdownOpen(false);
    updateDraft({ provider });
  }

  return (
    <>
      <div className={styles.llmSettingsBody}>
        <div className={styles.llmSettingsContent}>
          {indexCard ? (
            <div
              className={`${styles.settingsInfoCard} ${
                indexCard.tone === "warning"
                  ? styles.settingsInfoCardWarning
                  : indexCard.tone === "error"
                    ? styles.settingsInfoCardError
                    : ""
              }`}
              role={indexCard.tone === "error" ? "alert" : "note"}
            >
              <Info aria-hidden="true" />
              <span>
                <strong>{indexCard.title}</strong>
                <small>{indexCard.detail}</small>
              </span>
            </div>
          ) : null}

          <section className={styles.llmSettingsSection}>
            <div className={styles.llmSettingsControl}>
              <span className={styles.llmSettingsControlTitle}>服务提供商</span>
              <div
                className={`${styles.llmProviderTabs} ${styles.llmProviderTabsCompact}`}
                role="tablist"
              >
                {(["google", "openai"] as const).map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    role="tab"
                    aria-selected={draft.provider === provider}
                    className={`${styles.llmProviderTab} ${
                      draft.provider === provider
                        ? styles.llmProviderTabActive
                        : ""
                    }`}
                    onClick={() => switchProvider(provider)}
                  >
                    {EMBEDDING_PROVIDER_LABELS[provider]}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.llmSettingsFields}>
              <label className={styles.llmSettingsField}>
                <span className={styles.llmSettingsControlTitle}>模型</span>
                <div
                  className={styles.llmModelSelect}
                  onBlur={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (
                      nextTarget instanceof Node &&
                      event.currentTarget.contains(nextTarget)
                    ) {
                      return;
                    }
                    setModelDropdownOpen(false);
                  }}
                >
                  <button
                    type="button"
                    className={`${styles.llmModelSelectButton} ${
                      !activeFields.model
                        ? styles.llmModelSelectPlaceholder
                        : ""
                    } ${
                      modelDropdownOpen ? styles.llmModelSelectButtonOpen : ""
                    }`}
                    aria-haspopup="listbox"
                    aria-expanded={modelDropdownOpen}
                    onClick={() => setModelDropdownOpen((current) => !current)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setModelDropdownOpen(false);
                        event.currentTarget.blur();
                      }
                    }}
                  >
                    <span>{activeFields.model || "选择模型"}</span>
                    <ChevronDown aria-hidden="true" />
                  </button>
                  {modelDropdownOpen ? (
                    <div
                      className={styles.llmModelSelectMenu}
                      role="listbox"
                      aria-label="选择模型"
                    >
                      {models.map((model) => (
                        <button
                          key={model}
                          type="button"
                          role="option"
                          aria-selected={activeFields.model === model}
                          className={`${styles.llmModelSelectOption} ${
                            activeFields.model === model
                              ? styles.llmModelSelectOptionActive
                              : ""
                          }`}
                          onClick={() => {
                            updateActiveFields({ model });
                            setModelDropdownOpen(false);
                          }}
                        >
                          <span>{model}</span>
                          {activeFields.model === model ? (
                            <Check aria-hidden="true" />
                          ) : null}
                        </button>
                      ))}
                      <span
                        className={`${styles.llmModelSelectOption} ${styles.llmModelSelectOptionDisabled}`}
                        role="option"
                        aria-selected="false"
                        aria-disabled="true"
                      >
                        <span>更多模型敬请期待</span>
                      </span>
                    </div>
                  ) : null}
                </div>
              </label>

              <ServiceField
                title="Base URL"
                value={activeFields.baseUrl}
                placeholder={
                  draft.provider === "google"
                    ? "https://generativelanguage.googleapis.com"
                    : "https://api.openai.com/v1"
                }
                onChange={(baseUrl) => updateActiveFields({ baseUrl })}
              />
              <ServiceField
                title="ApiKey"
                value={activeFields.apiKey}
                placeholder={EMBEDDING_API_KEY_PLACEHOLDERS[draft.provider]}
                onChange={(apiKey) => updateActiveFields({ apiKey })}
              />
            </div>
          </section>

          <button
            type="button"
            className={`${styles.llmTestButton} ${
              status === "success" ? styles.llmTestButtonSuccess : ""
            } ${status === "error" ? styles.llmTestButtonError : ""}`}
            disabled={isTesting}
            onClick={() => {
              void onTestConnection();
            }}
          >
            {isTesting ? (
              <LoaderCircle aria-hidden="true" />
            ) : status === "success" ? (
              <Check aria-hidden="true" />
            ) : status === "error" ? (
              <X aria-hidden="true" />
            ) : null}
            <span>
              {isTesting
                ? "正在测试连接"
                : status === "success"
                  ? "Succeed"
                  : status === "error"
                    ? feedback?.code === "CLIENT_VALIDATION" ||
                      feedback?.code === "UNSUPPORTED"
                      ? (feedback.summary ?? "配置错误")
                      : "Failed"
                    : "测试连接状态"}
            </span>
          </button>

          {status === "error" && feedback ? (
            <div className={styles.llmErrorDetails} role="alert">
              <div className={styles.llmErrorDetailsHeader}>
                <span>错误</span>
                {feedback.code ? <code>{feedback.code}</code> : null}
              </div>
              {feedback.detail ? (
                <p className={styles.llmErrorDetailText}>{feedback.detail}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <SettingsFooter
        dirty={dirty}
        isSaving={isSaving}
        isChecking={isTesting}
        onSave={onSave}
      />
    </>
  );
}

function ServiceField({
  title,
  value,
  placeholder,
  hint,
  multiline = false,
  rows = 4,
  onChange,
}: {
  title: string;
  value: string;
  placeholder: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  onChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <label className={styles.llmSettingsField}>
      <span className={styles.llmSettingsControlTitle}>{title}</span>
      {multiline ? (
        <div className={styles.scrollableTextareaShell}>
          <textarea
            ref={textareaRef}
            value={value}
            rows={rows}
            autoComplete="off"
            onChange={(event) => onChange(event.currentTarget.value)}
          />
          {!value ? (
            <pre
              className={styles.scrollableTextareaPlaceholder}
              aria-hidden="true"
              onMouseDown={() => {
                window.requestAnimationFrame(() =>
                  textareaRef.current?.focus(),
                );
              }}
            >
              {placeholder}
            </pre>
          ) : null}
        </div>
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
      {hint ? <span className={styles.settingsFieldHint}>{hint}</span> : null}
    </label>
  );
}

function SettingsFooter({
  dirty,
  isSaving,
  isChecking = false,
  disabled = false,
  onSave,
}: {
  dirty: boolean;
  isSaving: boolean;
  isChecking?: boolean;
  disabled?: boolean;
  onSave: () => void | Promise<void>;
}) {
  return (
    <div className={styles.llmSettingsFooter}>
      <div className={styles.llmSettingsFooterInner}>
        <button
          type="button"
          className={`${styles.llmSaveButton} ${
            isSaving ? styles.llmSaveButtonSaving : ""
          }`}
          disabled={!dirty || isChecking || disabled || isSaving}
          onClick={() => {
            void onSave();
          }}
        >
          {isSaving ? <LoaderCircle aria-hidden="true" /> : null}
          <span>{isSaving ? "保存中" : "保存"}</span>
        </button>
      </div>
    </div>
  );
}

function UnsavedDialog({
  title,
  onCancel,
  onDiscard,
}: {
  title: DetailTitle;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className={styles.llmUnsavedOverlay} role="alertdialog">
      <div className={styles.llmUnsavedDialog}>
        <h4>放弃未保存的修改？</h4>
        <p>当前{title}还没有保存，退出后本次修改会被丢弃。</p>
        <div className={styles.llmUnsavedActions}>
          <button type="button" onClick={onCancel}>
            继续编辑
          </button>
          <button
            type="button"
            className={styles.llmUnsavedDangerButton}
            onClick={onDiscard}
          >
            仍要退出
          </button>
        </div>
      </div>
    </div>
  );
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
