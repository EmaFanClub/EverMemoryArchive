export type ActorRuntimeStatus = "offline" | "sleep" | "online" | "busy";
export type ActorRuntimeTransition =
  | "booting"
  | "shutting_down"
  | "waking"
  | "sleeping"
  | null;
export type EmbeddingProvider = "google";
export type LlmModelProvider =
  | "google"
  | "openai"
  | "anthropic"
  | "deepseek"
  | "zai"
  | "moonshot"
  | "qwen";
export type LlmThinkingLevel = "none" | "low" | "medium" | "high" | "xhigh";
export type ActorSettingsCheckStatus = "passed" | "failed";
export type ActorSettingsSaveStatus = "saved" | "failed";
export type ActorSettingsCheckErrorCode =
  | "INVALID_CONFIG"
  | "UNSUPPORTED"
  | "LLM_PROVIDER_ERROR"
  | "LLM_NETWORK_ERROR"
  | "EMBEDDING_PROVIDER_ERROR"
  | "EMBEDDING_NETWORK_ERROR"
  | "CHECK_FAILED";
export type ActorSettingsSaveErrorCode =
  | "INVALID_CONFIG"
  | "DATABASE_WRITE_FAILED"
  | "CHECK_FAILED";
export type ActorSettingsDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | boolean[];
export type ActorSettingsDiagnostics = Record<
  string,
  ActorSettingsDiagnosticValue
>;

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

export interface EmbeddingModelOption {
  model: string;
  provider: EmbeddingProvider;
  defaultBaseUrl: string;
  capabilities: {
    dimensions: number[];
  };
  requestDefaults: {
    dimensions?: number;
  };
}

export interface DashboardUserProfile {
  id: string;
  name: string;
}

export interface ActorSettingsSnapshot {
  llm?: ActorLlmConfig;
  webSearch?: ActorWebSearchConfig;
  qq?: ActorQQConfig;
}

export type ActorTrainingStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface ActorTrainingUiState {
  status: ActorTrainingStatus;
  characterName: string;
  description: string;
  sourceFileName?: string;
  errorMessage?: string;
  totalMessages: number;
  processedMessages: number;
  dayCount: number;
  startTime: string;
  endTime: string;
  progress: number;
  startedAt: number;
  updatedAt: number;
  estimatedRemainingMs: number | null;
  logs: string[];
}

export interface ActorSummary {
  id: string;
  name: string;
  status: ActorRuntimeStatus;
  transition: ActorRuntimeTransition;
  sleepSchedule?: {
    startMinutes: number;
    endMinutes: number;
  };
  latestPreview?: {
    text: string;
    time: number;
  };
  settings?: ActorSettingsSnapshot;
  training?: ActorTrainingUiState;
}

export const TOKEN_USAGE_SOURCES = [
  "chat",
  "activity",
  "conversation_rollup",
  "memory_rollup",
  "wake",
  "sleep",
  "training",
] as const;

export type TokenUsageSource = (typeof TOKEN_USAGE_SOURCES)[number];

export const TOKEN_USAGE_RANGE_OPTIONS = [
  { id: "today", label: "今天" },
  { id: "week", label: "7天" },
  { id: "month", label: "30天" },
  { id: "all", label: "全部" },
] as const;

export type TokenUsageRange = (typeof TOKEN_USAGE_RANGE_OPTIONS)[number]["id"];

export const TOKEN_USAGE_SOURCE_LABELS: Record<TokenUsageSource, string> = {
  chat: "聊天",
  activity: "活动生成",
  conversation_rollup: "会话总结",
  memory_rollup: "记忆整理",
  wake: "唤醒",
  sleep: "睡眠",
  training: "训练",
};

export function isTokenUsageRange(value: string): value is TokenUsageRange {
  return TOKEN_USAGE_RANGE_OPTIONS.some((option) => option.id === value);
}

export function tokenUsageRangeLabel(range: TokenUsageRange): string {
  return (
    TOKEN_USAGE_RANGE_OPTIONS.find((option) => option.id === range)?.label ??
    "今天"
  );
}

