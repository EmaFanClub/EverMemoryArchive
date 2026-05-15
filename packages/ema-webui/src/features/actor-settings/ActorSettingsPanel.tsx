"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent as ReactChangeEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  Bot,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Globe,
  GraduationCap,
  Info,
  Link as LinkIcon,
  LoaderCircle,
  MessageCircle,
  MessageCircleMore,
  MessageSquareMore,
  MessageSquareOff,
  Moon,
  Pencil,
  Plus,
  PowerOff,
  Search,
  Send,
  Smile,
  SquareArrowOutUpRight,
  Terminal,
  Trash2,
  Unlink,
  User,
  Users,
  X,
} from "lucide-react";

import styles from "@/app/dashboard/page.module.css";
import {
  clearActorTraining,
  createActorQqConversation,
  deleteActor,
  deleteActorQqConversation,
  getActorConversation,
  getActorSettings,
  patchActorConversation,
  patchActorQqConversation,
  runActorLlmCheck,
  saveActorConversation,
  saveActorLlmConfig,
  saveActorQqConfig,
  saveActorWebSearchConfig,
  syncActorQqConnectionStatus,
  startActorTraining,
  updateActorQqEnabled,
  updateActorActivity,
} from "@/transport/dashboard";
import { subscribeEmaEvents } from "@/transport/events";
import {
  actorLlmCheckFeedbackFromResponse,
  dashboardTransportFailureFeedback,
  localDashboardFeedback,
  type DashboardCheckFeedback,
} from "@/types/dashboard/feedback";
import type {
  ActorLlmConfig,
  ActorConversationInfo,
  ActorQQBlockedBy,
  ActorQQConfig,
  ActorQQConnectionSyncReason,
  ActorQQTransportStatus,
  ActorQQConversation,
  ActorRuntimeStatus,
  ActorRuntimeTransition,
  ActorSettingsSnapshot,
  ActorSummary,
  ActorTrainingUiState,
  ActorWebSearchConfig,
  LlmModelOption,
  LlmModelProvider,
  LlmThinkingLevel,
} from "@/types/dashboard/v1beta1";

type ActorSettingsMenuIcon =
  | "llm"
  | "conversation"
  | "search"
  | "sticker"
  | "qq"
  | "wechat"
  | "telegram"
  | "delete";
type LlmConnectionStatus = "idle" | "testing" | "success" | "error";
type LlmSettingsFieldId = "apiKey" | "model" | "baseUrl" | "thinkingLevel";
type QqConversationType = "chat" | "group";
type QqSettingsFieldId = "wsUrl" | "accessToken";
type QqConversationFieldId = "uid" | "name";
interface SettingsToastState {
  id: number;
  message: string;
  kind: "success" | "error";
}

interface LlmSettingsDraft {
  useGlobal: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  thinkingLevel?: LlmThinkingLevel;
}

interface WebSearchSettingsDraft {
  enabled: boolean;
  tavilyApiKey: string;
}

interface QqConversationDraft {
  id: string;
  type: QqConversationType;
  uid: string;
  name: string;
  description: string;
  allowProactive: boolean;
}

interface QqSettingsDraft {
  enabled: boolean;
  wsUrl: string;
  accessToken: string;
  conversations: QqConversationDraft[];
}

interface ConversationSettingsDraft {
  id: string;
  session: string;
  name: string;
  description: string;
  allowProactive: boolean;
}

interface QqConversationEditorState {
  mode: "create" | "edit";
  draft: QqConversationDraft;
  original?: QqConversationDraft;
  validation: ReturnType<typeof validateQqConversationDraft>;
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
const MESSAGE_SCROLLBAR_IDLE_DELAY = 3000;
const MESSAGE_SCROLLBAR_MIN_THUMB_HEIGHT = 32;
const COPY_TOAST_DURATION = 1400;
const DEFAULT_WEB_CHAT_SESSION = "web-chat-1";

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
const LLM_CREDENTIAL_LIMIT = 16_384;
const DEFAULT_LLM_SETTINGS: LlmSettingsDraft = {
  useGlobal: true,
  apiKey: "",
  baseUrl: "",
  model: "",
};
const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettingsDraft = {
  enabled: false,
  tavilyApiKey: "",
};
const DEFAULT_QQ_SETTINGS: QqSettingsDraft = {
  enabled: false,
  wsUrl: "",
  accessToken: "",
  conversations: [],
};
const DEFAULT_CONVERSATION_SETTINGS: ConversationSettingsDraft = {
  id: "",
  session: DEFAULT_WEB_CHAT_SESSION,
  name: "",
  description: "",
  allowProactive: true,
};

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
  current: LlmSettingsDraft,
): LlmSettingsDraft {
  return {
    useGlobal: false,
    model: option.model,
    baseUrl: option.defaultBaseUrl,
    apiKey: current.apiKey,
    thinkingLevel: normalizeThinkingLevel(option, current.thinkingLevel),
  };
}

function defaultCustomLlmDraft(
  globalLlmConfig: ActorLlmConfig | null,
  models: LlmModelOption[],
): LlmSettingsDraft {
  if (globalLlmConfig) {
    return llmDraftFromConfig(globalLlmConfig, models, false);
  }
  const option = models[0] ?? null;
  return option
    ? llmDraftForModel(option, DEFAULT_LLM_SETTINGS)
    : {
        ...DEFAULT_LLM_SETTINGS,
        useGlobal: false,
      };
}

function llmDraftFromConfig(
  config: ActorLlmConfig | undefined,
  models: LlmModelOption[],
  useGlobal = !config,
): LlmSettingsDraft {
  if (!config) {
    return DEFAULT_LLM_SETTINGS;
  }
  const option =
    models.find((candidate) => candidate.model === config.model) ?? null;
  return {
    useGlobal,
    model: config.model,
    baseUrl: config.baseUrl || option?.defaultBaseUrl || "",
    apiKey: config.apiKey,
    thinkingLevel: option
      ? normalizeThinkingLevel(option, config.thinkingLevel)
      : config.thinkingLevel,
  };
}

function webSearchDraftFromConfig(
  config?: ActorWebSearchConfig,
): WebSearchSettingsDraft {
  return config
    ? {
        enabled: config.enabled,
        tavilyApiKey: config.tavilyApiKey,
      }
    : DEFAULT_WEB_SEARCH_SETTINGS;
}

function qqDraftFromConfig(config?: ActorQQConfig): QqSettingsDraft {
  return config
    ? {
        enabled: config.enabled,
        wsUrl: config.wsUrl,
        accessToken: config.accessToken,
        conversations: config.conversations.map((conversation) => ({
          ...conversation,
        })),
      }
    : DEFAULT_QQ_SETTINGS;
}

function conversationDraftFromInfo(
  conversation?: ActorConversationInfo,
): ConversationSettingsDraft {
  return conversation
    ? {
        id: conversation.id,
        session: conversation.session,
        name: conversation.name,
        description: conversation.description,
        allowProactive: conversation.allowProactive,
      }
    : DEFAULT_CONVERSATION_SETTINGS;
}

const activityStatusDescription: Record<ActorRuntimeStatus, string> = {
  offline: "角色未加载，不参与活动",
  sleep: "角色已加载，当前处于睡眠",
  online: "角色已唤醒，当前在线",
  busy: "角色已唤醒，当前忙碌",
};
const activityTransitionDescription: Record<
  Exclude<ActorRuntimeTransition, null>,
  string
> = {
  booting: "角色正在启动",
  shutting_down: "角色正在关闭",
  waking: "角色正在唤醒",
  sleeping: "角色正在入睡",
};
const activityTransitionLabel: Record<
  Exclude<ActorRuntimeTransition, null>,
  string
> = {
  booting: "启动中",
  shutting_down: "关闭中",
  waking: "唤醒中",
  sleeping: "入睡中",
};

function actorAvatarText(name: string) {
  const actorMatch = /^actor\s*(\d+)$/i.exec(name.trim());
  if (actorMatch?.[1]) {
    return `A${actorMatch[1]}`;
  }

  return Array.from(name.trim()).slice(0, 2).join("").toUpperCase() || "A";
}

