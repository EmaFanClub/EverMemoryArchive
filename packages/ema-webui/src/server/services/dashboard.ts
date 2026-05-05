import "server-only";

import { randomUUID } from "node:crypto";
import {
  toActorSummary,
  toDashboardOverviewResponse,
  toDashboardUserProfile,
  toWebRuntimeStatus,
  toWebRuntimeTransition,
} from "@/server/ema-adapter/dashboard";
import {
  DEFAULT_OWNER_USER_ID,
  DEFAULT_WEB_SESSION,
  toCoreActorId,
} from "@/server/ema-adapter/ids";
import {
  toWebEmbeddingConfig,
  toWebEmbeddingIndexStatus,
  toWebLlmConfig,
  toWebQqBlockedBy,
  toWebQqConversation,
  toWebQqConfig,
  toWebQqTransportStatus,
  toWebSearchConfig,
} from "@/server/ema-adapter/settings";
import { ensureEmaServer } from "@/server/ema-server";
import type {
  ActorActivityUpdateRequest,
  ActorActivityUpdateResponse,
  ActorConversationInfo,
  ActorConversationMutationResponse,
  ActorConversationPatchRequest,
  ActorConversationResponse,
  ActorConversationSaveRequest,
  ActorListResponse,
  ActorLlmCheckRequest,
  ActorLlmCheckResponse,
  ActorLlmConfig,
  ActorLlmSaveRequest,
  ActorLlmSaveResponse,
  ActorQQChannelResponse,
  ActorQQConfig,
  ActorQQConnectionSyncReason,
  ActorQQConnectionStatusRequest,
  ActorQQConnectionStatusResponse,
  ActorQQConversation,
  ActorQQConversationCreateRequest,
  ActorQQConversationListResponse,
  ActorQQConversationMutationResponse,
  ActorQQConversationPatchRequest,
  ActorQQEnabledUpdateRequest,
  ActorQQEnabledUpdateResponse,
  ActorQQSaveRequest,
  ActorQQSaveResponse,
  ActorSettingsResponse,
  ActorSettingsSnapshot,
  ActorSettingsCheckErrorCode,
  ActorSettingsDiagnostics,
  ActorSettingsSaveErrorCode,
  ActorWebSearchSaveRequest,
  ActorWebSearchSaveResponse,
  CreateActorRequest,
  CreateActorResponse,
  DashboardOverviewResponse,
  GlobalEmbeddingCheckRequest,
  GlobalEmbeddingCheckResponse,
  GlobalEmbeddingSaveRequest,
  GlobalEmbeddingSaveResponse,
  GlobalLlmCheckRequest,
  GlobalLlmCheckResponse,
  GlobalLlmSaveRequest,
  GlobalLlmSaveResponse,
  GlobalSettingsResponse,
  OwnerQqBindingSaveRequest,
  OwnerQqBindingSaveResponse,
  OwnerResponse,
} from "@/types/dashboard/v1beta1";

const API_VERSION = "v1beta1" as const;
const EMPTY_QQ_CONFIG: ActorQQConfig = {
  enabled: false,
  wsUrl: "",
  accessToken: "",
  conversations: [],
};
const EMPTY_CORE_QQ_CONFIG = {
  enabled: false,
  wsUrl: "",
  accessToken: "",
};
type EmaServer = Awaited<ReturnType<typeof ensureEmaServer>>;
type CoreConversationForWeb = {
  id?: number;
  session: string;
  name: string;
  description: string;
  allowProactive?: boolean;
};

function now() {
  return new Date().toISOString();
}

function hostFromUrl(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value || null;
  }
}

function credentialDiagnosticValue(value: string) {
  return value.trim() ? "configured" : "";
}

function selectedLlmConfig(config: ActorLlmConfig) {
  return config.provider === "openai" ? config.openai : config.google;
}

function selectedEmbeddingConfig(config: GlobalEmbeddingSaveRequest["config"]) {
  return config.provider === "openai" ? config.openai : config.google;
}

function sameJsonValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function buildDashboardOverview(): Promise<DashboardOverviewResponse> {
  const server = await ensureEmaServer();
  const setupStatus = await server.controller.setup.getStatus();
  const ownerUserId = setupStatus.owner?.id ?? DEFAULT_OWNER_USER_ID;
  const detailsList = await server.controller.actor.listForUser(ownerUserId);
  const actors = await Promise.all(
    detailsList.map(async (details) => {
      const [settings, qqConversations] = await Promise.all([
        server.controller.settings.getEffective(details.actor.id),
        server.controller.channel.listQqConversations(details.actor.id),
      ]);
      return toActorSummary(details, { settings, qqConversations });
    }),
  );

  return toDashboardOverviewResponse({
    user: setupStatus.owner,
    actors,
    generatedAt: now(),
  });
}

export async function buildOwnerResponse(): Promise<OwnerResponse> {
  const server = await ensureEmaServer();
  const setupStatus = await server.controller.setup.getStatus();
  return {
    apiVersion: API_VERSION,
    user: toDashboardUserProfile(setupStatus.owner),
  };
}

