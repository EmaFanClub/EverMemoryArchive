import type { ActorChatResponse } from "../actor";
import type { InputContent } from "../shared/schema";

export type ChannelSessionType = "chat" | "group";

export interface ChannelSessionInfo {
  channel: string;
  type: ChannelSessionType;
  uid: string;
}

export interface SpeakerInformation {
  session: string;
  uid: string;
  name: string;
}

export type MessageReplyRef =
  | {
      kind: "msg";
      msgId: number;
    }
  | {
      kind: "channel";
      channel: string;
      channelMessageId: string;
    };

export interface ChannelChatEvent {
  kind: "chat";
  channel: string;
  session: string;
  channelMessageId: string;
  speaker: SpeakerInformation;
  inputs: InputContent[];
  replyTo?: MessageReplyRef;
  time?: number;
}

export interface ChannelSystemEvent {
  kind: "system";
  channel: string;
  event: string;
  session?: string;
  inputs: InputContent[];
  time?: number;
}

export type ChannelEvent = ChannelChatEvent | ChannelSystemEvent;

export interface GatewayResult {
  ok: boolean;
  msg: string;
  conversationId?: number;
  msgId?: number;
}

export interface ChannelAPICall {
  method: string;
  params?: Record<string, unknown>;
}

export interface ChannelResponse {
  ok: boolean;
  data?: unknown;
  error?: unknown;
}

export type ChannelAPICaller = (
  apiCall: ChannelAPICall,
  options?: { timeoutMs?: number },
) => Promise<ChannelResponse | null>;

export type ChannelAdapterFactory = (call: ChannelAPICaller) => ChannelAdapter;

export type ChannelDecodeResult =
  | {
      kind: "events";
      events: ChannelEvent[];
    }
  | {
      kind: "response";
      requestId: string;
      response: ChannelResponse;
    }
  | {
      kind: "ignore";
    };

export interface Channel {
  readonly name: string;
  send(response: ActorChatResponse): Promise<void>;
  call?(
    apiCall: ChannelAPICall,
    options?: { timeoutMs?: number },
  ): Promise<ChannelResponse | null>;
}

export type ChannelClientStatus = "connecting" | "connected" | "disconnected";

export interface ChannelStartOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  connectTimeoutMs?: number;
}

export interface ChannelClient {
  start(options?: ChannelStartOptions): void;
  close(): Promise<void>;
  getStatus(): ChannelClientStatus;
  isEnabled(): boolean;
  enable(): Promise<void>;
  disable(): Promise<void>;
}

export interface ChannelAdapter<TRawIncoming = unknown, TRawOutgoing = string> {
  readonly name: string;
  readonly call: ChannelAPICaller;
  decode(raw: TRawIncoming): Promise<ChannelDecodeResult>;
  encode(
    apiCall: ChannelAPICall,
    requestId: string,
  ): Promise<TRawOutgoing | null>;
  chatToAPICall(response: ActorChatResponse): Promise<ChannelAPICall | null>;
  resolveChannelMessageId(
    response: ChannelResponse,
    apiCall: ChannelAPICall,
  ): string | null;
}
