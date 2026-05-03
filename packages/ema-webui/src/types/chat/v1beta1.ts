export type ImageMIME =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/heic"
  | "image/heif";

export type VideoMIME =
  | "video/mp4"
  | "video/mpeg"
  | "video/quicktime"
  | "video/x-msvideo"
  | "video/x-flv"
  | "video/webm"
  | "video/x-ms-wmv"
  | "video/3gpp";

export type AudioMIME =
  | "audio/wav"
  | "audio/mpeg"
  | "audio/aiff"
  | "audio/aac"
  | "audio/ogg"
  | "audio/flac";

export type DocumentMIME =
  | "application/pdf"
  | "text/plain"
  | "text/csv"
  | "text/html";

export type MIME = ImageMIME | VideoMIME | AudioMIME | DocumentMIME;

export interface TextItem {
  type: "text";
  text: string;
}

export interface InlineDataItem {
  type: "inline_data";
  mimeType: MIME;
  data: string;
  text?: string;
}

export type InputContent = TextItem | InlineDataItem;

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

export type ConversationMessage =
  | ConversationUserMessage
  | ConversationActorMessage;

export interface ConversationMessageBase<K extends "user" | "actor"> {
  kind: K;
  msgId?: number;
  /**
   * The time the message was sent or recorded (Unix timestamp in milliseconds).
   */
  time?: number;
  contents: InputContent[];
  replyTo?: MessageReplyRef;
}

export interface ConversationUserMessage extends ConversationMessageBase<"user"> {
  uid: string;
  name: string;
}

export interface ConversationActorMessage extends ConversationMessageBase<"actor"> {
  name: string;
  think?: string;
}

export interface ChatHistoryPagination {
  limit: number;
  hasMore: boolean;
  nextBeforeMsgId?: number;
}

export interface ChatHistoryResponse {
  apiVersion: "v1beta1";
  generatedAt: string;
  actorId: string;
  session: string;
  messages: ConversationMessage[];
  pagination: ChatHistoryPagination;
}

export interface GetChatHistoryParams {
  actorId: string;
  session: string;
  limit?: number;
  beforeMsgId?: number;
}

export interface SendMessageRequest {
  correlationId: string;
  contents: InputContent[];
  replyTo?: MessageReplyRef;
}

export interface SendMessageResponse {
  apiVersion: "v1beta1";
  correlationId: string;
  msgId: number;
  message: ConversationMessage;
}