export async function buildGlobalSettingsResponse(): Promise<GlobalSettingsResponse> {
  const server = await ensureEmaServer();
  const setupStatus = await server.controller.setup.getStatus();
  const record = await server.dbService.globalConfigDB.getGlobalConfig();
  const runtimeDefaults = server.controller.settings.getGlobalDefaults();
  const expectedEmbedding =
    record?.defaultEmbedding ?? runtimeDefaults.embedding;
  const qqBindings =
    await server.dbService.externalIdentityBindingDB.listExternalIdentityBindings(
      {
        userId: setupStatus.owner?.id ?? DEFAULT_OWNER_USER_ID,
        channel: "qq",
      },
    );
  const qqUid = qqBindings[0]?.uid ?? "";

  return {
    apiVersion: API_VERSION,
    user: toDashboardUserProfile(setupStatus.owner),
    identityBindings: {
      qq: {
        uid: qqUid,
        configured: Boolean(qqUid),
      },
    },
    services: {
      llm: toWebLlmConfig(record?.defaultLlm ?? runtimeDefaults.llm),
      embedding: toWebEmbeddingConfig(expectedEmbedding),
      embeddingRestartRequired: !sameJsonValue(
        expectedEmbedding,
        runtimeDefaults.embedding,
      ),
      embeddingIndex: toWebEmbeddingIndexStatus(
        server.dbService.longTermMemoryDB.getVectorIndexStatus(),
      ),
    },
  };
}

export async function saveOwnerQqBindingService(
  request: OwnerQqBindingSaveRequest,
): Promise<OwnerQqBindingSaveResponse> {
  const uid = (request.uid ?? "").trim();
  if (uid && !/^\d+$/.test(uid)) {
    return {
      apiVersion: API_VERSION,
      ok: false,
      binding: {
        channel: "qq",
        uid: "",
        configured: false,
        updatedAt: now(),
      },
      error: {
        code: "INVALID_CONFIG",
        retryable: false,
        message: "QQ号只能包含数字。",
      },
    };
  }

  try {
    const server = await ensureEmaServer();
    const ownerId =
      (await server.controller.setup.getStatus()).owner?.id ??
      DEFAULT_OWNER_USER_ID;
    if (!uid) {
      const bindings =
        await server.dbService.externalIdentityBindingDB.listExternalIdentityBindings(
          {
            userId: ownerId,
            channel: "qq",
          },
        );
      await Promise.all(
        bindings
          .map((binding) => binding.id)
          .filter((id): id is number => typeof id === "number")
          .map((id) =>
            server.dbService.externalIdentityBindingDB.deleteExternalIdentityBinding(
              id,
            ),
          ),
      );
      return {
        apiVersion: API_VERSION,
        ok: true,
        binding: {
          channel: "qq",
          uid: "",
          configured: false,
          updatedAt: now(),
        },
      };
    }

    await server.dbService.externalIdentityBindingDB.upsertExternalIdentityBinding(
      {
        userId: ownerId,
        channel: "qq",
        uid,
        updatedAt: Date.now(),
      },
    );
    return {
      apiVersion: API_VERSION,
      ok: true,
      binding: {
        channel: "qq",
        uid,
        configured: true,
        updatedAt: now(),
      },
    };
  } catch (error) {
    return {
      apiVersion: API_VERSION,
      ok: false,
      binding: {
        channel: "qq",
        uid,
        configured: Boolean(uid),
        updatedAt: now(),
      },
      error: {
        code: "DATABASE_WRITE_FAILED",
        retryable: true,
        message: messageFromError(error),
      },
    };
  }
}

export async function buildActorListResponse(): Promise<ActorListResponse> {
  const server = await ensureEmaServer();
  const setupStatus = await server.controller.setup.getStatus();
  const ownerUserId = setupStatus.owner?.id ?? DEFAULT_OWNER_USER_ID;
  const detailsList = await server.controller.actor.listForUser(ownerUserId);
  return {
    apiVersion: API_VERSION,
    generatedAt: now(),
    actors: detailsList.map((details) => toActorSummary(details)),
  };
}

export async function buildActorSettingsResponse(
  actorId: string,
): Promise<ActorSettingsResponse> {
  const server = await ensureEmaServer();
  const coreActorId = toCoreActorId(actorId);
  const globalDefaults = server.controller.settings.getGlobalDefaults();
  const global = {
    llm: toWebLlmConfig(globalDefaults.llm),
    embedding: toWebEmbeddingConfig(globalDefaults.embedding),
    webSearch: toWebSearchConfig(globalDefaults.webSearch),
  };
  const actor = await server.dbService.actorDB.getActor(coreActorId);
  if (!actor) {
    return {
      apiVersion: API_VERSION,
      actorId,
      settings: {
        qq: { ...EMPTY_QQ_CONFIG, conversations: [] },
      },
      global,
    };
  }

  const qqConversations =
    await server.controller.channel.listQqConversations(coreActorId);
  const settings: ActorSettingsSnapshot = {
    ...(actor.llmConfig ? { llm: toWebLlmConfig(actor.llmConfig) } : {}),
    ...(actor.webSearchConfig
      ? { webSearch: toWebSearchConfig(actor.webSearchConfig) }
      : {}),
    qq: toWebQqConfig(
      actor.channelConfig?.qq ?? EMPTY_CORE_QQ_CONFIG,
      qqConversations,
    ),
  };

  return {
    apiVersion: API_VERSION,
    actorId,
    settings,
    global,
  };
}

export async function buildActorConversationResponse(
  actorId: string,
  session: string,
): Promise<ActorConversationResponse> {
  const server = await ensureEmaServer();
  const conversation = await getOrEnsureActorConversation(
    server,
    toCoreActorId(actorId),
    session,
  );
  return {
    apiVersion: API_VERSION,
    actorId,
    conversation: toWebActorConversation(conversation),
  };
}