export interface TokenUsageTotals {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ActorTokenUsageSourceSummary extends TokenUsageTotals {
  source: TokenUsageSource;
}

export interface ActorTokenUsageDaySummary extends TokenUsageTotals {
  date: string;
}

export interface ActorTokenUsageSummaryResponse {
  apiVersion: "v1beta1";
  actorId: string;
  range: TokenUsageRange;
  rangeLabel: string;
  total: TokenUsageTotals;
  bySource: ActorTokenUsageSourceSummary[];
  trendByDay: ActorTokenUsageDaySummary[];
}

export interface ActorActivityState {
  enabled: boolean;
  status: ActorRuntimeStatus;
  transition: ActorRuntimeTransition;
  switching: boolean;
  updatedAt: string;
}

export interface ActorActivityUpdateRequest {
  requestId?: string;
  enabled: boolean;
}

export interface ActorActivityUpdateResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  actorId: string;
  activity: ActorActivityState;
  error?: {
    code: "ACTIVITY_SWITCH_FAILED";
    retryable: boolean;
    message: string;
  };
}

export interface DashboardOverviewResponse {
  apiVersion: "v1beta1";
  generatedAt: string;
  user: DashboardUserProfile;
  actors: ActorSummary[];
}

export interface OwnerResponse {
  apiVersion: "v1beta1";
  user: DashboardUserProfile;
}

export interface ActorListResponse {
  apiVersion: "v1beta1";
  generatedAt: string;
  actors: ActorSummary[];
}

export interface ActorSettingsResponse {
  apiVersion: "v1beta1";
  actorId: string;
  settings: ActorSettingsSnapshot;
  global: {
    llm: ActorLlmConfig;
    llmModels: LlmModelOption[];
    embedding: GlobalEmbeddingConfig;
    webSearch: ActorWebSearchConfig;
  };
}

export interface ActorConversationInfo {
  id: string;
  session: string;
  name: string;
  description: string;
  allowProactive: boolean;
}

export interface ActorConversationResponse {
  apiVersion: "v1beta1";
  actorId: string;
  conversation: ActorConversationInfo;
}

export interface ActorConversationSaveRequest {
  requestId?: string;
  conversation: Pick<ActorConversationInfo, "name" | "description">;
}

export interface ActorConversationPatchRequest {
  requestId?: string;
  patch: Partial<Pick<ActorConversationInfo, "allowProactive">>;
}

export interface ActorConversationMutationResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  actorId: string;
  conversation?: ActorConversationInfo;
  error?: {
    code: "INVALID_CONFIG" | "CONVERSATION_NOT_FOUND";
    retryable: boolean;
    message: string;
  };
}

export interface CreateActorRequest {
  name: string;
  avatarUrl?: string;
  roleBook: string;
  sleepSchedule: {
    startMinutes: number;
    endMinutes: number;
  };
  training?: CreateActorTrainingRequest;
}

export interface CreateActorResponse {
  apiVersion: "v1beta1";
  actor: ActorSummary;
}

export interface ActorDeleteResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  actorId: string;
}

export interface ActorTrainingStartResponse {
  apiVersion: "v1beta1";
  actor: ActorSummary;
}

export interface ActorTrainingClearResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  actorId: string;
}

export interface CreateActorTrainingMessage {
  name: string;
  time: string;
  content: string;
}

export interface CreateActorTrainingDataset {
  description: string;
  inputs: CreateActorTrainingMessage[];
}

export interface CreateActorTrainingRequest {
  characterName: string;
  sourceFileName?: string;
  dataset: CreateActorTrainingDataset;
}

/** Actor-scoped LLM config DTO mirrored from EMA's AgentHub LLMConfig. */
export interface ActorLlmConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  thinkingLevel?: LlmThinkingLevel;
}

export interface ActorLlmCheckRequest {
  requestId?: string;
  attempt?: number;
  config: ActorLlmConfig;
}

export interface ActorLlmCheckResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  check: {
    id: string;
    target: "llm";
    actorId: string;
    status: ActorSettingsCheckStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
      code: ActorSettingsCheckErrorCode;
      retryable: boolean;
      details: ActorSettingsDiagnostics;
    };
    diagnostics: ActorSettingsDiagnostics;
  };
}

export interface ActorLlmSaveRequest {
  requestId?: string;
  config: ActorLlmConfig | null;
}

export interface ActorLlmSaveResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  save: {
    id: string;
    target: "llm";
    actorId: string;
    status: ActorSettingsSaveStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
      code: ActorSettingsSaveErrorCode;
      retryable: boolean;
      details: ActorSettingsDiagnostics;
    };
    diagnostics: ActorSettingsDiagnostics;
  };
}

export type VectorIndexState =
  | "not_started"
  | "indexing"
  | "ready"
  | "degraded"
  | "failed";