function formatTrainingPercent(progress: number) {
  return `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
}

function formatTrainingRemaining(ms: number) {
  if (ms <= 0) {
    return "即将完成";
  }
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds} 秒`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours} 小时 ${remainingMinutes} 分`;
  }
  return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
}

function areLlmSettingsEqual(left: LlmSettingsDraft, right: LlmSettingsDraft) {
  return (
    left.useGlobal === right.useGlobal &&
    left.apiKey === right.apiKey &&
    left.baseUrl === right.baseUrl &&
    left.model === right.model &&
    left.thinkingLevel === right.thinkingLevel
  );
}

function areWebSearchSettingsEqual(
  left: WebSearchSettingsDraft,
  right: WebSearchSettingsDraft,
) {
  return (
    left.enabled === right.enabled && left.tavilyApiKey === right.tavilyApiKey
  );
}

function areQqConnectionSettingsEqual(
  left: QqSettingsDraft,
  right: QqSettingsDraft,
) {
  return left.wsUrl === right.wsUrl && left.accessToken === right.accessToken;
}

function areQqConversationsEqual(
  left: QqConversationDraft,
  right: QqConversationDraft,
) {
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.uid === right.uid &&
    left.name === right.name &&
    left.description === right.description &&
    left.allowProactive === right.allowProactive
  );
}

function areConversationSettingsEqual(
  left: ConversationSettingsDraft,
  right: ConversationSettingsDraft,
) {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.allowProactive === right.allowProactive
  );
}

function validateConversationDraftBeforeSave(draft: ConversationSettingsDraft) {
  if (!draft.name.trim()) {
    return {
      summary: "会话名称不能为空",
      fields: ["name"] as const,
    };
  }
  return null;
}

function formatSecretStatus(value: string) {
  return value.trim() ? "已配置" : "未配置";
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function buildGlobalLlmSummaryRows(
  config: ActorLlmConfig | null,
  models: LlmModelOption[],
) {
  if (!config) {
    return [["状态", "正在读取"]] as const;
  }

  const option = models.find((candidate) => candidate.model === config.model);
  const rows: Array<readonly [string, string]> = [];
  if (option) {
    rows.push(["服务提供商", LLM_PROVIDER_LABELS[option.provider]]);
  }
  rows.push(["模型", config.model]);
  rows.push(["接口地址", config.baseUrl]);
  rows.push(["ApiKey", formatSecretStatus(config.apiKey)]);
  if (config.thinkingLevel) {
    rows.push(["思考等级", THINKING_LEVEL_LABELS[config.thinkingLevel]]);
  }
  return rows;
}

function buildLlmSettingsSignature(settings: LlmSettingsDraft) {
  return JSON.stringify({
    useGlobal: settings.useGlobal,
    apiKey: settings.useGlobal ? "" : settings.apiKey.trim(),
    baseUrl: settings.useGlobal ? "" : settings.baseUrl.trim(),
    model: settings.useGlobal ? "" : settings.model.trim(),
    thinkingLevel: settings.useGlobal ? "" : (settings.thinkingLevel ?? ""),
  });
}

function isHttpUrlValue(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateLlmDraftBeforeRequest(
  settings: LlmSettingsDraft,
  globalLlmConfig?: ActorLlmConfig | null,
  models: LlmModelOption[] = [],
) {
  if (settings.useGlobal) {
    return globalLlmConfig
      ? null
      : {
          summary: "全局配置未加载",
          detail: "请等待当前全局配置读取完成后再试。",
          fields: [] satisfies LlmSettingsFieldId[],
        };
  }

  const missingFields = [
    !settings.apiKey.trim() ? "ApiKey" : null,
    !settings.model.trim() ? "模型" : null,
    !settings.baseUrl.trim() ? "接口地址" : null,
  ].filter((field): field is string => Boolean(field));

  if (missingFields.length > 0) {
    return {
      summary: `${missingFields.join("、")}未填写`,
      detail: `${missingFields.join("、")}都是必填项。`,
      fields: [
        !settings.apiKey.trim() ? "apiKey" : null,
        !settings.model.trim() ? "model" : null,
        !settings.baseUrl.trim() ? "baseUrl" : null,
      ].filter((field): field is LlmSettingsFieldId => Boolean(field)),
    };
  }

  if (settings.model.trim().length > 128) {
    return {
      summary: "模型名称过长",
      detail: "模型名称不能超过 128 个字符。",
      fields: ["model"] satisfies LlmSettingsFieldId[],
    };
  }

  const option = models.find(
    (candidate) => candidate.model === settings.model.trim(),
  );
  if (!option) {
    return {
      summary: "模型暂不支持",
      detail: "请从模型列表中选择一个支持的模型。",
      fields: ["model"] satisfies LlmSettingsFieldId[],
    };
  }

  if (
    settings.baseUrl.trim().length > 512 ||
    !isHttpUrlValue(settings.baseUrl.trim())
  ) {
    return {
      summary: "接口地址格式错误",
      detail: "请填写以 http:// 或 https:// 开头的有效接口地址。",
      fields: ["baseUrl"] satisfies LlmSettingsFieldId[],
    };
  }

  if (settings.apiKey.trim().length > LLM_CREDENTIAL_LIMIT) {
    return {
      summary: "ApiKey过长",
      detail: `ApiKey 不能超过 ${LLM_CREDENTIAL_LIMIT} 个字符。`,
      fields: ["apiKey"] satisfies LlmSettingsFieldId[],
    };
  }

  if (
    settings.thinkingLevel &&
    !option.capabilities.thinkingLevels.includes(settings.thinkingLevel)
  ) {
    return {
      summary: "思考等级暂不支持",
      detail: "当前模型不支持所选思考等级。",
      fields: ["thinkingLevel"] satisfies LlmSettingsFieldId[],
    };
  }

  return null;
}

function buildActorLlmConfigFromDraft(
  settings: LlmSettingsDraft,
  globalLlmConfig?: ActorLlmConfig | null,
): ActorLlmConfig {
  if (settings.useGlobal) {
    return (
      globalLlmConfig ?? {
        model: "",
        baseUrl: "",
        apiKey: "",
      }
    );
  }

  return {
    model: settings.model.trim(),
    baseUrl: settings.baseUrl.trim(),
    apiKey: settings.apiKey.trim(),
    ...(settings.thinkingLevel
      ? { thinkingLevel: settings.thinkingLevel }
      : {}),
  };
}

function buildActorLlmSaveConfigFromDraft(
  settings: LlmSettingsDraft,
  globalLlmConfig?: ActorLlmConfig | null,
): ActorLlmConfig | null {
  if (settings.useGlobal) {
    return null;
  }

  return buildActorLlmConfigFromDraft(settings, globalLlmConfig);
}

function validateWebSearchDraftBeforeSave(settings: WebSearchSettingsDraft) {
  if (settings.enabled && !settings.tavilyApiKey.trim()) {
    return {
      summary: "Tavily ApiKey未填写",
      detail: "启用 Tavily 后需要填写 ApiKey。",
      fields: ["tavilyApiKey"] as const,
    };
  }

  return null;
}

function isWsUrlValue(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" || url.protocol === "wss:";
  } catch {
    return false;
  }
}

function validateQqDraftBeforeSave(settings: QqSettingsDraft) {
  const missingFields = [
    !settings.wsUrl.trim() ? "ws地址" : null,
    !settings.accessToken.trim() ? "token" : null,
  ].filter((field): field is string => Boolean(field));

  if (missingFields.length > 0) {
    return {
      summary: `${missingFields.join("、")}未填写`,
      detail: "保存 NapCatQQ 连接配置需要填写 ws 地址和 token。",
      fields: [
        !settings.wsUrl.trim() ? "wsUrl" : null,
        !settings.accessToken.trim() ? "accessToken" : null,
      ].filter((field): field is QqSettingsFieldId => Boolean(field)),
    };
  }

  if (!isWsUrlValue(settings.wsUrl.trim())) {
    return {
      summary: "ws地址格式错误",
      detail: "请填写以 ws:// 或 wss:// 开头的有效 WebSocket 地址。",
      fields: ["wsUrl"] satisfies QqSettingsFieldId[],
    };
  }

  return null;
}

function validateQqConversationDraft(conversation: QqConversationDraft) {
  const missingFields = [
    !conversation.uid.trim()
      ? conversation.type === "group"
        ? "群号"
        : "QQ号"
      : null,
    !conversation.name.trim() ? "名称" : null,
  ].filter((field): field is string => Boolean(field));

  if (missingFields.length > 0) {
    return {
      summary: `${missingFields.join("、")}未填写`,
      detail: "会话标识和名称用于创建稳定的频道会话。",
      fields: [
        !conversation.uid.trim() ? "uid" : null,
        !conversation.name.trim() ? "name" : null,
      ].filter((field): field is QqConversationFieldId => Boolean(field)),
    };
  }

  if (!/^\d+$/.test(conversation.uid.trim())) {
    return {
      summary: conversation.type === "group" ? "群号格式错误" : "QQ号格式错误",
      detail: "请只填写数字。",
      fields: ["uid"] satisfies QqConversationFieldId[],
    };
  }

  return null;
}

function buildActorWebSearchConfigFromDraft(
  settings: WebSearchSettingsDraft,
): ActorWebSearchConfig {
  return {
    enabled: settings.enabled,
    tavilyApiKey: settings.tavilyApiKey.trim(),
  };
}

function buildActorQqConfigFromDraft(settings: QqSettingsDraft): ActorQQConfig {
  const conversations: ActorQQConversation[] = settings.conversations.map(
    (conversation) => ({
      id: conversation.id,
      type: conversation.type,
      uid: conversation.uid.trim(),
      name: conversation.name.trim(),
      description: conversation.description.trim(),
      allowProactive: conversation.allowProactive,
    }),
  );

  return {
    enabled: settings.enabled,
    wsUrl: settings.wsUrl.trim(),
    accessToken: settings.accessToken.trim(),
    conversations,
  };
}

function buildActorQqConversationFromDraft(
  conversation: QqConversationDraft,
): Omit<ActorQQConversation, "id"> {
  return {
    type: conversation.type,
    uid: conversation.uid.trim(),
    name: conversation.name.trim(),
    description: conversation.description.trim(),
    allowProactive: conversation.allowProactive,
  };
}

function createEmptyQqConversationDraft(type: QqConversationType = "chat") {
  return {
    id: createStableClientId("qq-conversation"),
    type,
    uid: "",
    name: "",
    description: "",
    allowProactive: false,
  } satisfies QqConversationDraft;
}

function createStableClientId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatQqConversationType(type: QqConversationType) {
  return type === "group" ? "群聊" : "私聊";
}

function formatQqSessionId(
  conversation: Pick<QqConversationDraft, "type" | "uid">,
) {
  return `qq-${conversation.type}-${conversation.uid.trim() || "未填写"}`;
}

export function ActorSettingsPanel({
  actor,
  showStartupTip = false,
  onStartupTipDismiss,
  onActorRuntimeChange,
  onActorTrainingChange,
  onActorDeleted,
}: {
  actor: ActorSummary;
  showStartupTip?: boolean;
  onStartupTipDismiss?: () => void;
  onActorRuntimeChange: (
    actorId: string,
    status: ActorRuntimeStatus,
    transition: ActorRuntimeTransition,
  ) => void;
  onActorTrainingChange: (
    actorId: string,
    training: ActorTrainingUiState | null,
  ) => void;
  onActorDeleted: (actorId: string) => void;
}) {
  const actorId = actor.id;
  const actorName = actor.name;
  const [activityStatus, setActivityStatus] = useState<ActorRuntimeStatus>(
    actor.status,
  );
  const [activityTransition, setActivityTransition] =
    useState<ActorRuntimeTransition>(actor.transition);
  const [activitySwitching, setActivitySwitching] = useState(false);
  const [activityDisableDialogVisible, setActivityDisableDialogVisible] =
    useState(false);
  const [actorDeleteDialogVisible, setActorDeleteDialogVisible] =
    useState(false);
  const [actorDeleteConfirmationName, setActorDeleteConfirmationName] =
    useState("");
  const [actorDeleting, setActorDeleting] = useState(false);
  const [trainingDetailVisible, setTrainingDetailVisible] = useState(false);
  const [trainingStarting, setTrainingStarting] = useState(false);
  const [detailTitle, setDetailTitle] = useState<string | null>(null);
  const [detailClosing, setDetailClosing] = useState(false);
  const [loadedSettings, setLoadedSettings] = useState<{
    actorId: string;
    settings: ActorSettingsSnapshot;
  } | null>(() =>
    actor.settings
      ? {
          actorId: actor.id,
          settings: actor.settings,
        }
      : null,
  );
  const [globalLlmConfig, setGlobalLlmConfig] = useState<ActorLlmConfig | null>(
    null,
  );
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const actorSettings =
    loadedSettings?.actorId === actorId
      ? loadedSettings.settings
      : actor.settings;
  const [savedLlmSettings, setSavedLlmSettings] = useState<LlmSettingsDraft>(
    () => llmDraftFromConfig(actor.settings?.llm, []),
  );
  const [llmDraft, setLlmDraft] = useState<LlmSettingsDraft>(() =>
    llmDraftFromConfig(actor.settings?.llm, []),
  );
  const [llmConnectionStatus, setLlmConnectionStatus] =
    useState<LlmConnectionStatus>("idle");
  const [llmConnectionFeedback, setLlmConnectionFeedback] =
    useState<DashboardCheckFeedback | null>(null);
  const [llmIsSaving, setLlmIsSaving] = useState(false);
  const [llmLastPassedSignature, setLlmLastPassedSignature] = useState<
    string | null
  >(null);
  const [llmUnsavedDialogVisible, setLlmUnsavedDialogVisible] = useState(false);
  const [savedWebSearchSettings, setSavedWebSearchSettings] =
    useState<WebSearchSettingsDraft>(() =>
      webSearchDraftFromConfig(actor.settings?.webSearch),
    );
  const [webSearchDraft, setWebSearchDraft] = useState<WebSearchSettingsDraft>(
    () => webSearchDraftFromConfig(actor.settings?.webSearch),
  );
  const [webSearchValidationFeedback, setWebSearchValidationFeedback] =
    useState<ReturnType<typeof validateWebSearchDraftBeforeSave>>(null);
  const [webSearchIsSaving, setWebSearchIsSaving] = useState(false);
  const [webSearchUnsavedDialogVisible, setWebSearchUnsavedDialogVisible] =
    useState(false);
  const [savedQqSettings, setSavedQqSettings] = useState<QqSettingsDraft>(() =>
    qqDraftFromConfig(actor.settings?.qq),
  );
  const [qqDraft, setQqDraft] = useState<QqSettingsDraft>(() =>
    qqDraftFromConfig(actor.settings?.qq),
  );
  const [qqValidationFeedback, setQqValidationFeedback] =
    useState<ReturnType<typeof validateQqDraftBeforeSave>>(null);
  const [qqIsSaving, setQqIsSaving] = useState(false);
  const [qqIsSwitching, setQqIsSwitching] = useState(false);
  const [qqTransportStatus, setQqTransportStatus] =
    useState<ActorQQTransportStatus>("disconnected");
  const [qqUnsavedDialogVisible, setQqUnsavedDialogVisible] = useState(false);
  const [savedConversationSettings, setSavedConversationSettings] =
    useState<ConversationSettingsDraft>(DEFAULT_CONVERSATION_SETTINGS);
  const [conversationDraft, setConversationDraft] =
    useState<ConversationSettingsDraft>(DEFAULT_CONVERSATION_SETTINGS);
  const [conversationValidationFeedback, setConversationValidationFeedback] =
    useState<ReturnType<typeof validateConversationDraftBeforeSave>>(null);
  const [conversationIsSaving, setConversationIsSaving] = useState(false);
  const [conversationIsSwitching, setConversationIsSwitching] = useState(false);
  const [
    conversationUnsavedDialogVisible,
    setConversationUnsavedDialogVisible,
  ] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const llmTestRunRef = useRef(0);
  const llmSaveRunRef = useRef(0);
  const webSearchSaveRunRef = useRef(0);
  const qqSaveRunRef = useRef(0);
  const qqSwitchRunRef = useRef(0);
  const conversationSaveRunRef = useRef(0);
  const conversationSwitchRunRef = useRef(0);
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const settingsScrollbarVisibleRef = useRef(false);
  const settingsScrollbarIdleTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [settingsScrollbarVisible, setSettingsScrollbarVisible] =
    useState(false);
  const [settingsScrollbarMetrics, setSettingsScrollbarMetrics] = useState({
    canScroll: false,
    thumbHeight: 0,
    thumbTop: 0,
  });
  const [settingsToast, setSettingsToast] = useState<SettingsToastState | null>(
    null,
  );
  const settingsToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const menuSections: Array<{
    title: string;
    items: Array<{
      label: string;
      description?: string;
      icon: ActorSettingsMenuIcon;
      danger?: boolean;
      type: "menu" | "button";
    }>;
  }> = [
    {
      title: "服务",
      items: [
        {
          label: "LLM",
          description: "选择LLM服务提供商并配置ApiKey",
          icon: "llm",
          type: "menu",
        },
        {
          label: "搜索",
          description: "选择搜索服务提供商并配置ApiKey",
          icon: "search",
          type: "menu",
        },
      ],
    },
    {
      title: "功能",
      items: [
        {
          label: "表情包",
          description: "管理角色使用的表情包",
          icon: "sticker",
          type: "menu",
        },
      ],
    },
    {
      title: "频道",
      items: [
        {
          label: "QQ",
          description: "将角色接入到QQ平台",
          icon: "qq",
          type: "menu",
        },
        {
          label: "微信",
          description: "将角色接入到微信平台",
          icon: "wechat",
          type: "menu",
        },
        {
          label: "Telegram",
          description: "将角色接入到Telegram平台",
          icon: "telegram",
          type: "menu",
        },
      ],
    },
    {
      title: "管理",
      items: [
        {
          label: "删除角色",
          icon: "delete",
          danger: true,
          type: "button",
        },
      ],
    },
  ];
  const llmSettingsDirty = !areLlmSettingsEqual(llmDraft, savedLlmSettings);
  const webSearchSettingsDirty = !areWebSearchSettingsEqual(
    webSearchDraft,
    savedWebSearchSettings,
  );
  const qqSettingsDirty = !areQqConnectionSettingsEqual(
    qqDraft,
    savedQqSettings,
  );
  const conversationSettingsDirty = !areConversationSettingsEqual(
    conversationDraft,
    savedConversationSettings,
  );
  const training = actor.training;
  const trainingPending = training?.status === "pending";
  const trainingRunning = training?.status === "running";
  const settingsLocked = trainingRunning;
  const activityTransitioning =
    activitySwitching || activityTransition !== null;
  const actorDeleteConfirmed =
    actorDeleteConfirmationName.trim() === actorName.trim();
  const actorDeleteMenuDisabled =
    actorDeleting || trainingRunning || activityTransitioning;
  const actorDeleteConfirmDisabled =
    actorDeleteMenuDisabled || !actorDeleteConfirmed;
  const activityActionDisabled =
    activityTransitioning || trainingPending || trainingRunning;
  const activityEnabled =
    activityStatus !== "offline" ||
    activityTransition === "booting" ||
    activityTransition === "shutting_down";
  const activityDescription =
    trainingPending || trainingRunning
      ? "学习完成后即可启动"
      : activityTransition
        ? activityTransitionDescription[activityTransition]
        : activityStatusDescription[activityStatus];
  const activityButtonLabel = activityTransition
    ? activityTransitionLabel[activityTransition]
    : activityStatus === "offline"
      ? "启动"
      : "停用";
  const detailHeading =
    detailTitle === "当前会话信息" ? detailTitle : `${detailTitle} 设置`;

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
      }

      if (settingsScrollbarIdleTimerRef.current !== null) {
        clearTimeout(settingsScrollbarIdleTimerRef.current);
      }

      if (settingsToastTimerRef.current !== null) {
        clearTimeout(settingsToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activitySwitching) {
      return;
    }

    setActivityStatus(actor.status);
    setActivityTransition(actor.transition);
  }, [actor.status, actor.transition, activitySwitching]);

  useEffect(() => {
    let cancelled = false;
    setLoadedSettings(
      actor.settings
        ? {
            actorId,
            settings: actor.settings,
          }
        : null,
    );

    setSavedConversationSettings(DEFAULT_CONVERSATION_SETTINGS);
    setConversationDraft(DEFAULT_CONVERSATION_SETTINGS);

    Promise.all([
      getActorSettings(actorId),
      getActorConversation(actorId, DEFAULT_WEB_CHAT_SESSION),
    ])
      .then(([response, conversationResponse]) => {
        if (cancelled) {
          return;
        }
        setLoadedSettings({
          actorId: response.actorId,
          settings: response.settings,
        });
        setGlobalLlmConfig(response.global.llm);
        setLlmModels(response.global.llmModels);
        const nextConversation = conversationDraftFromInfo(
          conversationResponse.conversation,
        );
        setSavedConversationSettings(nextConversation);
        setConversationDraft(nextConversation);
      })
      .catch(() => {
        if (!cancelled) {
          showSettingsToast("设置加载失败", "error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actorId, actor.settings]);

  useEffect(() => {
    const nextLlmSettings = llmDraftFromConfig(actorSettings?.llm, llmModels);
    const nextWebSearchSettings = webSearchDraftFromConfig(
      actorSettings?.webSearch,
    );
    const nextQqSettings = qqDraftFromConfig(actorSettings?.qq);
    setSavedLlmSettings(nextLlmSettings);
    setLlmDraft(nextLlmSettings);
    setSavedWebSearchSettings(nextWebSearchSettings);
    setWebSearchDraft(nextWebSearchSettings);
    setSavedQqSettings(nextQqSettings);
    setQqDraft(nextQqSettings);
    setLlmConnectionStatus("idle");
    setLlmConnectionFeedback(null);
    setWebSearchValidationFeedback(null);
    setQqValidationFeedback(null);
    setQqIsSwitching(false);
    setConversationValidationFeedback(null);
    setConversationIsSaving(false);
    setConversationIsSwitching(false);
    setQqTransportStatus(
      deriveQqConnectionState(nextQqSettings).transportStatus,
    );
  }, [actor.id, actorSettings, llmModels]);

  const handleQqConnectionStateChange = useCallback(
    (state: { transportStatus: ActorQQTransportStatus }) => {
      setQqTransportStatus(state.transportStatus);
    },
    [],
  );

  function showSettingsToast(
    message: string,
    kind: SettingsToastState["kind"],
  ) {
    if (settingsToastTimerRef.current !== null) {
      clearTimeout(settingsToastTimerRef.current);
    }

    setSettingsToast((current) => ({
      id: (current?.id ?? 0) + 1,
      message,
      kind,
    }));
    settingsToastTimerRef.current = setTimeout(() => {
      setSettingsToast(null);
      settingsToastTimerRef.current = null;
    }, COPY_TOAST_DURATION);
  }

  async function toggleActorActivity() {
    if (activityActionDisabled) {
      return;
    }

    const previousStatus = activityStatus;
    const previousTransition = activityTransition;
    const shouldEnable = activityStatus === "offline";
    const optimisticTransition: ActorRuntimeTransition = shouldEnable
      ? "booting"
      : "shutting_down";

    setActivitySwitching(true);
    setActivityTransition(optimisticTransition);
    onActorRuntimeChange(actorId, previousStatus, optimisticTransition);

    try {
      const response = await updateActorActivity(actorId, shouldEnable);
      if (response.ok) {
        setActivityStatus(response.activity.status);
        setActivityTransition(response.activity.transition);
        onActorRuntimeChange(
          actorId,
          response.activity.status,
          response.activity.transition,
        );
        showSettingsToast(
          shouldEnable ? "角色已启用" : "角色已停用",
          "success",
        );
      } else {
        setActivityStatus(previousStatus);
        setActivityTransition(previousTransition);
        onActorRuntimeChange(actorId, previousStatus, previousTransition);
        showSettingsToast("切换失败", "error");
      }
    } catch {
      setActivityStatus(previousStatus);
      setActivityTransition(previousTransition);
      onActorRuntimeChange(actorId, previousStatus, previousTransition);
      showSettingsToast("切换失败", "error");
    } finally {
      setActivitySwitching(false);
      setActivityDisableDialogVisible(false);
    }
  }

  async function saveConversationSettings() {
    if (!conversationSettingsDirty || conversationIsSaving) {
      return;
    }

    const validationFeedback =
      validateConversationDraftBeforeSave(conversationDraft);
    if (validationFeedback) {
      setConversationValidationFeedback(validationFeedback);
      return;
    }

    const saveDraft = conversationDraft;
    const saveRunId = ++conversationSaveRunRef.current;
    setConversationIsSaving(true);
    setConversationValidationFeedback(null);

    try {
      const response = await saveActorConversation(
        actorId,
        DEFAULT_WEB_CHAT_SESSION,
        {
          name: saveDraft.name.trim(),
          description: saveDraft.description.trim(),
        },
      );
      if (saveRunId !== conversationSaveRunRef.current) {
        return;
      }

      setConversationIsSaving(false);
      if (response.ok && response.conversation) {
        const nextConversation = conversationDraftFromInfo(
          response.conversation,
        );
        setSavedConversationSettings(nextConversation);
        setConversationDraft(nextConversation);
        showSettingsToast("保存成功", "success");
      } else {
        showSettingsToast("保存失败", "error");
      }
    } catch {
      if (saveRunId !== conversationSaveRunRef.current) {
        return;
      }
      setConversationIsSaving(false);
      showSettingsToast("保存失败", "error");
    }
  }

  async function toggleConversationProactive() {
    if (conversationIsSwitching || conversationIsSaving) {
      return;
    }

    const previousSaved = savedConversationSettings;
    const previousDraft = conversationDraft;
    const nextAllowProactive = !previousSaved.allowProactive;
    const switchRunId = ++conversationSwitchRunRef.current;

    setConversationIsSwitching(true);
    setSavedConversationSettings((current) => ({
      ...current,
      allowProactive: nextAllowProactive,
    }));
    setConversationDraft((current) => ({
      ...current,
      allowProactive: nextAllowProactive,
    }));

    try {
      const response = await patchActorConversation(
        actorId,
        DEFAULT_WEB_CHAT_SESSION,
        {
          allowProactive: nextAllowProactive,
        },
      );
      if (switchRunId !== conversationSwitchRunRef.current) {
        return;
      }
      if (!response.ok || !response.conversation) {
        throw new Error(
          response.error?.message ?? "conversation switch failed",
        );
      }

      const nextConversation = conversationDraftFromInfo(response.conversation);
      setSavedConversationSettings(nextConversation);
      setConversationDraft((current) => ({
        ...current,
        id: nextConversation.id,
        session: nextConversation.session,
        allowProactive: nextConversation.allowProactive,
      }));
      showSettingsToast(
        nextAllowProactive ? "已启用主动对话" : "已停用主动对话",
        "success",
      );
    } catch {
      if (switchRunId !== conversationSwitchRunRef.current) {
        return;
      }
      setSavedConversationSettings(previousSaved);
      setConversationDraft(previousDraft);
      showSettingsToast("切换失败", "error");
    } finally {
      if (switchRunId === conversationSwitchRunRef.current) {
        setConversationIsSwitching(false);
      }
    }
  }

  function openDetail(title: string) {
    if (settingsLocked) {
      return;
    }
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setDetailTitle(title);
    setDetailClosing(false);
  }

  async function handleStartTraining() {
    if (!trainingPending || trainingStarting) {
      return;
    }
    setTrainingStarting(true);
    try {
      const response = await startActorTraining(actorId);
      if (response.actor.training) {
        onActorTrainingChange(actorId, response.actor.training);
      }
      setTrainingDetailVisible(true);
    } catch {
      showSettingsToast("开始学习失败", "error");
    } finally {
      setTrainingStarting(false);
    }
  }

  function handleCloseTrainingDetail() {
    setTrainingDetailVisible(false);
    if (training?.status !== "completed") {
      return;
    }
    onActorTrainingChange(actorId, null);
    void clearActorTraining(actorId).catch(() => {
      // The local completed card is already dismissed; server cleanup is best-effort.
    });
  }

  async function handleDeleteActor() {
    if (actorDeleteConfirmDisabled) {
      return;
    }
    setActorDeleting(true);
    try {
      await deleteActor(actorId);
      setActorDeleteDialogVisible(false);
      setActorDeleteConfirmationName("");
      onActorDeleted(actorId);
    } catch {
      showSettingsToast("删除失败", "error");
    } finally {
      setActorDeleting(false);
    }
  }

  function closeDetail() {
    if (!detailTitle || detailClosing) {
      return;
    }

    setLlmUnsavedDialogVisible(false);
    setWebSearchUnsavedDialogVisible(false);
    setQqUnsavedDialogVisible(false);
    setConversationUnsavedDialogVisible(false);
    setActivityDisableDialogVisible(false);
    setDetailClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setDetailTitle(null);
      setDetailClosing(false);
      closeTimerRef.current = null;
    }, 240);
  }

  function requestCloseDetail() {
    if (detailTitle === "LLM" && llmSettingsDirty) {
      setLlmUnsavedDialogVisible(true);
      return;
    }

    if (detailTitle === "搜索" && webSearchSettingsDirty) {
      setWebSearchUnsavedDialogVisible(true);
      return;
    }

    if (detailTitle === "QQ" && qqSettingsDirty) {
      setQqUnsavedDialogVisible(true);
      return;
    }

    if (detailTitle === "当前会话信息" && conversationSettingsDirty) {
      setConversationUnsavedDialogVisible(true);
      return;
    }

    closeDetail();
  }

  function discardLlmChangesAndClose() {
    llmTestRunRef.current += 1;
    llmSaveRunRef.current += 1;
    setLlmDraft(savedLlmSettings);
    setLlmConnectionStatus("idle");
    setLlmConnectionFeedback(null);
    setLlmIsSaving(false);
    setLlmUnsavedDialogVisible(false);
    closeDetail();
  }

  function updateLlmDraft(nextDraft: LlmSettingsDraft) {
    llmTestRunRef.current += 1;
    llmSaveRunRef.current += 1;
    setLlmDraft(nextDraft);
    setLlmConnectionStatus("idle");
    setLlmConnectionFeedback(null);
    setLlmIsSaving(false);
  }

  function discardWebSearchChangesAndClose() {
    webSearchSaveRunRef.current += 1;
    setWebSearchDraft(savedWebSearchSettings);
    setWebSearchValidationFeedback(null);
    setWebSearchIsSaving(false);
    setWebSearchUnsavedDialogVisible(false);
    closeDetail();
  }

  function updateWebSearchDraft(nextDraft: WebSearchSettingsDraft) {
    webSearchSaveRunRef.current += 1;
    setWebSearchDraft(nextDraft);
    setWebSearchValidationFeedback(null);
    setWebSearchIsSaving(false);
  }

  function discardQqChangesAndClose() {
    qqSaveRunRef.current += 1;
    setQqDraft(savedQqSettings);
    setQqValidationFeedback(null);
    setQqIsSaving(false);
    setQqUnsavedDialogVisible(false);
    closeDetail();
  }

  function updateQqDraft(nextDraft: QqSettingsDraft) {
    qqSaveRunRef.current += 1;
    setQqDraft(nextDraft);
    setQqValidationFeedback(null);
    setQqIsSaving(false);
  }

  function discardConversationChangesAndClose() {
    conversationSaveRunRef.current += 1;
    setConversationDraft(savedConversationSettings);
    setConversationValidationFeedback(null);
    setConversationIsSaving(false);
    setConversationUnsavedDialogVisible(false);
    closeDetail();
  }

  function updateConversationDraft(nextDraft: ConversationSettingsDraft) {
    conversationSaveRunRef.current += 1;
    setConversationDraft(nextDraft);
    setConversationValidationFeedback(null);
    setConversationIsSaving(false);
  }

  async function testLlmConnection() {
    const testDraft = llmDraft;
    const testSignature = buildLlmSettingsSignature(testDraft);

    const validationFeedback = validateLlmDraftBeforeRequest(
      testDraft,
      globalLlmConfig,
      llmModels,
    );
    if (validationFeedback) {
      setLlmConnectionStatus("error");
      setLlmConnectionFeedback(
        localDashboardFeedback(
          validationFeedback.summary,
          validationFeedback.detail,
        ),
      );
      return false;
    }

    const runId = ++llmTestRunRef.current;
    setLlmConnectionStatus("testing");
    setLlmConnectionFeedback(null);

    try {
      const response = await runActorLlmCheck(
        actorId,
        buildActorLlmConfigFromDraft(testDraft, globalLlmConfig),
        runId,
      );
      if (runId !== llmTestRunRef.current) {
        return false;
      }

      const feedback = actorLlmCheckFeedbackFromResponse(response);

      if (response.ok) {
        setLlmConnectionStatus("success");
        setLlmConnectionFeedback(feedback);
        setLlmLastPassedSignature(testSignature);

        return true;
      } else {
        setLlmConnectionStatus("error");
        setLlmConnectionFeedback(feedback);
        return false;
      }
    } catch (error) {
      if (runId !== llmTestRunRef.current) {
        return false;
      }
      setLlmConnectionStatus("error");
      setLlmConnectionFeedback(dashboardTransportFailureFeedback(error));
      return false;
    }
  }

  async function saveLlmSettings() {
    if (!llmSettingsDirty || llmIsSaving) {
      return;
    }

    const validationFeedback = validateLlmDraftBeforeRequest(
      llmDraft,
      globalLlmConfig,
      llmModels,
    );
    if (validationFeedback) {
      setLlmConnectionStatus("error");
      setLlmConnectionFeedback(
        localDashboardFeedback(
          validationFeedback.summary,
          validationFeedback.detail,
        ),
      );
      return;
    }

    const currentSignature = buildLlmSettingsSignature(llmDraft);
    const alreadyPassedCurrentConfig =
      llmConnectionStatus === "success" &&
      llmLastPassedSignature === currentSignature;

    if (!alreadyPassedCurrentConfig) {
      const passed = await testLlmConnection();
      if (!passed) {
        return;
      }
    }

    const saveDraft = llmDraft;
    const saveRunId = ++llmSaveRunRef.current;
    setLlmIsSaving(true);

    try {
      const response = await saveActorLlmConfig(
        actorId,
        buildActorLlmSaveConfigFromDraft(saveDraft, globalLlmConfig),
      );
      if (saveRunId !== llmSaveRunRef.current) {
        return;
      }

      setLlmIsSaving(false);
      if (response.ok) {
        setSavedLlmSettings(saveDraft);
        setLlmConnectionStatus("idle");
        setLlmConnectionFeedback(null);
        showSettingsToast("保存成功", "success");
      } else {
        showSettingsToast("保存失败", "error");
      }
    } catch {
      if (saveRunId !== llmSaveRunRef.current) {
        return;
      }
      setLlmIsSaving(false);
      showSettingsToast("保存失败", "error");
    }
  }

  async function saveWebSearchSettings() {
    if (!webSearchSettingsDirty || webSearchIsSaving) {
      return;
    }

    const validationFeedback = validateWebSearchDraftBeforeSave(webSearchDraft);
    if (validationFeedback) {
      setWebSearchValidationFeedback(validationFeedback);
      return;
    }

    const saveDraft = webSearchDraft;
    const saveRunId = ++webSearchSaveRunRef.current;
    setWebSearchIsSaving(true);
    setWebSearchValidationFeedback(null);

    try {
      const response = await saveActorWebSearchConfig(
        actorId,
        buildActorWebSearchConfigFromDraft(saveDraft),
      );
      if (saveRunId !== webSearchSaveRunRef.current) {
        return;
      }

      setWebSearchIsSaving(false);
      if (response.ok) {
        setSavedWebSearchSettings(saveDraft);
        showSettingsToast("保存成功", "success");
      } else {
        showSettingsToast("保存失败", "error");
      }
    } catch {
      if (saveRunId !== webSearchSaveRunRef.current) {
        return;
      }

      setWebSearchIsSaving(false);
      showSettingsToast("保存失败", "error");
    }
  }

  async function saveQqSettings() {
    if (qqIsSaving || qqIsSwitching) {
      return false;
    }

    if (areQqConnectionSettingsEqual(qqDraft, savedQqSettings)) {
      return true;
    }

    const saveDraft: QqSettingsDraft = {
      ...qqDraft,
      enabled: savedQqSettings.enabled,
      conversations: savedQqSettings.conversations,
    };
    const validationFeedback = validateQqDraftBeforeSave(saveDraft);
    if (validationFeedback) {
      setQqValidationFeedback(validationFeedback);
      return false;
    }

    const saveRunId = ++qqSaveRunRef.current;
    setQqIsSaving(true);
    setQqValidationFeedback(null);

    try {
      const response = await saveActorQqConfig(
        actorId,
        buildActorQqConfigFromDraft(saveDraft),
      );
      if (saveRunId !== qqSaveRunRef.current) {
        return false;
      }

      setQqIsSaving(false);
      if (response.ok) {
        setQqDraft((current) => ({
          ...current,
          wsUrl: saveDraft.wsUrl,
          accessToken: saveDraft.accessToken,
        }));
        setSavedQqSettings((current) => ({
          ...current,
          wsUrl: saveDraft.wsUrl,
          accessToken: saveDraft.accessToken,
        }));
        showSettingsToast("保存成功", "success");
        return true;
      } else {
        showSettingsToast("保存失败", "error");
        return false;
      }
    } catch {
      if (saveRunId !== qqSaveRunRef.current) {
        return false;
      }

      setQqIsSaving(false);
      showSettingsToast("保存失败", "error");
      return false;
    }
  }

  async function toggleQqEnabled() {
    if (qqIsSwitching || qqIsSaving) {
      return;
    }

    const previousSettings = savedQqSettings;
    const nextEnabled = !previousSettings.enabled;
    if (
      nextEnabled &&
      (!previousSettings.wsUrl.trim() || !previousSettings.accessToken.trim())
    ) {
      showSettingsToast("请先保存 ws 地址和 token", "error");
      return;
    }
    const switchRunId = ++qqSwitchRunRef.current;

    setQqIsSwitching(true);
    setQqValidationFeedback(null);
    setSavedQqSettings((current) => ({
      ...current,
      enabled: nextEnabled,
    }));
    setQqDraft((current) => ({
      ...current,
      enabled: nextEnabled,
    }));

    try {
      const response = await updateActorQqEnabled(actorId, nextEnabled);
      if (switchRunId !== qqSwitchRunRef.current) {
        return;
      }

      if (!response.ok) {
        throw new Error(response.error?.message ?? "QQ enabled switch failed");
      }

      const nextSettings = qqDraftFromConfig(response.config);
      setSavedQqSettings(nextSettings);
      setQqDraft((current) => ({
        ...current,
        enabled: nextSettings.enabled,
        conversations: nextSettings.conversations,
      }));
      showSettingsToast(
        nextEnabled ? "NapCatQQ 已启用" : "NapCatQQ 已停用",
        "success",
      );
    } catch (error) {
      if (switchRunId !== qqSwitchRunRef.current) {
        return;
      }

      setSavedQqSettings(previousSettings);
      setQqDraft((current) => ({
        ...current,
        enabled: previousSettings.enabled,
      }));
      if (nextEnabled) {
        setQqValidationFeedback({
          summary: "无法启用 NapCatQQ",
          detail:
            previousSettings.wsUrl.trim() && previousSettings.accessToken.trim()
              ? messageFromError(error)
              : "请先保存 ws 地址和 token。",
          fields: [
            !previousSettings.wsUrl.trim() ? "wsUrl" : null,
            !previousSettings.accessToken.trim() ? "accessToken" : null,
          ].filter((field): field is QqSettingsFieldId => Boolean(field)),
        });
      }
      showSettingsToast(nextEnabled ? "启用失败" : "停用失败", "error");
    } finally {
      if (switchRunId === qqSwitchRunRef.current) {
        setQqIsSwitching(false);
      }
    }
  }

  async function saveQqConversations(
    conversations: QqConversationDraft[],
    messages: {
      success: string;
      failure: string;
    },
  ) {
    if (qqIsSaving || qqIsSwitching) {
      return false;
    }

    const previousConversations = savedQqSettings.conversations;
    const createdConversations = conversations.filter(
      (conversation) =>
        !previousConversations.some((item) => item.id === conversation.id),
    );
    const deletedConversations = previousConversations.filter(
      (conversation) =>
        !conversations.some((item) => item.id === conversation.id),
    );
    const changedConversations = conversations.filter((conversation) => {
      const previous = previousConversations.find(
        (item) => item.id === conversation.id,
      );
      return previous && !areQqConversationsEqual(conversation, previous);
    });
    const mutationCount =
      createdConversations.length +
      deletedConversations.length +
      changedConversations.length;

    if (mutationCount === 0) {
      return true;
    }

    if (mutationCount !== 1) {
      showSettingsToast(messages.failure, "error");
      return false;
    }

    const saveRunId = ++qqSaveRunRef.current;
    setQqIsSaving(true);

    try {
      let nextConversations = previousConversations;
      if (createdConversations.length === 1) {
        const response = await createActorQqConversation(
          actorId,
          buildActorQqConversationFromDraft(createdConversations[0]),
        );
        if (!response.ok || !response.conversation) {
          throw new Error(response.error?.message ?? messages.failure);
        }
        nextConversations = [
          ...previousConversations,
          { ...response.conversation },
        ];
      } else if (changedConversations.length === 1) {
        const changedConversation = changedConversations[0];
        const response = await patchActorQqConversation(
          actorId,
          changedConversation.id,
          {
            name: changedConversation.name.trim(),
            description: changedConversation.description.trim(),
            allowProactive: changedConversation.allowProactive,
          },
        );
        if (!response.ok || !response.conversation) {
          throw new Error(response.error?.message ?? messages.failure);
        }
        nextConversations = previousConversations.map((conversation) =>
          conversation.id === changedConversation.id
            ? { ...response.conversation! }
            : conversation,
        );
      } else if (deletedConversations.length === 1) {
        const deletedConversation = deletedConversations[0];
        const response = await deleteActorQqConversation(
          actorId,
          deletedConversation.id,
        );
        if (!response.ok) {
          throw new Error(response.error?.message ?? messages.failure);
        }
        nextConversations = previousConversations.filter(
          (conversation) => conversation.id !== deletedConversation.id,
        );
      }

      if (saveRunId !== qqSaveRunRef.current) {
        return false;
      }

      setQqIsSaving(false);
      setSavedQqSettings((current) => ({
        ...current,
        conversations: nextConversations,
      }));
      setQqDraft((current) => ({
        ...current,
        conversations: nextConversations,
      }));
      showSettingsToast(messages.success, "success");
      return true;
    } catch {
      if (saveRunId !== qqSaveRunRef.current) {
        return false;
      }

      setQqIsSaving(false);
      showSettingsToast(messages.failure, "error");
      return false;
    }
  }

  function syncSettingsScrollbarMetrics() {
    const scrollElement = settingsScrollRef.current;
    if (!scrollElement) {
      return;
    }

    const trackHeight = scrollElement.clientHeight;
    const maxScrollTop = Math.max(
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight,
    );
    const canScroll = maxScrollTop > 1 && trackHeight > 0;
    const thumbHeight = canScroll
      ? Math.min(
          trackHeight,
          Math.max(
            MESSAGE_SCROLLBAR_MIN_THUMB_HEIGHT,
            (trackHeight * scrollElement.clientHeight) /
              scrollElement.scrollHeight,
          ),
        )
      : 0;
    const thumbTop = canScroll
      ? ((trackHeight - thumbHeight) * scrollElement.scrollTop) / maxScrollTop
      : 0;

    setSettingsScrollbarMetrics((current) => {
      const next = {
        canScroll,
        thumbHeight: Math.round(thumbHeight),
        thumbTop: Math.round(thumbTop),
      };

      if (
        current.canScroll === next.canScroll &&
        current.thumbHeight === next.thumbHeight &&
        current.thumbTop === next.thumbTop
      ) {
        return current;
      }

      return next;
    });
  }

  function setSettingsScrollbarShown(visible: boolean) {
    settingsScrollbarVisibleRef.current = visible;
    setSettingsScrollbarVisible(visible);
  }

  function clearSettingsScrollbarIdleTimer() {
    if (settingsScrollbarIdleTimerRef.current === null) {
      return;
    }

    clearTimeout(settingsScrollbarIdleTimerRef.current);
    settingsScrollbarIdleTimerRef.current = null;
  }

  function scheduleSettingsScrollbarHide() {
    clearSettingsScrollbarIdleTimer();
    settingsScrollbarIdleTimerRef.current = setTimeout(() => {
      setSettingsScrollbarShown(false);
      settingsScrollbarIdleTimerRef.current = null;
    }, MESSAGE_SCROLLBAR_IDLE_DELAY);
  }

  function showSettingsScrollbarForActivity() {
    syncSettingsScrollbarMetrics();

    if (!settingsScrollbarVisibleRef.current) {
      setSettingsScrollbarShown(true);
    }

    scheduleSettingsScrollbarHide();
  }

  useIsomorphicLayoutEffect(() => {
    const scrollElement = settingsScrollRef.current;
    if (!scrollElement) {
      return undefined;
    }

    syncSettingsScrollbarMetrics();
    const resizeObserver = new ResizeObserver(syncSettingsScrollbarMetrics);
    resizeObserver.observe(scrollElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [detailTitle]);

  return (
    <div className={styles.actorSettings}>
      <div
        ref={settingsScrollRef}
        className={styles.actorSettingsScroll}
        onPointerEnter={showSettingsScrollbarForActivity}
        onPointerMove={showSettingsScrollbarForActivity}
        onPointerLeave={scheduleSettingsScrollbarHide}
        onScroll={showSettingsScrollbarForActivity}
      >
        <div className={styles.actorSettingsContent}>
          <section
            className={styles.actorSettingsProfile}
            aria-labelledby="actor-main-settings-title"
          >
            <h3 id="actor-main-settings-title" className={styles.srOnly}>
              主要设置
            </h3>
            <button
              type="button"
              className={styles.actorSettingsAvatarButton}
              aria-label="更换头像"
              onClick={() => showSettingsToast("暂不支持", "error")}
            >
              <span className={styles.actorSettingsAvatarText}>
                {actorAvatarText(actorName)}
              </span>
              <span className={styles.actorSettingsAvatarOverlay}>
                <Camera aria-hidden="true" />
              </span>
            </button>
            <h3 className={styles.actorSettingsProfileName}>{actorName}</h3>
            {showStartupTip ? (
              <div className={styles.actorSettingsStartupTip} role="note">
                <Info aria-hidden="true" />
                <span>请先配置LLM服务再启动</span>
                {onStartupTipDismiss ? (
                  <button
                    type="button"
                    aria-label="关闭提示"
                    disabled={settingsLocked}
                    onClick={onStartupTipDismiss}
                  >
                    <X aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className={`${styles.actorSettingsMenuItem} ${styles.actorSettingsSwitchItem} ${styles.actorActivitySwitchItem}`}
              role="switch"
              aria-checked={activityEnabled}
              aria-label={activityButtonLabel}
              disabled={activityActionDisabled}
              onClick={() => {
                if (activityActionDisabled) {
                  return;
                }

                if (activityStatus !== "offline") {
                  setActivityDisableDialogVisible(true);
                  return;
                }

                void toggleActorActivity();
              }}
            >
              <span className={styles.actorSettingsMenuIcon}>
                <ActorActivityStatusIcon
                  status={activityStatus}
                  transition={activityTransition}
                />
              </span>
              <span className={styles.actorSettingsMenuText}>
                <span className={styles.actorSettingsMenuTitle}>
                  {activityButtonLabel}
                </span>
                <span className={styles.actorSettingsMenuDescription}>
                  {activityDescription}
                </span>
              </span>
              <span
                className={`${styles.actorSettingsSwitch} ${
                  activityEnabled ? styles.actorSettingsSwitchOn : ""
                }`}
                aria-hidden="true"
              >
                <span className={styles.actorSettingsSwitchKnob} />
              </span>
            </button>

            {training ? (
              training.status === "pending" ? (
                <ActorTrainingStartCard
                  training={training}
                  starting={trainingStarting}
                  onStart={() => void handleStartTraining()}
                />
              ) : (
                <ActorTrainingProgressCard
                  training={training}
                  onOpen={() => setTrainingDetailVisible(true)}
                />
              )
            ) : null}

            <button
              type="button"
              className={styles.actorSettingsMenuItem}
              disabled={settingsLocked}
              onClick={() => openDetail("当前会话信息")}
            >
              <span className={styles.actorSettingsMenuIcon}>
                <MessageSquareMore aria-hidden="true" />
              </span>
              <span className={styles.actorSettingsMenuText}>
                <span className={styles.actorSettingsMenuTitle}>
                  当前会话信息
                </span>
                <span className={styles.actorSettingsMenuDescription}>
                  模型会根据信息理解会话的场景
                </span>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>

            {activityDisableDialogVisible ? (
              <div className={styles.llmUnsavedOverlay} role="alertdialog">
                <div className={styles.llmUnsavedDialog}>
                  <h4>停用角色 {actorName}</h4>
                  <p>
                    停用会卸载该角色的运行时，并让角色进入离线状态。确定要这么做吗？
                  </p>
                  <div className={styles.llmUnsavedActions}>
                    <button
                      type="button"
                      disabled={activitySwitching}
                      onClick={() => setActivityDisableDialogVisible(false)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className={styles.llmUnsavedDangerButton}
                      disabled={activityTransitioning}
                      onClick={() => {
                        void toggleActorActivity();
                      }}
                    >
                      {activitySwitching ? "处理中" : "确认停用"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {actorDeleteDialogVisible ? (
              <div className={styles.llmUnsavedOverlay} role="alertdialog">
                <div className={styles.llmUnsavedDialog}>
                  <h4>删除角色？</h4>
                  <p>删除操作不可逆，请输入角色名以确认删除。</p>
                  <label
                    className={styles.llmSettingsField}
                    aria-label="角色名"
                  >
                    <input
                      type="text"
                      placeholder={actorName}
                      value={actorDeleteConfirmationName}
                      disabled={actorDeleting}
                      autoComplete="off"
                      onChange={(event) =>
                        setActorDeleteConfirmationName(event.target.value)
                      }
                    />
                  </label>
                  <div className={styles.llmUnsavedActions}>
                    <button
                      type="button"
                      disabled={actorDeleting}
                      onClick={() => {
                        setActorDeleteDialogVisible(false);
                        setActorDeleteConfirmationName("");
                      }}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className={styles.llmUnsavedDangerButton}
                      disabled={actorDeleteConfirmDisabled}
                      onClick={() => {
                        void handleDeleteActor();
                      }}
                    >
                      {actorDeleting ? "删除中" : "删除"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {menuSections.map((section) => (
            <section
              key={section.title}
              className={styles.actorSettingsSection}
              aria-labelledby={`actor-settings-${section.title}`}
            >
              <h3
                id={`actor-settings-${section.title}`}
                className={styles.actorSettingsSectionTitle}
              >
                <span>{section.title}</span>
              </h3>
              <div className={styles.actorSettingsMenuList}>
                {section.items.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`${styles.actorSettingsMenuItem} ${
                      item.danger ? styles.actorSettingsMenuItemDanger : ""
                    } ${
                      item.type === "button"
                        ? styles.actorSettingsMenuButton
                        : ""
                    }`}
                    disabled={
                      item.label === "删除角色"
                        ? actorDeleteMenuDisabled
                        : settingsLocked
                    }
                    onClick={() => {
                      if (item.type === "menu") {
                        openDetail(item.label);
                        return;
                      }

                      if (item.label === "删除角色") {
                        setActorDeleteConfirmationName("");
                        setActorDeleteDialogVisible(true);
                      }
                    }}
                  >
                    <span className={styles.actorSettingsMenuIcon}>
                      <ActorSettingsMenuItemIcon name={item.icon} />
                    </span>
                    <span className={styles.actorSettingsMenuText}>
                      <span className={styles.actorSettingsMenuTitle}>
                        {item.label}
                      </span>
                      {item.description ? (
                        <span className={styles.actorSettingsMenuDescription}>
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    {item.type === "menu" ? (
                      <ChevronRight aria-hidden="true" />
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <div
        className={`${styles.actorSettingsScrollbar} ${
          settingsScrollbarVisible && settingsScrollbarMetrics.canScroll
            ? styles.actorSettingsScrollbarVisible
            : ""
        }`}
        aria-hidden="true"
        style={
          {
            "--actor-settings-scrollbar-thumb-height": `${settingsScrollbarMetrics.thumbHeight}px`,
            "--actor-settings-scrollbar-thumb-top": `${settingsScrollbarMetrics.thumbTop}px`,
          } as CSSProperties
        }
      >
        <span className={styles.actorSettingsScrollbarThumb} />
      </div>

      {detailTitle ? (
        <div
          className={`${styles.actorSettingsDetail} ${
            detailClosing ? styles.actorSettingsDetailClosing : ""
          }`}
          role="dialog"
          aria-modal="false"
          aria-label={detailHeading}
        >
          <div className={styles.actorSettingsDetailHeader}>
            <div className={styles.actorSettingsDetailHeaderInner}>
              <h3>{detailHeading}</h3>
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
          {detailTitle === "LLM" ? (
            <ActorLlmSettingsDetail
              draft={llmDraft}
              dirty={llmSettingsDirty}
              connectionStatus={llmConnectionStatus}
              connectionFeedback={llmConnectionFeedback}
              isSaving={llmIsSaving}
              globalLlmConfig={globalLlmConfig}
              models={llmModels}
              unsavedDialogVisible={llmUnsavedDialogVisible}
              onDraftChange={updateLlmDraft}
              onTestConnection={testLlmConnection}
              onSave={saveLlmSettings}
              onCancelClose={() => setLlmUnsavedDialogVisible(false)}
              onDiscardAndClose={discardLlmChangesAndClose}
            />
          ) : detailTitle === "当前会话信息" ? (
            <ActorConversationSettingsDetail
              draft={conversationDraft}
              dirty={conversationSettingsDirty}
              validationFeedback={conversationValidationFeedback}
              isSaving={conversationIsSaving}
              isSwitching={conversationIsSwitching}
              unsavedDialogVisible={conversationUnsavedDialogVisible}
              onDraftChange={updateConversationDraft}
              onToggleProactive={toggleConversationProactive}
              onSave={saveConversationSettings}
              onCancelClose={() => setConversationUnsavedDialogVisible(false)}
              onDiscardAndClose={discardConversationChangesAndClose}
            />
          ) : detailTitle === "搜索" ? (
            <ActorSearchSettingsDetail
              draft={webSearchDraft}
              dirty={webSearchSettingsDirty}
              validationFeedback={webSearchValidationFeedback}
              isSaving={webSearchIsSaving}
              unsavedDialogVisible={webSearchUnsavedDialogVisible}
              onDraftChange={updateWebSearchDraft}
              onSave={saveWebSearchSettings}
              onCancelClose={() => setWebSearchUnsavedDialogVisible(false)}
              onDiscardAndClose={discardWebSearchChangesAndClose}
            />
          ) : detailTitle === "QQ" ? (
            <ActorQqSettingsDetail
              actorId={actorId}
              savedSettings={savedQqSettings}
              draft={qqDraft}
              dirty={qqSettingsDirty}
              validationFeedback={qqValidationFeedback}
              isSaving={qqIsSaving}
              isSwitching={qqIsSwitching}
              isConnectionConnecting={qqTransportStatus === "connecting"}
              unsavedDialogVisible={qqUnsavedDialogVisible}
              onDraftChange={updateQqDraft}
              onToggleEnabled={toggleQqEnabled}
              onConnectionStateChange={handleQqConnectionStateChange}
              onSave={saveQqSettings}
              onSaveConversations={saveQqConversations}
              onCancelClose={() => setQqUnsavedDialogVisible(false)}
              onDiscardAndClose={discardQqChangesAndClose}
            />
          ) : ["表情包", "微信", "Telegram"].includes(detailTitle) ? (
            <ActorComingSoonSettingsDetail />
          ) : null}
        </div>
      ) : null}

      {trainingDetailVisible && training ? (
        <ActorTrainingDetailOverlay
          training={training}
          onClose={handleCloseTrainingDetail}
        />
      ) : null}

      {settingsToast ? (
        <div
          key={settingsToast.id}
          className={`${styles.actorSettingsToast} ${
            settingsToast.kind === "success"
              ? styles.actorSettingsToastSuccess
              : styles.actorSettingsToastError
          }`}
          role={settingsToast.kind === "success" ? "status" : "alert"}
          aria-live={settingsToast.kind === "success" ? "polite" : "assertive"}
        >
          {settingsToast.kind === "success" ? (
            <Check aria-hidden="true" />
          ) : (
            <X aria-hidden="true" />
          )}
          <span>{settingsToast.message}</span>
        </div>
      ) : null}
    </div>
  );
}

function ActorTrainingStartCard({
  training,
  starting,
  onStart,
}: {
  training: NonNullable<ActorSummary["training"]>;
  starting: boolean;
  onStart: () => void;
}) {
  return (
    <div className={styles.actorTrainingCard}>
      <span className={styles.actorTrainingCardIcon} aria-hidden="true">
        <GraduationCap />
      </span>
      <span className={styles.actorTrainingCardBody}>
        <span className={styles.actorTrainingCardTitle}>
          等待学习
          <strong>{training.totalMessages} 条</strong>
        </span>
        <span className={styles.actorTrainingCardMeta}>开始前请先配置 LLM</span>
        <button
          type="button"
          className={styles.actorTrainingStartButton}
          disabled={starting}
          onClick={onStart}
        >
          {starting ? "开始中" : "开始学习"}
        </button>
      </span>
    </div>
  );
}

function ActorTrainingProgressCard({
  training,
  onOpen,
}: {
  training: NonNullable<ActorSummary["training"]>;
  onOpen: () => void;
}) {
  const progressLabel = formatTrainingPercent(training.progress);
  const running = training.status === "running";
  const failed = training.status === "failed";
  const remainingLabel =
    running && training.estimatedRemainingMs === null
      ? "计算中"
      : formatTrainingRemaining(training.estimatedRemainingMs ?? 0);

  return (
    <button type="button" className={styles.actorTrainingCard} onClick={onOpen}>
      <span
        className={styles.actorTrainingCardIcon}
        data-running={running ? "true" : undefined}
        aria-hidden="true"
      >
        {running ? <LoaderCircle /> : <GraduationCap />}
      </span>
      <span className={styles.actorTrainingCardBody}>
        <span className={styles.actorTrainingCardTitle}>
          {failed ? "学习失败" : running ? "学习中" : "学习完成"}
          <strong>{progressLabel}</strong>
        </span>
        <span className={styles.actorTrainingCardMeta}>
          {training.characterName} · {training.processedMessages}/
          {training.totalMessages} 条
        </span>
        <span className={styles.actorTrainingProgressTrack} aria-hidden="true">
          <span style={{ width: progressLabel }} />
        </span>
        <span className={styles.actorTrainingCardEta}>
          {failed
            ? "请检查学习日志"
            : running
              ? `预计剩余 ${remainingLabel}`
              : "可以启动角色"}
        </span>
      </span>
    </button>
  );
}

function ActorTrainingDetailOverlay({
  training,
  onClose,
}: {
  training: NonNullable<ActorSummary["training"]>;
  onClose: () => void;
}) {
  const progressLabel = formatTrainingPercent(training.progress);
  const running = training.status === "running";
  const failed = training.status === "failed";

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={styles.actorTrainingOverlay}
      role="dialog"
      aria-modal="true"
    >
      <div className={styles.actorTrainingDialog}>
        <header className={styles.actorTrainingDialogHeader}>
          <span className={styles.actorTrainingDialogIcon} aria-hidden="true">
            <Terminal />
          </span>
          <div>
            <h3>{failed ? "学习失败" : running ? "学习进行中" : "学习完成"}</h3>
            <p>{training.characterName}</p>
          </div>
          <button
            type="button"
            className={styles.actorTrainingDialogClose}
            aria-label="关闭学习详情"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <section className={styles.actorTrainingDialogStats}>
          <span>
            <GraduationCap aria-hidden="true" />
            {training.processedMessages}/{training.totalMessages}
          </span>
          <span>
            <Clock3 aria-hidden="true" />
            {failed
              ? "失败"
              : running
                ? training.estimatedRemainingMs === null
                  ? "计算中"
                  : formatTrainingRemaining(training.estimatedRemainingMs)
                : "已完成"}
          </span>
          <span>{progressLabel}</span>
        </section>

        <div className={styles.actorTrainingDialogProgress}>
          <span style={{ width: progressLabel }} />
        </div>

        <dl className={styles.actorTrainingDialogMeta}>
          <div>
            <dt>回放数据</dt>
            <dd>{training.sourceFileName ?? "未命名 JSON"}</dd>
          </div>
          <div>
            <dt>描述</dt>
            <dd>{training.description}</dd>
          </div>
          <div>
            <dt>时间范围</dt>
            <dd>
              {training.startTime} ~ {training.endTime}
            </dd>
          </div>
          <div>
            <dt>天数</dt>
            <dd>{training.dayCount}</dd>
          </div>
        </dl>

        <div className={styles.actorTrainingTerminal}>
          {training.logs.map((line, index) => (
            <div key={`${index}-${line}`}>
              <code>{line}</code>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ActorSettingsMenuItemIcon({ name }: { name: ActorSettingsMenuIcon }) {
  if (name === "llm") {
    return <Bot aria-hidden="true" />;
  }

  if (name === "conversation") {
    return <MessageSquareMore aria-hidden="true" />;
  }

  if (name === "search") {
    return <Search aria-hidden="true" />;
  }

  if (name === "sticker") {
    return <Smile aria-hidden="true" />;
  }

  if (name === "qq") {
    return <MessageCircle aria-hidden="true" />;
  }

  if (name === "wechat") {
    return <MessageCircleMore aria-hidden="true" />;
  }

  if (name === "telegram") {
    return <Send aria-hidden="true" />;
  }

  return <Trash2 aria-hidden="true" />;
}

function ActorActivityStatusIcon({
  status,
  transition,
}: {
  status: ActorRuntimeStatus;
  transition: ActorRuntimeTransition;
}) {
  if (transition !== null) {
    return (
      <LoaderCircle
        className={styles.actorActivityIcon_preparing}
        aria-hidden="true"
      />
    );
  }

  if (status === "offline") {
    return (
      <PowerOff
        className={styles.actorActivityIcon_offline}
        aria-hidden="true"
      />
    );
  }

  if (status === "sleep") {
    return (
      <Moon className={styles.actorActivityIcon_sleeping} aria-hidden="true" />
    );
  }

  if (status === "busy") {
    return (
      <Activity className={styles.actorActivityIcon_busy} aria-hidden="true" />
    );
  }

  return (
    <Globe className={styles.actorActivityIcon_online} aria-hidden="true" />
  );
}

function ActorComingSoonSettingsDetail() {
  return (
    <div className={styles.llmSettingsBody}>
      <div className={styles.llmSettingsContent}>
        <div className={styles.llmComingSoon}>
          <strong>Coming soon</strong>
        </div>
      </div>
    </div>
  );
}

function ActorConversationSettingsDetail({
  draft,
  dirty,
  validationFeedback,
  isSaving,
  isSwitching,
  unsavedDialogVisible,
  onDraftChange,
  onToggleProactive,
  onSave,
  onCancelClose,
  onDiscardAndClose,
}: {
  draft: ConversationSettingsDraft;
  dirty: boolean;
  validationFeedback: ReturnType<typeof validateConversationDraftBeforeSave>;
  isSaving: boolean;
  isSwitching: boolean;
  unsavedDialogVisible: boolean;
  onDraftChange: (draft: ConversationSettingsDraft) => void;
  onToggleProactive: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onCancelClose: () => void;
  onDiscardAndClose: () => void;
}) {
  const nameInvalid = Boolean(validationFeedback?.fields.includes("name"));

  function updateDraft(patch: Partial<ConversationSettingsDraft>) {
    onDraftChange({
      ...draft,
      ...patch,
    });
  }

  function handleDescriptionChange(
    event: ReactChangeEvent<HTMLTextAreaElement>,
  ) {
    updateDraft({ description: event.currentTarget.value });
  }

  return (
    <>
      <div className={styles.llmSettingsBody}>
        <div className={styles.llmSettingsContent}>
          <section className={styles.searchIntroCard} aria-label="会话说明">
            <div className={styles.searchIntroIcon} aria-hidden="true">
              <Info />
            </div>
            <div className={styles.searchIntroContent}>
              <p>模型会根据会话名称和描述理解当前聊天场景。</p>
            </div>
          </section>

          <section
            className={`${styles.llmSettingsSection} ${styles.llmSettingsSectionEnter}`}
            aria-label="会话信息"
          >
            <div className={styles.llmSettingsFields}>
              <label
                className={`${styles.llmSettingsField} ${
                  nameInvalid ? styles.llmSettingsFieldInvalid : ""
                }`}
              >
                <span className={styles.llmSettingsControlTitle}>会话名称</span>
                <input
                  type="text"
                  aria-invalid={nameInvalid ? true : undefined}
                  value={draft.name}
                  placeholder="和你的网页聊天"
                  autoComplete="off"
                  onChange={(event) =>
                    updateDraft({ name: event.currentTarget.value })
                  }
                />
              </label>

              <label className={styles.llmSettingsField}>
                <span className={styles.llmSettingsControlTitle}>描述</span>
                <textarea
                  className={styles.qqConversationTextarea}
                  value={draft.description}
                  placeholder="描述这个会话的场景、关系或用途"
                  rows={4}
                  onChange={handleDescriptionChange}
                />
              </label>

              {validationFeedback ? (
                <p className={styles.searchSettingsFieldHint} role="alert">
                  {validationFeedback.summary}
                </p>
              ) : null}
            </div>
          </section>

          <button
            type="button"
            className={`${styles.llmGlobalSwitch} ${
              draft.allowProactive ? styles.llmGlobalSwitchOn : ""
            }`}
            role="switch"
            aria-checked={draft.allowProactive}
            aria-busy={isSwitching ? true : undefined}
            disabled={isSwitching || isSaving}
            onClick={() => {
              void onToggleProactive();
            }}
          >
            <span className={styles.llmSettingsItemText}>
              <span className={styles.llmSettingsItemTitle}>启用主动对话</span>
              <span className={styles.llmSettingsItemDescription}>
                允许角色在该网页会话中主动发起或延续话题
              </span>
            </span>
            <span
              className={`${styles.actorSettingsSwitch} ${
                draft.allowProactive ? styles.actorSettingsSwitchOn : ""
              } ${isSwitching ? styles.actorSettingsSwitchLoading : ""}`}
              aria-hidden="true"
            >
              <span className={styles.actorSettingsSwitchKnob}>
                {isSwitching ? <LoaderCircle aria-hidden="true" /> : null}
              </span>
            </span>
          </button>
        </div>
      </div>
      <div className={styles.llmSettingsFooter}>
        <div className={styles.llmSettingsFooterInner}>
          <button
            type="button"
            className={`${styles.llmSaveButton} ${
              isSaving ? styles.llmSaveButtonSaving : ""
            }`}
            disabled={!dirty || isSaving || isSwitching}
            onClick={() => {
              void onSave();
            }}
          >
            {isSaving ? <LoaderCircle aria-hidden="true" /> : null}
            <span>{isSaving ? "保存中" : "保存"}</span>
          </button>
        </div>
      </div>

      {unsavedDialogVisible ? (
        <div className={styles.llmUnsavedOverlay} role="alertdialog">
          <div className={styles.llmUnsavedDialog}>
            <h4>放弃未保存的修改？</h4>
            <p>当前会话信息还没有保存，退出后本次修改会被丢弃。</p>
            <div className={styles.llmUnsavedActions}>
              <button type="button" onClick={onCancelClose}>
                继续编辑
              </button>
              <button
                type="button"
                className={styles.llmUnsavedDangerButton}
                onClick={onDiscardAndClose}
              >
                仍要退出
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ActorLlmSettingsDetail({
  draft,
  dirty,
  connectionStatus,
  connectionFeedback,
  isSaving,
  globalLlmConfig,
  models,
  unsavedDialogVisible,
  onDraftChange,
  onTestConnection,
  onSave,
  onCancelClose,
  onDiscardAndClose,
}: {
  draft: LlmSettingsDraft;
  dirty: boolean;
  connectionStatus: LlmConnectionStatus;
  connectionFeedback: DashboardCheckFeedback | null;
  isSaving: boolean;
  globalLlmConfig: ActorLlmConfig | null;
  models: LlmModelOption[];
  unsavedDialogVisible: boolean;
  onDraftChange: (draft: LlmSettingsDraft) => void;
  onTestConnection: () => void | Promise<unknown>;
  onSave: () => void | Promise<void>;
  onCancelClose: () => void;
  onDiscardAndClose: () => void;
}) {
  const selectedModel =
    models.find((option) => option.model === draft.model) ?? null;
  const isTestingConnection = connectionStatus === "testing";
  const isPreflightLlmError =
    connectionStatus === "error" &&
    (connectionFeedback?.code === "CLIENT_VALIDATION" ||
      connectionFeedback?.code === "UNSUPPORTED");
  const preflightInvalidFields = isPreflightLlmError
    ? (validateLlmDraftBeforeRequest(draft, globalLlmConfig, models)?.fields ??
      [])
    : [];
  const shouldShowLlmErrorDetails =
    connectionStatus === "error" &&
    Boolean(connectionFeedback) &&
    connectionFeedback?.code !== "CLIENT_VALIDATION" &&
    connectionFeedback?.code !== "UNSUPPORTED";
  const globalSummaryRows = buildGlobalLlmSummaryRows(globalLlmConfig, models);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const detailScrollbarVisibleRef = useRef(false);
  const detailScrollbarIdleTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [detailScrollbarVisible, setDetailScrollbarVisible] = useState(false);
  const [detailScrollbarMetrics, setDetailScrollbarMetrics] = useState({
    canScroll: false,
    thumbHeight: 0,
    thumbTop: 0,
  });

  function updateDraft(patch: Partial<LlmSettingsDraft>) {
    onDraftChange({
      ...draft,
      ...patch,
    });
  }

  function selectModel(option: LlmModelOption) {
    onDraftChange(llmDraftForModel(option, draft));
    setModelDropdownOpen(false);
  }

  function hasPreflightFieldError(field: LlmSettingsFieldId) {
    return preflightInvalidFields.includes(field);
  }

  function syncDetailScrollbarMetrics() {
    const scrollElement = detailScrollRef.current;
    if (!scrollElement) {
      return;
    }

    const trackHeight = scrollElement.clientHeight;
    const maxScrollTop = Math.max(
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight,
    );
    const canScroll = maxScrollTop > 1 && trackHeight > 0;
    const thumbHeight = canScroll
      ? Math.min(
          trackHeight,
          Math.max(
            MESSAGE_SCROLLBAR_MIN_THUMB_HEIGHT,
            (trackHeight * scrollElement.clientHeight) /
              scrollElement.scrollHeight,
          ),
        )
      : 0;
    const thumbTop = canScroll
      ? ((trackHeight - thumbHeight) * scrollElement.scrollTop) / maxScrollTop
      : 0;

    setDetailScrollbarMetrics((current) => {
      const next = {
        canScroll,
        thumbHeight: Math.round(thumbHeight),
        thumbTop: Math.round(thumbTop),
      };

      if (
        current.canScroll === next.canScroll &&
        current.thumbHeight === next.thumbHeight &&
        current.thumbTop === next.thumbTop
      ) {
        return current;
      }

      return next;
    });
  }

  function setDetailScrollbarShown(visible: boolean) {
    detailScrollbarVisibleRef.current = visible;
    setDetailScrollbarVisible(visible);
  }

  function clearDetailScrollbarIdleTimer() {
    if (detailScrollbarIdleTimerRef.current === null) {
      return;
    }

    clearTimeout(detailScrollbarIdleTimerRef.current);
    detailScrollbarIdleTimerRef.current = null;
  }

  function scheduleDetailScrollbarHide() {
    clearDetailScrollbarIdleTimer();
    detailScrollbarIdleTimerRef.current = setTimeout(() => {
      setDetailScrollbarShown(false);
      detailScrollbarIdleTimerRef.current = null;
    }, MESSAGE_SCROLLBAR_IDLE_DELAY);
  }

  function showDetailScrollbarForActivity() {
    syncDetailScrollbarMetrics();

    if (!detailScrollbarVisibleRef.current) {
      setDetailScrollbarShown(true);
    }

    scheduleDetailScrollbarHide();
  }

  useEffect(() => {
    return () => {
      if (detailScrollbarIdleTimerRef.current !== null) {
        clearTimeout(detailScrollbarIdleTimerRef.current);
      }
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    const scrollElement = detailScrollRef.current;
    if (!scrollElement) {
      return undefined;
    }

    syncDetailScrollbarMetrics();
    const resizeObserver = new ResizeObserver(syncDetailScrollbarMetrics);
    resizeObserver.observe(scrollElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [draft.useGlobal]);

  return (
    <>
      <div
        ref={detailScrollRef}
        className={styles.llmSettingsBody}
        onPointerEnter={showDetailScrollbarForActivity}
        onPointerMove={showDetailScrollbarForActivity}
        onPointerLeave={scheduleDetailScrollbarHide}
        onScroll={showDetailScrollbarForActivity}
      >
        <div className={styles.llmSettingsContent}>
          <button
            type="button"
            className={`${styles.llmGlobalSwitch} ${
              draft.useGlobal ? styles.llmGlobalSwitchOn : ""
            }`}
            role="switch"
            aria-checked={draft.useGlobal}
            onClick={() =>
              onDraftChange(
                draft.useGlobal
                  ? defaultCustomLlmDraft(globalLlmConfig, models)
                  : DEFAULT_LLM_SETTINGS,
              )
            }
          >
            <span className={styles.llmSettingsItemText}>
              <span className={styles.llmSettingsItemTitle}>使用全局配置</span>
              <span className={styles.llmSettingsItemDescription}>
                开启后该角色会跟随系统默认 LLM 配置
              </span>
            </span>
            <span
              className={`${styles.actorSettingsSwitch} ${
                draft.useGlobal ? styles.actorSettingsSwitchOn : ""
              }`}
              aria-hidden="true"
            >
              <span className={styles.actorSettingsSwitchKnob} />
            </span>
          </button>

          {draft.useGlobal ? (
            <section
              className={`${styles.llmSettingsSection} ${styles.llmSettingsSectionEnter}`}
              aria-label="当前全局配置"
            >
              <h4>当前全局配置</h4>
              <div className={styles.llmGlobalSummary}>
                {globalSummaryRows.map(([label, value]) => (
                  <span key={label} className={styles.llmGlobalSummaryRow}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </span>
                ))}
              </div>
            </section>
          ) : (
            <section
              className={`${styles.llmSettingsSection} ${styles.llmSettingsSectionEnter}`}
              aria-label="自定义 LLM 配置"
            >
              <div className={styles.llmSettingsFields}>
                <label
                  className={`${styles.llmSettingsField} ${
                    hasPreflightFieldError("model")
                      ? styles.llmSettingsFieldInvalid
                      : ""
                  }`}
                >
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
                      onClick={() =>
                        setModelDropdownOpen((current) => !current)
                      }
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
                              !previous ||
                              previous.provider !== option.provider;
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
                      {selectedModel.capabilities.thinkingLevels.map(
                        (level) => (
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
                            onClick={() =>
                              updateDraft({ thinkingLevel: level })
                            }
                          >
                            {THINKING_LEVEL_LABELS[level]}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                ) : null}

                <label
                  className={`${styles.llmSettingsField} ${
                    hasPreflightFieldError("baseUrl")
                      ? styles.llmSettingsFieldInvalid
                      : ""
                  }`}
                >
                  <span className={styles.llmSettingsControlTitle}>
                    接口地址
                  </span>
                  <input
                    aria-invalid={
                      hasPreflightFieldError("baseUrl") ? true : undefined
                    }
                    value={draft.baseUrl}
                    placeholder={selectedModel?.defaultBaseUrl ?? ""}
                    onChange={(event) =>
                      updateDraft({ baseUrl: event.currentTarget.value })
                    }
                  />
                </label>
                <label
                  className={`${styles.llmSettingsField} ${
                    hasPreflightFieldError("apiKey")
                      ? styles.llmSettingsFieldInvalid
                      : ""
                  }`}
                >
                  <span className={styles.llmSettingsControlTitle}>ApiKey</span>
                  <input
                    type="text"
                    aria-invalid={
                      hasPreflightFieldError("apiKey") ? true : undefined
                    }
                    value={draft.apiKey}
                    placeholder={
                      selectedModel
                        ? LLM_API_KEY_PLACEHOLDERS[selectedModel.provider]
                        : "输入 API Key"
                    }
                    autoComplete="off"
                    onChange={(event) =>
                      updateDraft({ apiKey: event.currentTarget.value })
                    }
                  />
                </label>
              </div>
            </section>
          )}

          <>
            <button
              type="button"
              className={`${styles.llmTestButton} ${
                connectionStatus === "success"
                  ? styles.llmTestButtonSuccess
                  : ""
              } ${
                connectionStatus === "error" ? styles.llmTestButtonError : ""
              }`}
              disabled={isTestingConnection}
              onClick={() => {
                void onTestConnection();
              }}
            >
              {isTestingConnection ? (
                <LoaderCircle aria-hidden="true" />
              ) : connectionStatus === "success" ? (
                <Check aria-hidden="true" />
              ) : connectionStatus === "error" ? (
                <X aria-hidden="true" />
              ) : null}
              <span>
                {isTestingConnection
                  ? "正在测试连接"
                  : connectionStatus === "success"
                    ? "Succeed"
                    : connectionStatus === "error"
                      ? isPreflightLlmError
                        ? (connectionFeedback?.summary ?? "配置错误")
                        : "Failed"
                      : "测试连接状态"}
              </span>
            </button>

            {shouldShowLlmErrorDetails ? (
              <div className={styles.llmErrorDetails} role="alert">
                <div className={styles.llmErrorDetailsHeader}>
                  <span>错误</span>
                  {connectionFeedback?.code ? (
                    <code>{connectionFeedback.code}</code>
                  ) : null}
                </div>
                {connectionFeedback?.detail ? (
                  <p className={styles.llmErrorDetailText}>
                    {connectionFeedback.detail}
                  </p>
                ) : null}
                {connectionFeedback?.technicalDetail ? (
                  <div className={styles.llmErrorTechnicalCard}>
                    {connectionFeedback.technicalDetail}
                  </div>
                ) : null}
                {connectionFeedback?.meta.length ? (
                  <dl className={styles.llmErrorMeta}>
                    {connectionFeedback.meta.map((item) => (
                      <div key={`${item.label}:${item.value}`}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            ) : null}
          </>
        </div>
      </div>
      <div
        className={`${styles.llmSettingsScrollbar} ${
          detailScrollbarVisible && detailScrollbarMetrics.canScroll
            ? styles.llmSettingsScrollbarVisible
            : ""
        }`}
        aria-hidden="true"
        style={
          {
            "--llm-settings-scrollbar-thumb-height": `${detailScrollbarMetrics.thumbHeight}px`,
            "--llm-settings-scrollbar-thumb-top": `${detailScrollbarMetrics.thumbTop}px`,
          } as CSSProperties
        }
      >
        <span className={styles.llmSettingsScrollbarThumb} />
      </div>
      <div className={styles.llmSettingsFooter}>
        <div className={styles.llmSettingsFooterInner}>
          <button
            type="button"
            className={`${styles.llmSaveButton} ${
              isSaving ? styles.llmSaveButtonSaving : ""
            }`}
            disabled={!dirty || isTestingConnection || isSaving}
            onClick={() => {
              void onSave();
            }}
          >
            {isSaving ? <LoaderCircle aria-hidden="true" /> : null}
            <span>{isSaving ? "保存中" : "保存"}</span>
          </button>
        </div>
      </div>

      {unsavedDialogVisible ? (
        <div className={styles.llmUnsavedOverlay} role="alertdialog">
          <div className={styles.llmUnsavedDialog}>
            <h4>放弃未保存的修改？</h4>
            <p>当前 LLM 设置还没有保存，退出后本次修改会被丢弃。</p>
            <div className={styles.llmUnsavedActions}>
              <button type="button" onClick={onCancelClose}>
                继续编辑
              </button>
              <button
                type="button"
                className={styles.llmUnsavedDangerButton}
                onClick={onDiscardAndClose}
              >
                仍要退出
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ActorSearchSettingsDetail({
  draft,
  dirty,
  validationFeedback,
  isSaving,
  unsavedDialogVisible,
  onDraftChange,
  onSave,
  onCancelClose,
  onDiscardAndClose,
}: {
  draft: WebSearchSettingsDraft;
  dirty: boolean;
  validationFeedback: ReturnType<typeof validateWebSearchDraftBeforeSave>;
  isSaving: boolean;
  unsavedDialogVisible: boolean;
  onDraftChange: (draft: WebSearchSettingsDraft) => void;
  onSave: () => void | Promise<void>;
  onCancelClose: () => void;
  onDiscardAndClose: () => void;
}) {
  const apiKeyInvalid = Boolean(
    validationFeedback?.fields.includes("tavilyApiKey"),
  );

  function updateDraft(patch: Partial<WebSearchSettingsDraft>) {
    onDraftChange({
      ...draft,
      ...patch,
    });
  }

  return (
    <>
      <div className={styles.llmSettingsBody}>
        <div className={styles.llmSettingsContent}>
          <section className={styles.searchIntroCard} aria-label="Tavily 说明">
            <div className={styles.searchIntroIcon} aria-hidden="true">
              <Info />
            </div>
            <div className={styles.searchIntroContent}>
              <p>
                Tavily 是面向 AI 应用的搜索
                API，可为角色提供网页检索、资料补充和实时信息查询能力。
              </p>
              <p>免费额度：每月 1000 次搜索。</p>
              <a
                href="https://app.tavily.com/"
                target="_blank"
                rel="noreferrer"
                className={styles.searchIntroLink}
              >
                <span>获取 Tavily ApiKey</span>
                <SquareArrowOutUpRight aria-hidden="true" />
              </a>
            </div>
          </section>

          <button
            type="button"
            className={`${styles.llmGlobalSwitch} ${
              draft.enabled ? styles.llmGlobalSwitchOn : ""
            }`}
            role="switch"
            aria-checked={draft.enabled}
            onClick={() => updateDraft({ enabled: !draft.enabled })}
          >
            <span className={styles.llmSettingsItemText}>
              <span className={styles.llmSettingsItemTitle}>启用 Tavily</span>
              <span className={styles.llmSettingsItemDescription}>
                允许该角色使用 Tavily 进行网页搜索
              </span>
            </span>
            <span
              className={`${styles.actorSettingsSwitch} ${
                draft.enabled ? styles.actorSettingsSwitchOn : ""
              }`}
              aria-hidden="true"
            >
              <span className={styles.actorSettingsSwitchKnob} />
            </span>
          </button>

          <section
            className={`${styles.llmSettingsSection} ${styles.llmSettingsSectionEnter}`}
            aria-label="Tavily 配置"
          >
            <div className={styles.llmSettingsFields}>
              <label
                className={`${styles.llmSettingsField} ${
                  apiKeyInvalid ? styles.llmSettingsFieldInvalid : ""
                }`}
              >
                <span className={styles.llmSettingsControlTitle}>
                  Tavily ApiKey
                </span>
                <input
                  type="text"
                  aria-invalid={apiKeyInvalid ? true : undefined}
                  value={draft.tavilyApiKey}
                  placeholder="tvly-...abcd"
                  autoComplete="off"
                  onChange={(event) =>
                    updateDraft({ tavilyApiKey: event.currentTarget.value })
                  }
                />
              </label>
              {validationFeedback ? (
                <p className={styles.searchSettingsFieldHint} role="alert">
                  {validationFeedback.summary}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
      <div className={styles.llmSettingsFooter}>
        <div className={styles.llmSettingsFooterInner}>
          <button
            type="button"
            className={`${styles.llmSaveButton} ${
              isSaving ? styles.llmSaveButtonSaving : ""
            }`}
            disabled={!dirty || isSaving}
            onClick={() => {
              void onSave();
            }}
          >
            {isSaving ? <LoaderCircle aria-hidden="true" /> : null}
            <span>{isSaving ? "保存中" : "保存"}</span>
          </button>
        </div>
      </div>

      {unsavedDialogVisible ? (
        <div className={styles.llmUnsavedOverlay} role="alertdialog">
          <div className={styles.llmUnsavedDialog}>
            <h4>放弃未保存的修改？</h4>
            <p>当前搜索设置还没有保存，退出后本次修改会被丢弃。</p>
            <div className={styles.llmUnsavedActions}>
              <button type="button" onClick={onCancelClose}>
                继续编辑
              </button>
              <button
                type="button"
                className={styles.llmUnsavedDangerButton}
                onClick={onDiscardAndClose}
              >
                仍要退出
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ActorQqSettingsDetail({
  actorId,
  savedSettings,
  draft,
  dirty,
  validationFeedback,
  isSaving,
  isSwitching,
  isConnectionConnecting,
  unsavedDialogVisible,
  onDraftChange,
  onToggleEnabled,
  onConnectionStateChange,
  onSave,
  onSaveConversations,
  onCancelClose,
  onDiscardAndClose,
}: {
  actorId: string;
  savedSettings: QqSettingsDraft;
  draft: QqSettingsDraft;
  dirty: boolean;
  validationFeedback: ReturnType<typeof validateQqDraftBeforeSave>;
  isSaving: boolean;
  isSwitching: boolean;
  isConnectionConnecting: boolean;
  unsavedDialogVisible: boolean;
  onDraftChange: (draft: QqSettingsDraft) => void;
  onToggleEnabled: () => void | Promise<void>;
  onConnectionStateChange: (state: {
    transportStatus: ActorQQTransportStatus;
    blockedBy: ActorQQBlockedBy;
  }) => void;
  onSave: () => boolean | Promise<boolean>;
  onSaveConversations: (
    conversations: QqConversationDraft[],
    messages: { success: string; failure: string },
  ) => boolean | Promise<boolean>;
  onCancelClose: () => void;
  onDiscardAndClose: () => void;
}) {
  const [editorState, setEditorState] =
    useState<QqConversationEditorState | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const detailScrollbarVisibleRef = useRef(false);
  const detailScrollbarIdleTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [detailScrollbarVisible, setDetailScrollbarVisible] = useState(false);
  const [detailScrollbarMetrics, setDetailScrollbarMetrics] = useState({
    canScroll: false,
    thumbHeight: 0,
    thumbTop: 0,
  });
  const wsUrlInvalid = Boolean(validationFeedback?.fields.includes("wsUrl"));
  const accessTokenInvalid = Boolean(
    validationFeedback?.fields.includes("accessToken"),
  );
  const enableSwitchLocked =
    !savedSettings.enabled &&
    (!savedSettings.wsUrl.trim() || !savedSettings.accessToken.trim());
  const switchDisabled =
    isSaving || isSwitching || isConnectionConnecting || enableSwitchLocked;
  const switchTitle = enableSwitchLocked
    ? "请先保存 ws 地址和 token"
    : isConnectionConnecting
      ? "正在连接，暂不能切换"
      : undefined;
  const deleteTarget =
    draft.conversations.find(
      (conversation) => conversation.id === deleteTargetId,
    ) ?? null;

  function updateDraft(patch: Partial<QqSettingsDraft>) {
    const nextDraft = {
      ...draft,
      ...patch,
    };
    onDraftChange(nextDraft);
    return nextDraft;
  }

  function updateConversationEditor(patch: Partial<QqConversationDraft>) {
    setEditorState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        draft: {
          ...current.draft,
          ...patch,
        },
        validation: null,
      };
    });
  }

  function openCreateConversationDialog() {
    setEditorState({
      mode: "create",
      draft: createEmptyQqConversationDraft(),
      validation: null,
    });
  }

  function openEditConversationDialog(conversation: QqConversationDraft) {
    setEditorState({
      mode: "edit",
      draft: { ...conversation },
      original: { ...conversation },
      validation: null,
    });
  }

  async function commitConversationEditor() {
    if (!editorState) {
      return;
    }

    const validation = validateQqConversationDraft(editorState.draft);
    if (validation) {
      setEditorState({
        ...editorState,
        validation,
      });
      return;
    }

    const normalizedConversation: QqConversationDraft = {
      ...editorState.draft,
      uid: editorState.draft.uid.trim(),
      name: editorState.draft.name.trim(),
      description: editorState.draft.description.trim(),
    };

    if (
      editorState.mode === "create" &&
      draft.conversations.some(
        (conversation) =>
          conversation.type === normalizedConversation.type &&
          conversation.uid.trim() === normalizedConversation.uid,
      )
    ) {
      setEditorState({
        ...editorState,
        draft: normalizedConversation,
        validation: {
          summary: "会话已存在",
          detail: "相同类型和账号只会对应一个 QQ 会话。",
          fields: ["uid"],
        },
      });
      return;
    }

    if (
      editorState.mode === "edit" &&
      editorState.original &&
      areQqConversationsEqual(normalizedConversation, editorState.original)
    ) {
      return;
    }

    const nextConversations =
      editorState.mode === "create"
        ? [...draft.conversations, normalizedConversation]
        : draft.conversations.map((conversation) =>
            conversation.id === normalizedConversation.id
              ? normalizedConversation
              : conversation,
          );

    const saved = await onSaveConversations(nextConversations, {
      success:
        editorState.mode === "create"
          ? `已添加会话 ${formatQqSessionId(normalizedConversation)}`
          : "保存成功",
      failure: editorState.mode === "create" ? "添加失败" : "保存失败",
    });

    if (saved) {
      setEditorState(null);
    }
  }

  async function deleteConversation(conversationId: string) {
    const deletingConversation = draft.conversations.find(
      (conversation) => conversation.id === conversationId,
    );
    const nextConversations = draft.conversations.filter(
      (conversation) => conversation.id !== conversationId,
    );
    const saved = await onSaveConversations(nextConversations, {
      success: deletingConversation
        ? `已删除会话 ${formatQqSessionId(deletingConversation)}`
        : "删除成功",
      failure: "删除失败",
    });

    if (saved) {
      setDeleteTargetId(null);
    }
  }

  function syncDetailScrollbarMetrics() {
    const scrollElement = detailScrollRef.current;
    if (!scrollElement) {
      return;
    }

    const trackHeight = scrollElement.clientHeight;
    const maxScrollTop = Math.max(
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight,
    );
    const canScroll = maxScrollTop > 1 && trackHeight > 0;
    const thumbHeight = canScroll
      ? Math.min(
          trackHeight,
          Math.max(
            MESSAGE_SCROLLBAR_MIN_THUMB_HEIGHT,
            (trackHeight * scrollElement.clientHeight) /
              scrollElement.scrollHeight,
          ),
        )
      : 0;
    const thumbTop = canScroll
      ? ((trackHeight - thumbHeight) * scrollElement.scrollTop) / maxScrollTop
      : 0;

    setDetailScrollbarMetrics((current) => {
      const next = {
        canScroll,
        thumbHeight: Math.round(thumbHeight),
        thumbTop: Math.round(thumbTop),
      };

      if (
        current.canScroll === next.canScroll &&
        current.thumbHeight === next.thumbHeight &&
        current.thumbTop === next.thumbTop
      ) {
        return current;
      }

      return next;
    });
  }

  function setDetailScrollbarShown(visible: boolean) {
    detailScrollbarVisibleRef.current = visible;
    setDetailScrollbarVisible(visible);
  }

  function clearDetailScrollbarIdleTimer() {
    if (detailScrollbarIdleTimerRef.current === null) {
      return;
    }

    clearTimeout(detailScrollbarIdleTimerRef.current);
    detailScrollbarIdleTimerRef.current = null;
  }

  function scheduleDetailScrollbarHide() {
    clearDetailScrollbarIdleTimer();
    detailScrollbarIdleTimerRef.current = setTimeout(() => {
      setDetailScrollbarShown(false);
      detailScrollbarIdleTimerRef.current = null;
    }, MESSAGE_SCROLLBAR_IDLE_DELAY);
  }

  function showDetailScrollbarForActivity() {
    syncDetailScrollbarMetrics();

    if (!detailScrollbarVisibleRef.current) {
      setDetailScrollbarShown(true);
    }

    scheduleDetailScrollbarHide();
  }

  useEffect(() => {
    return () => {
      if (detailScrollbarIdleTimerRef.current !== null) {
        clearTimeout(detailScrollbarIdleTimerRef.current);
      }
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    const scrollElement = detailScrollRef.current;
    if (!scrollElement) {
      return undefined;
    }

    syncDetailScrollbarMetrics();
    const resizeObserver = new ResizeObserver(syncDetailScrollbarMetrics);
    resizeObserver.observe(scrollElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [draft.conversations.length, editorState, deleteTargetId]);

  return (
    <>
      <div
        ref={detailScrollRef}
        className={styles.llmSettingsBody}
        onPointerEnter={showDetailScrollbarForActivity}
        onPointerMove={showDetailScrollbarForActivity}
        onPointerLeave={scheduleDetailScrollbarHide}
        onScroll={showDetailScrollbarForActivity}
      >
        <div className={styles.llmSettingsContent}>
          <section
            className={styles.searchIntroCard}
            aria-label="NapCatQQ 说明"
          >
            <div className={styles.searchIntroIcon} aria-hidden="true">
              <Info />
            </div>
            <div className={styles.searchIntroContent}>
              <p>使用 NapCatQQ 将角色接入 QQ 平台。</p>
              <ol className={styles.qqIntroSteps}>
                <li>部署 NapCatQQ</li>
                <li>开启 WebSocket 服务端</li>
                <li>获取 ws 地址和 token</li>
              </ol>
              <a
                href="https://napneko.github.io/"
                target="_blank"
                rel="noreferrer"
                className={styles.searchIntroLink}
              >
                <span>NapCatQQ官网</span>
                <SquareArrowOutUpRight aria-hidden="true" />
              </a>
            </div>
          </section>

          <button
            type="button"
            className={`${styles.llmGlobalSwitch} ${
              draft.enabled ? styles.llmGlobalSwitchOn : ""
            }`}
            role="switch"
            aria-checked={draft.enabled}
            aria-busy={isSwitching ? true : undefined}
            disabled={switchDisabled}
            title={switchTitle}
            onClick={() => {
              void onToggleEnabled();
            }}
          >
            <span className={styles.llmSettingsItemText}>
              <span className={styles.llmSettingsItemTitle}>启用 NapCatQQ</span>
              <span className={styles.llmSettingsItemDescription}>
                {enableSwitchLocked
                  ? "请先保存 ws 地址和 token"
                  : "允许该角色通过 NapCatQQ 接收并响应 QQ 会话"}
              </span>
            </span>
            <span
              className={`${styles.actorSettingsSwitch} ${
                draft.enabled ? styles.actorSettingsSwitchOn : ""
              } ${isSwitching ? styles.actorSettingsSwitchLoading : ""}`}
              aria-hidden="true"
            >
              <span className={styles.actorSettingsSwitchKnob}>
                {isSwitching ? <LoaderCircle aria-hidden="true" /> : null}
              </span>
            </span>
          </button>

          <section
            className={`${styles.llmSettingsSection} ${styles.llmSettingsSectionEnter}`}
            aria-label="NapCatQQ 连接配置"
          >
            <div className={styles.llmSettingsFields}>
              <label
                className={`${styles.llmSettingsField} ${
                  wsUrlInvalid ? styles.llmSettingsFieldInvalid : ""
                }`}
              >
                <span className={styles.llmSettingsControlTitle}>ws地址</span>
                <input
                  type="text"
                  aria-invalid={wsUrlInvalid ? true : undefined}
                  value={draft.wsUrl}
                  placeholder="ws://127.0.0.1:3001"
                  autoComplete="off"
                  onChange={(event) =>
                    updateDraft({ wsUrl: event.currentTarget.value })
                  }
                />
              </label>
              <label
                className={`${styles.llmSettingsField} ${
                  accessTokenInvalid ? styles.llmSettingsFieldInvalid : ""
                }`}
              >
                <span className={styles.llmSettingsControlTitle}>token</span>
                <input
                  type="text"
                  aria-invalid={accessTokenInvalid ? true : undefined}
                  value={draft.accessToken}
                  placeholder="napcat-...token"
                  autoComplete="off"
                  onChange={(event) =>
                    updateDraft({ accessToken: event.currentTarget.value })
                  }
                />
              </label>
              {validationFeedback ? (
                <p className={styles.searchSettingsFieldHint} role="alert">
                  {validationFeedback.summary}
                </p>
              ) : null}
            </div>
          </section>

          <QqConnectionStatusCard
            key={`${savedSettings.enabled}:${savedSettings.wsUrl}:${savedSettings.accessToken}`}
            actorId={actorId}
            savedSettings={savedSettings}
            onStateChange={onConnectionStateChange}
          />

          <section
            className={`${styles.qqConversationSection} ${styles.llmSettingsSectionEnter}`}
            aria-label="QQ 会话配置"
          >
            <div className={styles.qqConversationHeader}>
              <div>
                <div className={styles.qqConversationHeaderTitleRow}>
                  <span className={styles.llmSettingsControlTitle}>会话</span>
                  <span className={styles.qqConversationCount}>
                    {draft.conversations.length}
                  </span>
                </div>
                <p>配置角色参与的私聊或群聊</p>
              </div>
              <button
                type="button"
                className={styles.qqConversationAddButton}
                onClick={openCreateConversationDialog}
              >
                <Plus aria-hidden="true" />
                <span>添加会话</span>
              </button>
            </div>

            {draft.conversations.length > 0 ? (
              <div className={styles.qqConversationList}>
                {draft.conversations.map((conversation) => (
                  <article
                    key={conversation.id}
                    className={styles.qqConversationCard}
                    role="button"
                    tabIndex={0}
                    aria-label={`编辑 ${conversation.name || "未命名会话"}`}
                    onClick={() => openEditConversationDialog(conversation)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") {
                        return;
                      }

                      event.preventDefault();
                      openEditConversationDialog(conversation);
                    }}
                  >
                    <div
                      className={`${styles.qqConversationIcon} ${
                        conversation.type === "group"
                          ? styles.qqConversationIconGroup
                          : styles.qqConversationIconChat
                      }`}
                      aria-hidden="true"
                    >
                      {conversation.type === "group" ? <Users /> : <User />}
                    </div>
                    <div className={styles.qqConversationMain}>
                      <div className={styles.qqConversationTitleRow}>
                        <strong>{conversation.name || "未命名会话"}</strong>
                        <span>
                          {formatQqConversationType(conversation.type)}
                        </span>
                      </div>
                      <p>{conversation.description || "暂无描述"}</p>
                      <div className={styles.qqConversationMeta}>
                        <span
                          className={
                            conversation.allowProactive
                              ? styles.qqConversationProactiveMeta
                              : styles.qqConversationPassiveMeta
                          }
                        >
                          {conversation.allowProactive ? (
                            <MessageSquareMore aria-hidden="true" />
                          ) : (
                            <MessageSquareOff aria-hidden="true" />
                          )}
                          {conversation.allowProactive
                            ? "主动对话"
                            : "被动响应"}
                        </span>
                        <span className={styles.qqConversationSessionMeta}>
                          {formatQqSessionId(conversation)}
                        </span>
                      </div>
                    </div>
                    <div className={styles.qqConversationActions}>
                      <button
                        type="button"
                        aria-label={`编辑 ${conversation.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditConversationDialog(conversation);
                        }}
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`删除 ${conversation.name}`}
                        className={styles.qqConversationDeleteButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteTargetId(conversation.id);
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.qqConversationEmpty}>
                <span>没有QQ会话</span>
              </div>
            )}
          </section>
        </div>
      </div>
      <div
        className={`${styles.llmSettingsScrollbar} ${
          detailScrollbarVisible && detailScrollbarMetrics.canScroll
            ? styles.llmSettingsScrollbarVisible
            : ""
        }`}
        aria-hidden="true"
        style={
          {
            "--llm-settings-scrollbar-thumb-height": `${detailScrollbarMetrics.thumbHeight}px`,
            "--llm-settings-scrollbar-thumb-top": `${detailScrollbarMetrics.thumbTop}px`,
          } as CSSProperties
        }
      >
        <span className={styles.llmSettingsScrollbarThumb} />
      </div>
      <div className={styles.llmSettingsFooter}>
        <div className={styles.llmSettingsFooterInner}>
          <button
            type="button"
            className={`${styles.llmSaveButton} ${
              isSaving ? styles.llmSaveButtonSaving : ""
            }`}
            disabled={!dirty || isSaving || isSwitching}
            onClick={() => {
              void onSave();
            }}
          >
            {isSaving ? <LoaderCircle aria-hidden="true" /> : null}
            <span>{isSaving ? "保存中" : "保存"}</span>
          </button>
        </div>
      </div>

      {editorState ? (
        <QqConversationEditorDialog
          state={editorState}
          isSaving={isSaving}
          isDirty={
            editorState.mode === "create" ||
            !editorState.original ||
            !areQqConversationsEqual(editorState.draft, editorState.original)
          }
          onChange={updateConversationEditor}
          onCancel={() => setEditorState(null)}
          onConfirm={() => {
            void commitConversationEditor();
          }}
        />
      ) : null}

      {deleteTarget ? (
        <QqDeleteConversationDialog
          conversation={deleteTarget}
          isSaving={isSaving}
          onCancel={() => setDeleteTargetId(null)}
          onConfirm={() => {
            void deleteConversation(deleteTarget.id);
          }}
        />
      ) : null}

      {unsavedDialogVisible ? (
        <div className={styles.llmUnsavedOverlay} role="alertdialog">
          <div className={styles.llmUnsavedDialog}>
            <h4>放弃未保存的修改？</h4>
            <p>当前 QQ 设置还没有保存，退出后本次修改会被丢弃。</p>
            <div className={styles.llmUnsavedActions}>
              <button type="button" onClick={onCancelClose}>
                继续编辑
              </button>
              <button
                type="button"
                className={styles.llmUnsavedDangerButton}
                onClick={onDiscardAndClose}
              >
                仍要退出
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function deriveQqConnectionState(settings: QqSettingsDraft): {
  transportStatus: ActorQQTransportStatus;
  blockedBy: ActorQQBlockedBy;
  endpoint: string;
} {
  if (!settings.enabled) {
    return {
      transportStatus: "disconnected",
      blockedBy: "qq_disabled",
      endpoint: settings.wsUrl.trim(),
    };
  }

  return {
    transportStatus: "connecting",
    blockedBy: null,
    endpoint: settings.wsUrl.trim(),
  };
}

function getQqConnectionStatusClass(connection: {
  transportStatus: ActorQQTransportStatus;
  blockedBy: ActorQQBlockedBy;
}) {
  if (connection.blockedBy === "qq_disabled") {
    return "disabled";
  }
  if (connection.blockedBy === "actor_offline") {
    return "offline";
  }
  return connection.transportStatus;
}

function getQqConnectionStatusMeta(connection: {
  transportStatus: ActorQQTransportStatus;
  blockedBy: ActorQQBlockedBy;
}): {
  title: string;
  detail: string;
  icon: "connected" | "disconnected" | "connecting";
} {
  if (connection.blockedBy === "qq_disabled") {
    return {
      title: "NapCatQQ 未启用",
      detail: "NapCatQQ 未启用，当前不会接入 QQ。",
      icon: "disconnected",
    };
  }
  if (connection.blockedBy === "actor_offline") {
    return {
      title: "角色未启用",
      detail: "角色未启用，QQ 通道暂未启动。",
      icon: "disconnected",
    };
  }
  if (connection.transportStatus === "connected") {
    return {
      title: "已连接",
      detail: "",
      icon: "connected",
    };
  }
  if (connection.transportStatus === "connecting") {
    return {
      title: "正在连接",
      detail: "",
      icon: "connecting",
    };
  }
  return {
    title: "未连接",
    detail: "",
    icon: "disconnected",
  };
}

function QqConnectionStatusCard({
  actorId,
  savedSettings,
  onStateChange,
}: {
  actorId: string;
  savedSettings: QqSettingsDraft;
  onStateChange?: (state: {
    transportStatus: ActorQQTransportStatus;
    blockedBy: ActorQQBlockedBy;
  }) => void;
}) {
  const [connection, setConnection] = useState<{
    transportStatus: ActorQQTransportStatus;
    blockedBy: ActorQQBlockedBy;
    endpoint: string;
  }>(() => deriveQqConnectionState(savedSettings));
  const syncRunRef = useRef(0);
  const shouldSyncConnection =
    savedSettings.enabled &&
    Boolean(savedSettings.wsUrl.trim()) &&
    Boolean(savedSettings.accessToken.trim());

  useEffect(() => {
    onStateChange?.({
      transportStatus: connection.transportStatus,
      blockedBy: connection.blockedBy,
    });
  }, [connection.blockedBy, connection.transportStatus, onStateChange]);

  const syncConnectionStatus = useCallback(
    async (
      reason: ActorQQConnectionSyncReason,
      { silent = false }: { silent?: boolean } = {},
    ) => {
      if (!shouldSyncConnection) {
        return;
      }

      const endpoint = savedSettings.wsUrl.trim();
      const runId = ++syncRunRef.current;
      if (!silent) {
        setConnection({
          transportStatus: "connecting",
          blockedBy: null,
          endpoint,
        });
      }

      try {
        const response = await syncActorQqConnectionStatus(actorId, reason);
        if (runId !== syncRunRef.current) {
          return;
        }

        setConnection({
          transportStatus: response.connection.transportStatus,
          blockedBy: response.connection.blockedBy,
          endpoint: response.connection.endpoint || endpoint,
        });
      } catch {
        if (runId !== syncRunRef.current) {
          return;
        }

        setConnection({
          transportStatus: "disconnected",
          blockedBy: null,
          endpoint,
        });
      }
    },
    [actorId, savedSettings.wsUrl, shouldSyncConnection],
  );

  useEffect(() => {
    if (!shouldSyncConnection) {
      return undefined;
    }

    const timer = setTimeout(() => {
      void syncConnectionStatus("configChanged");
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [shouldSyncConnection, syncConnectionStatus]);

  useEffect(() => {
    const subscription = subscribeEmaEvents(
      ["channel.qq.connection.changed"],
      (event) => {
        if (
          event.type !== "channel.qq.connection.changed" ||
          event.actorId !== actorId
        ) {
          return;
        }
        setConnection({
          transportStatus: event.data.transportStatus,
          blockedBy: event.data.blockedBy,
          endpoint: event.data.endpoint || savedSettings.wsUrl.trim(),
        });
      },
    );

    return () => subscription.close();
  }, [actorId, savedSettings.wsUrl]);

  useEffect(() => {
    if (!shouldSyncConnection) {
      return undefined;
    }

    const timer = setInterval(() => {
      void syncConnectionStatus("poll", { silent: true });
    }, 10000);

    return () => {
      clearInterval(timer);
    };
  }, [shouldSyncConnection, syncConnectionStatus]);

  const meta = getQqConnectionStatusMeta(connection);
  const effectiveWsUrl = connection.endpoint || savedSettings.wsUrl.trim();
  const statusClass = getQqConnectionStatusClass(connection);

  return (
    <section
      className={`${styles.qqStatusCard} ${styles[`qqStatusCard_${statusClass}`]}`}
      aria-label="QQ 连接状态"
    >
      <div className={styles.qqStatusIcon} aria-hidden="true">
        {meta.icon === "connected" ? (
          <LinkIcon />
        ) : meta.icon === "disconnected" ? (
          <Unlink />
        ) : (
          <LoaderCircle />
        )}
      </div>
      <div className={styles.qqStatusContent}>
        <div className={styles.qqStatusTitleRow}>
          <span>连接状态</span>
          <strong>{meta.title}</strong>
        </div>
        <p className={styles.qqStatusDetail}>
          {connection.blockedBy === null &&
          connection.transportStatus === "connected" ? (
            <>
              已连接到 <code>{effectiveWsUrl}</code>
            </>
          ) : connection.blockedBy === null &&
            connection.transportStatus === "connecting" ? (
            <>
              正在连接 <code>{effectiveWsUrl}</code>
            </>
          ) : connection.blockedBy === null &&
            connection.transportStatus === "disconnected" ? (
            <>
              未连接到 <code>{effectiveWsUrl}</code>，
              <button
                type="button"
                onClick={() => {
                  void syncConnectionStatus("retry");
                }}
              >
                点击尝试重连
              </button>
              。
            </>
          ) : (
            meta.detail
          )}
        </p>
      </div>
    </section>
  );
}

function QqConversationEditorDialog({
  state,
  isSaving,
  isDirty,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: QqConversationEditorState;
  isSaving: boolean;
  isDirty: boolean;
  onChange: (patch: Partial<QqConversationDraft>) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const uidInvalid = Boolean(state.validation?.fields.includes("uid"));
  const nameInvalid = Boolean(state.validation?.fields.includes("name"));
  const identityLocked = state.mode === "edit";

  function handleDescriptionChange(
    event: ReactChangeEvent<HTMLTextAreaElement>,
  ) {
    onChange({ description: event.currentTarget.value });
  }

  return (
    <div className={styles.qqDialogOverlay} role="dialog" aria-modal="true">
      <div className={styles.qqDialog}>
        <div className={styles.qqDialogHeader}>
          <div>
            <h4>{state.mode === "create" ? "添加 QQ 会话" : "编辑 QQ 会话"}</h4>
            <p>
              {state.draft.type === "group"
                ? "群聊会话会对应一个 QQ 群号"
                : "私聊会话会对应一个 QQ 号"}
            </p>
          </div>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            <X aria-hidden="true" />
          </button>
        </div>

        <div className={styles.qqDialogBody}>
          <div className={styles.llmSettingsControl}>
            <span className={styles.llmSettingsControlTitle}>会话类型</span>
            <div
              className={styles.llmEndpointTabs}
              role="tablist"
              aria-label="选择 QQ 会话类型"
            >
              {(["chat", "group"] satisfies QqConversationType[]).map(
                (type) => (
                  <button
                    key={type}
                    type="button"
                    role="tab"
                    aria-selected={state.draft.type === type}
                    disabled={identityLocked}
                    className={`${styles.llmEndpointTab} ${
                      state.draft.type === type
                        ? styles.llmEndpointTabActive
                        : ""
                    }`}
                    onClick={() => onChange({ type })}
                  >
                    {formatQqConversationType(type)}
                  </button>
                ),
              )}
            </div>
          </div>

          <label
            className={`${styles.llmSettingsField} ${
              uidInvalid ? styles.llmSettingsFieldInvalid : ""
            }`}
          >
            <span className={styles.llmSettingsControlTitle}>
              {state.draft.type === "group" ? "群号" : "QQ号"}
            </span>
            <input
              type="text"
              aria-invalid={uidInvalid ? true : undefined}
              value={state.draft.uid}
              inputMode="numeric"
              disabled={identityLocked}
              onChange={(event) => onChange({ uid: event.currentTarget.value })}
            />
          </label>

          <label
            className={`${styles.llmSettingsField} ${
              nameInvalid ? styles.llmSettingsFieldInvalid : ""
            }`}
          >
            <span className={styles.llmSettingsControlTitle}>名称</span>
            <input
              type="text"
              aria-invalid={nameInvalid ? true : undefined}
              value={state.draft.name}
              onChange={(event) =>
                onChange({ name: event.currentTarget.value })
              }
            />
          </label>

          <label className={styles.llmSettingsField}>
            <span className={styles.llmSettingsControlTitle}>描述</span>
            <textarea
              className={styles.qqConversationTextarea}
              value={state.draft.description}
              placeholder="这段描述会帮助角色理解该会话的使用场景"
              rows={3}
              onChange={handleDescriptionChange}
            />
          </label>

          <button
            type="button"
            className={`${styles.llmGlobalSwitch} ${
              state.draft.allowProactive ? styles.llmGlobalSwitchOn : ""
            }`}
            role="switch"
            aria-checked={state.draft.allowProactive}
            onClick={() =>
              onChange({ allowProactive: !state.draft.allowProactive })
            }
          >
            <span className={styles.llmSettingsItemText}>
              <span className={styles.llmSettingsItemTitle}>参与主动对话</span>
              <span className={styles.llmSettingsItemDescription}>
                允许角色在该会话中主动发起或延续话题
              </span>
            </span>
            <span
              className={`${styles.actorSettingsSwitch} ${
                state.draft.allowProactive ? styles.actorSettingsSwitchOn : ""
              }`}
              aria-hidden="true"
            >
              <span className={styles.actorSettingsSwitchKnob} />
            </span>
          </button>

          {state.validation ? (
            <p className={styles.searchSettingsFieldHint} role="alert">
              {state.validation.summary}
            </p>
          ) : null}
        </div>

        <div className={styles.qqDialogActions}>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            disabled={isSaving || !isDirty}
            onClick={onConfirm}
          >
            {isSaving ? <LoaderCircle aria-hidden="true" /> : null}
            <span>
              {isSaving ? "保存中" : state.mode === "create" ? "添加" : "保存"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function QqDeleteConversationDialog({
  conversation,
  isSaving,
  onCancel,
  onConfirm,
}: {
  conversation: QqConversationDraft;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className={styles.llmUnsavedOverlay} role="alertdialog">
      <div className={styles.llmUnsavedDialog}>
        <h4>删除会话？</h4>
        <p>确定删除「{formatQqSessionId(conversation)}」吗？</p>
        <div className={styles.llmUnsavedActions}>
          <button type="button" disabled={isSaving} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={styles.llmUnsavedDangerButton}
            disabled={isSaving}
            onClick={onConfirm}
          >
            {isSaving ? "删除中" : "删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