export async function saveActorConversationService(
  actorId: string,
  session: string,
  request: Partial<ActorConversationSaveRequest>,
): Promise<ActorConversationMutationResponse> {
  const name = request.conversation?.name?.trim() ?? "";
  if (!name) {
    return actorConversationError(
      actorId,
      "INVALID_CONFIG",
      "name is required",
    );
  }

  try {
    const server = await ensureEmaServer();
    const coreActorId = toCoreActorId(actorId);
    await getOrEnsureActorConversation(server, coreActorId, session);
    const updated = await server.controller.chat.updateConversation(
      coreActorId,
      session,
      {
        name,
        description: request.conversation?.description?.trim() ?? "",
      },
    );
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      conversation: toWebActorConversation(updated),
    };
  } catch (error) {
    return actorConversationError(
      actorId,
      classifyActorConversationError(error),
      messageFromError(error),
    );
  }
}

export async function patchActorConversationService(
  actorId: string,
  session: string,
  request: Partial<ActorConversationPatchRequest>,
): Promise<ActorConversationMutationResponse> {
  if (typeof request.patch?.allowProactive !== "boolean") {
    return actorConversationError(
      actorId,
      "INVALID_CONFIG",
      "allowProactive must be boolean",
    );
  }

  try {
    const server = await ensureEmaServer();
    const coreActorId = toCoreActorId(actorId);
    await getOrEnsureActorConversation(server, coreActorId, session);
    const updated = await server.controller.chat.updateConversation(
      coreActorId,
      session,
      {
        allowProactive: request.patch.allowProactive,
      },
    );
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      conversation: toWebActorConversation(updated),
    };
  } catch (error) {
    return actorConversationError(
      actorId,
      classifyActorConversationError(error),
      messageFromError(error),
    );
  }
}

export async function buildActorQqChannelResponse(
  actorId: string,
): Promise<ActorQQChannelResponse> {
  const server = await ensureEmaServer();
  const coreActorId = toCoreActorId(actorId);
  const [channelConfig, conversations, connectionState] = await Promise.all([
    server.dbService.getActorChannelConfig(coreActorId),
    server.controller.channel.listQqConversations(coreActorId),
    server.controller.channel.getQqConnectionState(coreActorId),
  ]);
  const config = toWebQqConfig(channelConfig.qq, conversations);
  return {
    apiVersion: API_VERSION,
    actorId,
    config,
    connection: createQqConnectionResponse(actorId, connectionState, "poll")
      .connection,
  };
}

export async function listActorQqConversationsService(
  actorId: string,
): Promise<ActorQQConversationListResponse> {
  const server = await ensureEmaServer();
  const conversations = await server.controller.channel.listQqConversations(
    toCoreActorId(actorId),
  );
  return {
    apiVersion: API_VERSION,
    actorId,
    conversations: conversations
      .map(toWebQqConversation)
      .filter((item): item is ActorQQConversation => Boolean(item)),
  };
}

export async function createActorQqConversationService(
  actorId: string,
  request: Partial<ActorQQConversationCreateRequest>,
): Promise<ActorQQConversationMutationResponse> {
  const conversation = request.conversation;
  if (!conversation) {
    return qqConversationError(
      actorId,
      "INVALID_CONFIG",
      "invalid conversation",
    );
  }

  try {
    const server = await ensureEmaServer();
    const created = await server.controller.channel.addQqConversation(
      toCoreActorId(actorId),
      conversation,
    );
    const nextConversation = toWebQqConversation(created);
    if (!nextConversation) {
      return qqConversationError(
        actorId,
        "INVALID_CONFIG",
        "invalid conversation",
      );
    }
    await server.controller.actor.publishUpdated(toCoreActorId(actorId));
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      conversation: nextConversation,
    };
  } catch (error) {
    return qqConversationError(
      actorId,
      classifyQqConversationError(error),
      messageFromError(error),
    );
  }
}

export async function patchActorQqConversationService(
  actorId: string,
  conversationId: string,
  request: Partial<ActorQQConversationPatchRequest>,
): Promise<ActorQQConversationMutationResponse> {
  const coreActorId = toCoreActorId(actorId);
  const coreConversationId = toCoreConversationId(conversationId);
  if (coreConversationId === null) {
    return qqConversationError(
      actorId,
      "CONVERSATION_NOT_FOUND",
      "conversation not found",
    );
  }

  try {
    const server = await ensureEmaServer();
    const current =
      await server.dbService.conversationDB.getConversation(coreConversationId);
    if (!current || current.actorId !== coreActorId) {
      return qqConversationError(
        actorId,
        "CONVERSATION_NOT_FOUND",
        "conversation not found",
      );
    }
    const currentWebConversation = toWebQqConversation(current);
    if (!currentWebConversation) {
      return qqConversationError(
        actorId,
        "CONVERSATION_NOT_FOUND",
        "conversation not found",
      );
    }
    const updated = await server.controller.channel.updateQqConversation(
      coreActorId,
      coreConversationId,
      {
        name: request.patch?.name ?? currentWebConversation.name,
        description:
          request.patch?.description ?? currentWebConversation.description,
        allowProactive:
          request.patch?.allowProactive ??
          currentWebConversation.allowProactive,
      },
    );
    const nextConversation = toWebQqConversation(updated);
    if (!nextConversation) {
      return qqConversationError(
        actorId,
        "INVALID_CONFIG",
        "invalid conversation",
      );
    }
    await server.controller.actor.publishUpdated(coreActorId);
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      conversation: nextConversation,
    };
  } catch (error) {
    return qqConversationError(
      actorId,
      classifyQqConversationError(error),
      messageFromError(error),
    );
  }
}

