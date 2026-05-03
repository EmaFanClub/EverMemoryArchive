import type {
  ActorEntity,
  ConversationEntity,
  ConversationMessageEntity,
  UserEntity,
} from "../db";
import type {
  ChannelConfig,
  EmbeddingConfig,
  GlobalConfigRecord,
  LLMConfig,
  WebSearchConfig,
} from "../config";
import type { VectorIndexStatus } from "../db";
import type { InputContent } from "../shared/schema";
import type { MessageReplyRef } from "../channel";

export type ActorRuntimeStatus = "offline" | "sleep" | "online" | "busy";
export type ActorRuntimeTransition =
  | "booting"
  | "shutting_down"
  | "waking"
  | "sleeping"
  | null;

export interface ActorRuntimeSnapshot {
  actorId: number;
  enabled: boolean;
  status: ActorRuntimeStatus;
  transition: ActorRuntimeTransition;
  updatedAt: number;
}

export interface SetupCommitInput {
  owner: Pick<UserEntity, "name"> &
    Partial<Pick<UserEntity, "description" | "avatar">> & {
      id?: number;
    };
  globalConfig: GlobalConfigRecord;
  identityBindings?: Array<{
    channel: string;
    uid: string;
  }>;
}

export interface SetupStatus {
  complete: boolean;
  owner: Awaited<ReturnType<import("../db").DBService["getDefaultUser"]>>;
  hasGlobalConfig: boolean;
}

export interface CreateActorInput {
  ownerUserId: number;
  name: string;
  avatarUrl?: string;
  roleBook: string;
  sleepSchedule: {
    startMinutes: number;
    endMinutes: number;
  };
}

export interface SleepScheduleInput {
  startMinutes: number;
  endMinutes: number;
}

export interface ActorDetails {
  actor: ActorEntity & { id: number };
  roleName: string;
  rolePrompt: string;
  runtime: ActorRuntimeSnapshot;
  sleepSchedule?: SleepScheduleInput;
  latestPreview?: {
    text: string;
    time: number;
  };
}

export interface EffectiveActorSettings {
  llm: LLMConfig;
  webSearch: WebSearchConfig;
  channel: ChannelConfig;
}

export interface LlmProbeResult {
  ok: boolean;
  unsupported: boolean;
  message: string;
  diagnostics?: Record<string, string | number | boolean | null>;
}

export interface EmbeddingProbeResult extends LlmProbeResult {}

export interface SaveGlobalEmbeddingConfigResult {
  config: EmbeddingConfig;
  restartRequired: true;
  vectorIndex: VectorIndexStatus;
}

export type QQConversationType = "chat" | "group";

export interface QQConversationInput {
  type: QQConversationType;
  uid: string;
  name: string;
  description?: string;
  allowProactive?: boolean;
}

export interface ChatHistoryInput {
  actorId: number;
  session: string;
  limit?: number;
  beforeMsgId?: number;
}

export interface ChatHistoryResult {
  actorId: number;
  session: string;
  messages: ConversationMessageEntity[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextBeforeMsgId?: number;
  };
}

export interface SendWebMessageInput {
  actorId: number;
  ownerUserId: number;
  ownerName: string;
  correlationId: string;
  contents: InputContent[];
  replyTo?: MessageReplyRef;
  time?: number;
}

export interface SendWebMessageResult {
  correlationId: string;
  conversation: ConversationEntity & { id: number };
  message: ConversationMessageEntity;
}

export interface ConversationMessageStreamEvent {
  type: "message.created";
  actorId: number;
  conversationId: number;
  session: string;
  message: ConversationMessageEntity;
  correlationId?: string;
}

export interface ConversationTypingStreamEvent {
  type: "typing.changed";
  actorId: number;
  conversationId: number;
  session: string;
  typing: boolean;
  updatedAt: number;
}

export type ConversationStreamEvent =
  | ConversationMessageStreamEvent
  | ConversationTypingStreamEvent;

export type ConversationMessageStreamHandler = (
  event: ConversationStreamEvent,
) => void;