export interface GlobalEmbeddingIndexStatus {
  state: VectorIndexState;
  activeFingerprint: string | null;
  activeProvider: EmbeddingProvider | null;
  activeModel: string | null;
  dimensions?: number;
  startedAt?: string;
  finishedAt?: string;
  totalMemories?: number;
  indexedMemories?: number;
  error?: string;
}

export interface GlobalEmbeddingConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  dimensions?: number;
}

export interface GlobalSettingsResponse {
  apiVersion: "v1beta1";
  user: DashboardUserProfile;
  access: {
    webui: {
      configured: boolean;
    };
  };
  identityBindings: {
    qq: {
      uid: string;
      configured: boolean;
    };
  };
  services: {
    llm: ActorLlmConfig;
    llmModels: LlmModelOption[];
    embedding: GlobalEmbeddingConfig;
    embeddingModels: EmbeddingModelOption[];
    embeddingRestartRequired: boolean;
    embeddingIndex: GlobalEmbeddingIndexStatus;
  };
}

export type GlobalLlmConfig = ActorLlmConfig;
export type GlobalEmbeddingServiceConfig = GlobalEmbeddingConfig;

export interface GlobalLlmCheckRequest {
  requestId?: string;
  attempt?: number;
  config: GlobalLlmConfig;
}

export interface GlobalLlmCheckResponse extends ActorLlmCheckResponse {
  check: ActorLlmCheckResponse["check"] & {
    actorId: "global";
  };
}

export interface GlobalLlmSaveRequest {
  requestId?: string;
  config: GlobalLlmConfig;
}

export interface GlobalLlmSaveResponse extends ActorLlmSaveResponse {
  save: ActorLlmSaveResponse["save"] & {
    actorId: "global";
  };
}

export interface GlobalEmbeddingCheckRequest {
  requestId?: string;
  attempt?: number;
  config: GlobalEmbeddingServiceConfig;
}

export interface GlobalEmbeddingCheckResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  check: {
    id: string;
    target: "embedding";
    actorId: "global";
    status: ActorSettingsCheckStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
      code: ActorSettingsCheckErrorCode;
      retryable: boolean;
      details: ActorSettingsDiagnostics;
    };
    diagnostics: ActorSettingsDiagnostics;
  };
}

export interface GlobalEmbeddingSaveRequest {
  requestId?: string;
  config: GlobalEmbeddingServiceConfig;
}

export interface GlobalEmbeddingSaveResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  save: {
    id: string;
    target: "embedding";
    actorId: "global";
    status: ActorSettingsSaveStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
      code: ActorSettingsSaveErrorCode;
      retryable: boolean;
      details: ActorSettingsDiagnostics;
    };
    diagnostics: ActorSettingsDiagnostics;
  };
  restartRequired: boolean;
  embeddingIndex: GlobalEmbeddingIndexStatus;
}

export interface OwnerQqBindingSaveRequest {
  requestId?: string;
  uid: string;
}

export interface OwnerQqBindingSaveResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  binding: {
    channel: "qq";
    uid: string;
    configured: boolean;
    updatedAt: string;
  };
  error?: {
    code: "INVALID_CONFIG" | "DATABASE_WRITE_FAILED";
    retryable: boolean;
    message: string;
  };
}

export interface GlobalAccessTokenSaveRequest {
  requestId?: string;
  token: string;
}

export interface GlobalAccessTokenSaveResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  access: {
    webui: {
      configured: boolean;
      updatedAt: string;
    };
  };
  error?: {
    code: "INVALID_CONFIG" | "DATABASE_WRITE_FAILED";
    retryable: boolean;
    message: string;
  };
}

/** Actor-scoped web search config DTO mirrored from EMA's WebSearchConfig. */
export interface ActorWebSearchConfig {
  enabled: boolean;
  tavilyApiKey: string;
}

export interface ActorWebSearchSaveRequest {
  requestId?: string;
  config: ActorWebSearchConfig;
}

export interface ActorWebSearchSaveResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  save: {
    id: string;
    target: "webSearch";
    actorId: string;
    status: ActorSettingsSaveStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
      code: ActorSettingsSaveErrorCode;
      retryable: boolean;
      details: ActorSettingsDiagnostics;
    };
    diagnostics: ActorSettingsDiagnostics;
  };
}

export interface ActorStickerItem {
  id: string;
  name: string;
  description: string;
  file: string;
  previewUrl?: string;
  previewDataUrl?: string;
}

export interface ActorStickerPack {
  dirName: string;
  name: string;
  stickerCount: number;
  stickers: ActorStickerItem[];
}