export async function deleteActorQqConversationService(
  actorId: string,
  conversationId: string,
): Promise<ActorQQConversationMutationResponse> {
  const coreConversationId = toCoreConversationId(conversationId);
  if (coreConversationId === null) {
    return qqConversationError(
      actorId,
      "CONVERSATION_NOT_FOUND",
      "conversation not found",
    );
  }

  try {
    const server = await ensureEmaServer();
    const ok = await server.controller.channel.deleteQqConversation(
      toCoreActorId(actorId),
      coreConversationId,
    );
    if (ok) {
      await server.controller.actor.publishUpdated(toCoreActorId(actorId));
      return {
        apiVersion: API_VERSION,
        ok: true,
        actorId,
        conversationId,
      };
    }
  } catch {
    // Fall through to the stable not-found response.
  }
  return qqConversationError(
    actorId,
    "CONVERSATION_NOT_FOUND",
    "conversation not found",
  );
}

function qqConversationError(
  actorId: string,
  code: NonNullable<ActorQQConversationMutationResponse["error"]>["code"],
  message: string,
): ActorQQConversationMutationResponse {
  return {
    apiVersion: API_VERSION,
    ok: false,
    actorId,
    error: {
      code,
      retryable: false,
      message,
    },
  };
}

function createQqConnectionResponse(
  actorId: string,
  state: {
    enabled: boolean;
    endpoint: string;
    transportStatus: string;
    blockedBy: unknown;
    checkedAt: number;
    retryable: boolean;
  },
  reason: ActorQQConnectionSyncReason,
): ActorQQConnectionStatusResponse {
  return {
    apiVersion: API_VERSION,
    ok: true,
    connection: {
      id: `qq-connection-${actorId}`,
      target: "qq",
      actorId,
      transportStatus: toWebQqTransportStatus(state.transportStatus),
      blockedBy: toWebQqBlockedBy(state.blockedBy),
      reason,
      endpoint: state.endpoint,
      enabled: state.enabled,
      checkedAt: new Date(state.checkedAt).toISOString(),
      retryable: state.retryable,
      diagnostics: {},
    },
  };
}

function classifyQqConversationError(
  error: unknown,
): NonNullable<ActorQQConversationMutationResponse["error"]>["code"] {
  const message = messageFromError(error).toLowerCase();
  if (message.includes("already exists")) {
    return "CONVERSATION_EXISTS";
  }
  if (message.includes("not found")) {
    return "CONVERSATION_NOT_FOUND";
  }
  return "INVALID_CONFIG";
}

function classifyActorConversationError(
  error: unknown,
): NonNullable<ActorConversationMutationResponse["error"]>["code"] {
  const message = messageFromError(error).toLowerCase();
  if (message.includes("not found")) {
    return "CONVERSATION_NOT_FOUND";
  }
  return "INVALID_CONFIG";
}

function actorConversationError(
  actorId: string,
  code: NonNullable<ActorConversationMutationResponse["error"]>["code"],
  message: string,
): ActorConversationMutationResponse {
  return {
    apiVersion: API_VERSION,
    ok: false,
    actorId,
    error: {
      code,
      retryable: code === "CONVERSATION_NOT_FOUND",
      message,
    },
  };
}

function toCoreConversationId(conversationId: string): number | null {
  const parsed = Number.parseInt(conversationId, 10);
  if (
    !Number.isInteger(parsed) ||
    parsed <= 0 ||
    String(parsed) !== conversationId
  ) {
    return null;
  }
  return parsed;
}

async function getOrEnsureActorConversation(
  server: EmaServer,
  actorId: number,
  session: string,
) {
  if (session === DEFAULT_WEB_SESSION) {
    const owner = await server.dbService.getDefaultUser();
    return await server.controller.chat.ensureWebConversation(
      actorId,
      owner?.id ?? DEFAULT_OWNER_USER_ID,
      owner?.name ?? "你",
    );
  }
  return await server.controller.chat.getConversation(actorId, session);
}

function toWebActorConversation(
  conversation: CoreConversationForWeb,
): ActorConversationInfo {
  if (typeof conversation.id !== "number") {
    throw new Error("Conversation is missing id.");
  }
  return {
    id: String(conversation.id),
    session: conversation.session,
    name: conversation.name,
    description: conversation.description,
    allowProactive: conversation.allowProactive ?? false,
  };
}

export async function createActorService(
  request: CreateActorRequest,
): Promise<CreateActorResponse> {
  const server = await ensureEmaServer();
  const details = await server.controller.actor.create({
    ownerUserId: DEFAULT_OWNER_USER_ID,
    name: request.name,
    avatarUrl: request.avatarUrl,
    roleBook: request.roleBook,
    sleepSchedule: request.sleepSchedule,
  });
  return {
    apiVersion: API_VERSION,
    actor: toActorSummary(details),
  };
}

export async function updateActorActivityService(
  actorId: string,
  request: ActorActivityUpdateRequest,
): Promise<ActorActivityUpdateResponse> {
  try {
    const server = await ensureEmaServer();
    const coreActorId = toCoreActorId(actorId);
    const snapshot = request.enabled
      ? await server.controller.runtime.enable(coreActorId)
      : await server.controller.runtime.disable(coreActorId);
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      activity: {
        enabled: snapshot.enabled,
        status: toWebRuntimeStatus(snapshot.status),
        transition: toWebRuntimeTransition(snapshot.transition),
        switching: snapshot.transition !== null,
        updatedAt: new Date(snapshot.updatedAt).toISOString(),
      },
    };
  } catch (error) {
    return {
      apiVersion: API_VERSION,
      ok: false,
      actorId,
      activity: {
        enabled: false,
        status: "offline",
        transition: null,
        switching: false,
        updatedAt: now(),
      },
      error: {
        code: "ACTIVITY_SWITCH_FAILED",
        retryable: true,
        message:
          error instanceof Error ? error.message : "runtime switch failed",
      },
    };
  }
}

function createActorLlmCheckResponse({
  actorId,
  startedAt,
  ok,
  diagnostics,
  errorCode,
  errorDetails,
  retryable = true,
}: {
  actorId: string;
  startedAt: string;
  ok: boolean;
  diagnostics: ActorSettingsDiagnostics;
  errorCode?: ActorSettingsCheckErrorCode;
  errorDetails?: ActorSettingsDiagnostics;
  retryable?: boolean;
}): ActorLlmCheckResponse {
  const finishedAt = now();
  return {
    apiVersion: API_VERSION,
    ok,
    check: {
      id: randomUUID(),
      target: "llm",
      actorId,
      status: ok ? "passed" : "failed",
      startedAt,
      finishedAt,
      durationMs: Math.max(
        1,
        new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      ),
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

function createGlobalEmbeddingCheckResponse({
  startedAt,
  ok,
  diagnostics,
  errorCode,
  errorDetails,
  retryable = true,
}: {
  startedAt: string;
  ok: boolean;
  diagnostics: ActorSettingsDiagnostics;
  errorCode?: ActorSettingsCheckErrorCode;
  errorDetails?: ActorSettingsDiagnostics;
  retryable?: boolean;
}): GlobalEmbeddingCheckResponse {
  const finishedAt = now();
  return {
    apiVersion: API_VERSION,
    ok,
    check: {
      id: randomUUID(),
      target: "embedding",
      actorId: "global",
      status: ok ? "passed" : "failed",
      startedAt,
      finishedAt,
      durationMs: Math.max(
        1,
        new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      ),
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

function createSaveResponse<
  TTarget extends "llm" | "embedding" | "webSearch" | "qq",
>({
  target,
  actorId,
  startedAt,
  ok,
  diagnostics,
  errorCode,
  errorDetails,
}: {
  target: TTarget;
  actorId: string;
  startedAt: string;
  ok: boolean;
  diagnostics: ActorSettingsDiagnostics;
  errorCode?: ActorSettingsSaveErrorCode;
  errorDetails?: ActorSettingsDiagnostics;
}) {
  const finishedAt = now();
  return {
    apiVersion: API_VERSION,
    ok,
    save: {
      id: randomUUID(),
      target,
      actorId,
      status: ok ? "saved" : "failed",
      startedAt,
      finishedAt,
      durationMs: Math.max(
        1,
        new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      ),
      error: ok
        ? undefined
        : {
            code: errorCode ?? "DATABASE_WRITE_FAILED",
            retryable: true,
            details: errorDetails ?? {},
          },
      diagnostics,
    },
  } as const;
}

function classifyActorLlmProbeError(
  message: string,
): ActorSettingsCheckErrorCode {
  const normalized = message.toLowerCase();
  const networkLike =
    normalized.includes("timeout") ||
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("econn") ||
    normalized.includes("enotfound") ||
    normalized.includes("etimedout") ||
    normalized.includes("abort");
  return networkLike ? "LLM_NETWORK_ERROR" : "LLM_PROVIDER_ERROR";
}

function classifyEmbeddingProbeError(
  message: string,
): ActorSettingsCheckErrorCode {
  const normalized = message.toLowerCase();
  const networkLike =
    normalized.includes("timeout") ||
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("econn") ||
    normalized.includes("enotfound") ||
    normalized.includes("etimedout") ||
    normalized.includes("abort");
  return networkLike ? "EMBEDDING_NETWORK_ERROR" : "EMBEDDING_PROVIDER_ERROR";
}

function llmSaveDiagnostics(config: ActorLlmConfig): ActorSettingsDiagnostics {
  const selected = selectedLlmConfig(config);
  return {
    provider: config.provider,
    model: selected.model,
    endpoint:
      config.provider === "google" && config.google.useVertexAi
        ? "vertex-ai"
        : hostFromUrl(selected.baseUrl),
    storage: "ema-actor-config",
  };
}

function embeddingSaveDiagnostics(
  config: GlobalEmbeddingSaveRequest["config"],
): ActorSettingsDiagnostics {
  const selected = selectedEmbeddingConfig(config);
  return {
    provider: config.provider,
    model: selected.model,
    endpoint:
      config.provider === "google" && config.google.useVertexAi
        ? "vertex-ai"
        : hostFromUrl(selected.baseUrl),
    credential:
      config.provider === "google" && config.google.useVertexAi
        ? credentialDiagnosticValue(config.google.credentialsFile)
        : credentialDiagnosticValue(selected.apiKey),
    storage: "ema-global-config",
  };
}

function isInvalidSettingsError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("required") ||
    normalized.includes("incomplete") ||
    normalized.includes("not supported") ||
    normalized.includes("unsupported") ||
    normalized.includes("invalid")
  );
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runActorLlmServiceCheck(
  actorId: string,
  request: ActorLlmCheckRequest,
): Promise<ActorLlmCheckResponse> {
  const startedAt = now();
  const config = request.config;
  const selected = selectedLlmConfig(config);
  const probe = await (
    await ensureEmaServer()
  ).controller.settings.probeLlmConfig(config);
  return createActorLlmCheckResponse({
    actorId,
    startedAt,
    ok: probe.ok,
    errorCode: probe.ok
      ? undefined
      : probe.unsupported
        ? "UNSUPPORTED"
        : classifyActorLlmProbeError(probe.message),
    errorDetails: probe.ok
      ? undefined
      : {
          provider: config.provider,
          model: selected.model,
          providerErrorType: probe.unsupported
            ? "unsupported"
            : "provider_probe_failed",
          providerErrorMessage: probe.message,
        },
    retryable: !probe.unsupported,
    diagnostics: {
      provider: config.provider,
      model: selected.model,
      endpoint:
        config.provider === "google" && config.google.useVertexAi
          ? "vertex-ai"
          : hostFromUrl(selected.baseUrl),
      ...(probe.diagnostics ?? {}),
    },
  });
}

export async function runGlobalLlmServiceCheck(
  request: GlobalLlmCheckRequest,
): Promise<GlobalLlmCheckResponse> {
  const startedAt = now();
  const config = request.config;
  if (!config) {
    return createActorLlmCheckResponse({
      actorId: "global",
      startedAt,
      ok: false,
      errorCode: "INVALID_CONFIG",
      errorDetails: {
        issuePaths: ["llm"],
        issueCodes: ["required"],
      },
      retryable: true,
      diagnostics: {},
    }) as GlobalLlmCheckResponse;
  }

  const selected = selectedLlmConfig(config);
  const probe = await (
    await ensureEmaServer()
  ).controller.settings.probeLlmConfig(config);
  return createActorLlmCheckResponse({
    actorId: "global",
    startedAt,
    ok: probe.ok,
    errorCode: probe.ok
      ? undefined
      : probe.unsupported
        ? "UNSUPPORTED"
        : classifyActorLlmProbeError(probe.message),
    errorDetails: probe.ok
      ? undefined
      : {
          provider: config.provider,
          model: selected.model,
          providerErrorType: probe.unsupported
            ? "unsupported"
            : "provider_probe_failed",
          providerErrorMessage: probe.message,
        },
    retryable: !probe.unsupported,
    diagnostics: {
      provider: config.provider,
      model: selected.model,
      endpoint:
        config.provider === "google" && config.google.useVertexAi
          ? "vertex-ai"
          : hostFromUrl(selected.baseUrl),
      credential:
        config.provider === "google" && config.google.useVertexAi
          ? credentialDiagnosticValue(config.google.credentialsFile)
          : credentialDiagnosticValue(selected.apiKey),
      ...(probe.diagnostics ?? {}),
    },
  }) as GlobalLlmCheckResponse;
}

export async function runGlobalEmbeddingServiceCheck(
  request: GlobalEmbeddingCheckRequest,
): Promise<GlobalEmbeddingCheckResponse> {
  const startedAt = now();
  const config = request.config;
  if (!config) {
    return createGlobalEmbeddingCheckResponse({
      startedAt,
      ok: false,
      errorCode: "INVALID_CONFIG",
      errorDetails: {
        issuePaths: ["embedding"],
        issueCodes: ["required"],
      },
      diagnostics: {},
    });
  }

  const selected = selectedEmbeddingConfig(config);
  const probe = await (
    await ensureEmaServer()
  ).controller.settings.probeEmbeddingConfig(config);
  return createGlobalEmbeddingCheckResponse({
    startedAt,
    ok: probe.ok,
    errorCode: probe.ok
      ? undefined
      : probe.unsupported
        ? "UNSUPPORTED"
        : classifyEmbeddingProbeError(probe.message),
    errorDetails: probe.ok
      ? undefined
      : {
          provider: config.provider,
          model: selected.model,
          providerErrorType: probe.unsupported
            ? "unsupported"
            : "provider_probe_failed",
          providerErrorMessage: probe.message,
        },
    retryable: !probe.unsupported,
    diagnostics: {
      provider: config.provider,
      model: selected.model,
      endpoint:
        config.provider === "google" && config.google.useVertexAi
          ? "vertex-ai"
          : hostFromUrl(selected.baseUrl),
      credential:
        config.provider === "google" && config.google.useVertexAi
          ? credentialDiagnosticValue(config.google.credentialsFile)
          : credentialDiagnosticValue(selected.apiKey),
      ...(probe.diagnostics ?? {}),
    },
  });
}

export async function saveActorLlmServiceConfig(
  actorId: string,
  request: ActorLlmSaveRequest,
): Promise<ActorLlmSaveResponse> {
  const startedAt = now();
  const config = request.config;
  if (!config) {
    return createSaveResponse({
      target: "llm",
      actorId,
      startedAt,
      ok: false,
      errorCode: "INVALID_CONFIG",
      errorDetails: {
        issuePaths: ["llm"],
        issueCodes: ["required"],
      },
      diagnostics: {},
    }) as ActorLlmSaveResponse;
  }

  try {
    const server = await ensureEmaServer();
    await server.controller.settings.saveLlmConfig(
      toCoreActorId(actorId),
      config,
    );
    return createSaveResponse({
      target: "llm",
      actorId,
      startedAt,
      ok: true,
      diagnostics: llmSaveDiagnostics(config),
    }) as ActorLlmSaveResponse;
  } catch (error) {
    const message = messageFromError(error);
    return createSaveResponse({
      target: "llm",
      actorId,
      startedAt,
      ok: false,
      errorCode: isInvalidSettingsError(message)
        ? "INVALID_CONFIG"
        : "DATABASE_WRITE_FAILED",
      errorDetails: {
        message,
      },
      diagnostics: llmSaveDiagnostics(config),
    }) as ActorLlmSaveResponse;
  }
}

export async function saveGlobalLlmServiceConfig(
  request: GlobalLlmSaveRequest,
): Promise<GlobalLlmSaveResponse> {
  const startedAt = now();
  const config = request.config;
  if (!config) {
    return createSaveResponse({
      target: "llm",
      actorId: "global",
      startedAt,
      ok: false,
      errorCode: "INVALID_CONFIG",
      errorDetails: {
        issuePaths: ["llm"],
        issueCodes: ["required"],
      },
      diagnostics: {},
    }) as GlobalLlmSaveResponse;
  }

  try {
    const server = await ensureEmaServer();
    await server.controller.settings.saveGlobalLlmConfig(config);
    return createSaveResponse({
      target: "llm",
      actorId: "global",
      startedAt,
      ok: true,
      diagnostics: {
        ...llmSaveDiagnostics(config),
        credential:
          config.provider === "google" && config.google.useVertexAi
            ? credentialDiagnosticValue(config.google.credentialsFile)
            : credentialDiagnosticValue(selectedLlmConfig(config).apiKey),
        storage: "ema-global-config",
      },
    }) as GlobalLlmSaveResponse;
  } catch (error) {
    const message = messageFromError(error);
    return createSaveResponse({
      target: "llm",
      actorId: "global",
      startedAt,
      ok: false,
      errorCode: isInvalidSettingsError(message)
        ? "INVALID_CONFIG"
        : "DATABASE_WRITE_FAILED",
      errorDetails: {
        message,
      },
      diagnostics: {
        provider: config.provider,
        model: selectedLlmConfig(config).model,
        endpoint:
          config.provider === "google" && config.google.useVertexAi
            ? "vertex-ai"
            : hostFromUrl(selectedLlmConfig(config).baseUrl),
        credential:
          config.provider === "google" && config.google.useVertexAi
            ? credentialDiagnosticValue(config.google.credentialsFile)
            : credentialDiagnosticValue(selectedLlmConfig(config).apiKey),
        storage: "ema-global-config",
      },
    }) as GlobalLlmSaveResponse;
  }
}

export async function saveGlobalEmbeddingServiceConfig(
  request: GlobalEmbeddingSaveRequest,
): Promise<GlobalEmbeddingSaveResponse> {
  const startedAt = now();
  const config = request.config;
  const fallbackIndex = (
    await ensureEmaServer()
  ).dbService.longTermMemoryDB.getVectorIndexStatus();
  if (!config) {
    return {
      ...(createSaveResponse({
        target: "embedding",
        actorId: "global",
        startedAt,
        ok: false,
        errorCode: "INVALID_CONFIG",
        errorDetails: {
          issuePaths: ["embedding"],
          issueCodes: ["required"],
        },
        diagnostics: {},
      }) as Omit<
        GlobalEmbeddingSaveResponse,
        "restartRequired" | "embeddingIndex"
      >),
      restartRequired: true,
      embeddingIndex: toWebEmbeddingIndexStatus(fallbackIndex),
    };
  }

  try {
    const server = await ensureEmaServer();
    const result =
      await server.controller.settings.saveGlobalEmbeddingConfig(config);
    return {
      ...(createSaveResponse({
        target: "embedding",
        actorId: "global",
        startedAt,
        ok: true,
        diagnostics: embeddingSaveDiagnostics(config),
      }) as Omit<
        GlobalEmbeddingSaveResponse,
        "restartRequired" | "embeddingIndex"
      >),
      restartRequired: result.restartRequired,
      embeddingIndex: toWebEmbeddingIndexStatus(result.vectorIndex),
    };
  } catch (error) {
    const message = messageFromError(error);
    return {
      ...(createSaveResponse({
        target: "embedding",
        actorId: "global",
        startedAt,
        ok: false,
        errorCode: isInvalidSettingsError(message)
          ? "INVALID_CONFIG"
          : "DATABASE_WRITE_FAILED",
        errorDetails: {
          message,
        },
        diagnostics: embeddingSaveDiagnostics(config),
      }) as Omit<
        GlobalEmbeddingSaveResponse,
        "restartRequired" | "embeddingIndex"
      >),
      restartRequired: true,
      embeddingIndex: toWebEmbeddingIndexStatus(fallbackIndex),
    };
  }
}

export async function saveActorWebSearchServiceConfig(
  actorId: string,
  request: ActorWebSearchSaveRequest,
): Promise<ActorWebSearchSaveResponse> {
  const startedAt = now();
  const config = request.config;
  if (!config) {
    return createSaveResponse({
      target: "webSearch",
      actorId,
      startedAt,
      ok: false,
      errorCode: "INVALID_CONFIG",
      errorDetails: {
        issuePaths: ["webSearch"],
        issueCodes: ["required"],
      },
      diagnostics: {},
    }) as ActorWebSearchSaveResponse;
  }

  try {
    const server = await ensureEmaServer();
    await server.controller.settings.saveWebSearchConfig(
      toCoreActorId(actorId),
      config,
    );
    return createSaveResponse({
      target: "webSearch",
      actorId,
      startedAt,
      ok: true,
      diagnostics: {
        enabled: config.enabled,
        storage: "ema-actor-config",
      },
    }) as ActorWebSearchSaveResponse;
  } catch (error) {
    const message = messageFromError(error);
    const invalid = isInvalidSettingsError(message);
    return createSaveResponse({
      target: "webSearch",
      actorId,
      startedAt,
      ok: false,
      errorCode: invalid ? "INVALID_CONFIG" : "DATABASE_WRITE_FAILED",
      errorDetails: {
        ...(invalid
          ? {
              issuePaths: ["webSearch.tavilyApiKey"],
              issueCodes: ["required"],
            }
          : {}),
        message,
      },
      diagnostics: {
        enabled: config.enabled,
        storage: "ema-actor-config",
      },
    }) as ActorWebSearchSaveResponse;
  }
}

export async function saveActorQqServiceConfig(
  actorId: string,
  request: ActorQQSaveRequest,
): Promise<ActorQQSaveResponse> {
  const startedAt = now();
  const config = request.config;
  if (!config) {
    return createSaveResponse({
      target: "qq",
      actorId,
      startedAt,
      ok: false,
      errorCode: "INVALID_CONFIG",
      errorDetails: {
        issuePaths: ["qq"],
        issueCodes: ["required"],
      },
      diagnostics: {},
    }) as ActorQQSaveResponse;
  }

  try {
    const server = await ensureEmaServer();
    const coreActorId = toCoreActorId(actorId);
    const savedConfig = await server.controller.channel.saveQqConnectionConfig(
      coreActorId,
      {
        wsUrl: config.wsUrl.trim(),
        accessToken: config.accessToken.trim(),
      },
    );
    const conversations =
      await server.controller.channel.listQqConversations(coreActorId);
    return createSaveResponse({
      target: "qq",
      actorId,
      startedAt,
      ok: true,
      diagnostics: {
        enabled: savedConfig.enabled,
        endpoint: hostFromUrl(savedConfig.wsUrl),
        conversationCount: conversations.length,
        storage: "ema-actor-config",
      },
    }) as ActorQQSaveResponse;
  } catch (error) {
    const message = messageFromError(error);
    return createSaveResponse({
      target: "qq",
      actorId,
      startedAt,
      ok: false,
      errorCode: isInvalidSettingsError(message)
        ? "INVALID_CONFIG"
        : "DATABASE_WRITE_FAILED",
      errorDetails: {
        message,
      },
      diagnostics: {
        enabled: config.enabled,
        endpoint: hostFromUrl(config.wsUrl),
        conversationCount: config.conversations.length,
        storage: "ema-actor-config",
      },
    }) as ActorQQSaveResponse;
  }
}

export async function updateActorQqEnabledService(
  actorId: string,
  request: ActorQQEnabledUpdateRequest,
): Promise<ActorQQEnabledUpdateResponse> {
  const enabled = request.enabled === true;
  try {
    const server = await ensureEmaServer();
    const coreActorId = toCoreActorId(actorId);
    const savedConfig = await server.controller.channel.setQqEnabled(
      coreActorId,
      enabled,
    );
    const [conversations, connectionState] = await Promise.all([
      server.controller.channel.listQqConversations(coreActorId),
      server.controller.channel.getQqConnectionState(coreActorId),
    ]);
    const config = toWebQqConfig(savedConfig, conversations);
    return {
      apiVersion: API_VERSION,
      ok: true,
      actorId,
      config,
      connection: createQqConnectionResponse(
        actorId,
        connectionState,
        "configChanged",
      ).connection,
    };
  } catch (error) {
    const message = messageFromError(error);
    let config = { ...EMPTY_QQ_CONFIG };
    let connectionState: {
      enabled: boolean;
      endpoint: string;
      transportStatus: string;
      blockedBy: unknown;
      checkedAt: number;
      retryable: boolean;
    } = {
      enabled: false,
      endpoint: "",
      transportStatus: "disconnected",
      blockedBy: "qq_disabled",
      checkedAt: Date.now(),
      retryable: false,
    };
    try {
      const server = await ensureEmaServer();
      const coreActorId = toCoreActorId(actorId);
      const [channelConfig, conversations, currentState] = await Promise.all([
        server.dbService.getActorChannelConfig(coreActorId),
        server.controller.channel.listQqConversations(coreActorId),
        server.controller.channel.getQqConnectionState(coreActorId),
      ]);
      config = toWebQqConfig(channelConfig.qq, conversations);
      connectionState = currentState;
    } catch {
      // Keep the stable error shape even when the actor has disappeared.
    }
    return {
      apiVersion: API_VERSION,
      ok: false,
      actorId,
      config,
      connection: createQqConnectionResponse(
        actorId,
        connectionState,
        "configChanged",
      ).connection,
      error: {
        code: isInvalidSettingsError(message)
          ? "INVALID_CONFIG"
          : "DATABASE_WRITE_FAILED",
        retryable: true,
        message,
        details: {
          message,
        },
      },
    };
  }
}

export async function syncActorQqServiceConnectionStatus(
  actorId: string,
  request: ActorQQConnectionStatusRequest,
): Promise<ActorQQConnectionStatusResponse> {
  const server = await ensureEmaServer();
  const coreActorId = toCoreActorId(actorId);
  const reason = request.reason ?? "poll";
  const connectionState =
    reason === "retry"
      ? await server.controller.channel.restartQq(coreActorId)
      : await server.controller.channel.publishQqStatus(coreActorId);
  return createQqConnectionResponse(actorId, connectionState, reason);
}