export type ActorStickerMutationErrorCode =
  | "INVALID_ACTOR"
  | "ACTOR_NOT_FOUND"
  | "INVALID_CONFIG"
  | "STICKER_ID_CONFLICT"
  | "STICKER_NOT_FOUND"
  | "STICKER_STORE_FAILED";

export interface ActorStickerListResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  actorId: string;
  packs: ActorStickerPack[];
  error?: {
    code: ActorStickerMutationErrorCode;
    retryable: boolean;
    message: string;
  };
}

export interface ActorStickerPatchRequest {
  requestId?: string;
  id: string;
  name: string;
  description: string;
}

export interface ActorStickerPackPatchRequest {
  requestId?: string;
  name: string;
}

export interface ActorStickerPackCreateRequest {
  requestId?: string;
  name: string;
}

export interface ActorStickerCreateRequest {
  requestId?: string;
  id: string;
  name: string;
  description: string;
}

export interface ActorStickerMutationResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  actorId: string;
  pack?: ActorStickerPack;
  packDirName?: string;
  error?: {
    code: ActorStickerMutationErrorCode;
    retryable: boolean;
    message: string;
  };
}

/** Actor-scoped QQ channel config DTO mirrored from EMA's ChannelConfig.qq. */
export type ActorQQConversationType = "chat" | "group";

export interface ActorQQConversation {
  id: string;
  type: ActorQQConversationType;
  uid: string;
  name: string;
  description: string;
  allowProactive: boolean;
}

export interface ActorQQConfig {
  enabled: boolean;
  wsUrl: string;
  accessToken: string;
  conversations: ActorQQConversation[];
}

export type ActorQQTransportStatus =
  | "connected"
  | "connecting"
  | "disconnected";

export type ActorQQBlockedBy = "actor_offline" | "qq_disabled" | null;

export type ActorQQConnectionSyncReason =
  | "initial"
  | "configChanged"
  | "poll"
  | "retry";

export interface ActorQQConnectionStatusRequest {
  requestId?: string;
  reason?: ActorQQConnectionSyncReason;
}

export interface ActorQQConnectionStatusResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  connection: {
    id: string;
    target: "qq";
    actorId: string;
    transportStatus: ActorQQTransportStatus;
    blockedBy: ActorQQBlockedBy;
    reason: ActorQQConnectionSyncReason;
    endpoint: string;
    enabled: boolean;
    checkedAt: string;
    retryable: boolean;
    diagnostics: ActorSettingsDiagnostics;
  };
}

export interface ActorQQChannelResponse {
  apiVersion: "v1beta1";
  actorId: string;
  config: ActorQQConfig;
  connection: ActorQQConnectionStatusResponse["connection"] | null;
}

export interface ActorQQSaveRequest {
  requestId?: string;
  config: ActorQQConfig;
}

export interface ActorQQSaveResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  save: {
    id: string;
    target: "qq";
    actorId: string;
    status: ActorSettingsSaveStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: {
      code: ActorSettingsSaveErrorCode;
      retryable: boolean;
      details: ActorSettingsDiagnostics;
    };
    diagnostics: ActorSettingsDiagnostics;
  };
}

export interface ActorQQEnabledUpdateRequest {
  requestId?: string;
  enabled: boolean;
}

export interface ActorQQEnabledUpdateResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  actorId: string;
  config: ActorQQConfig;
  connection: ActorQQConnectionStatusResponse["connection"];
  error?: {
    code: ActorSettingsSaveErrorCode;
    retryable: boolean;
    message: string;
    details: ActorSettingsDiagnostics;
  };
}

export interface ActorQQConversationListResponse {
  apiVersion: "v1beta1";
  actorId: string;
  conversations: ActorQQConversation[];
}

export interface ActorQQConversationCreateRequest {
  requestId?: string;
  conversation: Omit<ActorQQConversation, "id">;
}

export interface ActorQQConversationPatchRequest {
  requestId?: string;
  patch: Partial<
    Pick<ActorQQConversation, "name" | "description" | "allowProactive">
  >;
}

export interface ActorQQConversationMutationResponse {
  apiVersion: "v1beta1";
  ok: boolean;
  actorId: string;
  conversation?: ActorQQConversation;
  conversationId?: string;
  error?: {
    code: "INVALID_CONFIG" | "CONVERSATION_EXISTS" | "CONVERSATION_NOT_FOUND";
    retryable: boolean;
    message: string;
  };
}
