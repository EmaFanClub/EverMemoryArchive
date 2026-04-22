import { EventEmitter } from "node:events";
import type { InputContent } from "../schema";
import type { MessageReplyRef, SpeakerInformation } from "../channel";
import type { EmaReply } from "../tools/ema_reply_tool";

export interface ActorInputBase<K extends string = string> {
  kind: K;
  inputs: InputContent[];
  time?: number;
}

export interface ActorChatInput extends ActorInputBase<"chat"> {
  conversationId: number;
  msgId: number;
  speaker: SpeakerInformation;
  channelMessageId: string;
  replyTo?: MessageReplyRef;
}

export interface ActorSystemInput extends ActorInputBase<"system"> {
  conversationId?: number;
}

export type ActorInput = ActorChatInput | ActorSystemInput;

export interface ActorResponseBase<K extends string = string> {
  kind: K;
  actorId: number;
  conversationId: number;
  msgId: number;
  time?: number;
}

export interface ActorChatResponse extends ActorResponseBase<"chat"> {
  session: string;
  ema_reply: EmaReply;
}

export type ActorResponse = ActorChatResponse;

export interface ActorResponsedEvent {
  response: ActorResponse;
}

export interface WorkFinishedEvent {
  ok: boolean;
  msg: string;
  error?: Error;
}

export interface ActorWorkerEventMap {
  actorResponsed: [ActorResponsedEvent];
  workFinished: [WorkFinishedEvent];
}

export type ActorWorkerEventName = keyof ActorWorkerEventMap;

export type ActorWorkerEvent<K extends ActorWorkerEventName> =
  ActorWorkerEventMap[K][0];

export const ActorWorkerEventNames: Record<
  ActorWorkerEventName,
  ActorWorkerEventName
> = {
  actorResponsed: "actorResponsed",
  workFinished: "workFinished",
};

export interface ActorWorkerEventSource {
  on<K extends ActorWorkerEventName>(
    event: K,
    handler: (content: ActorWorkerEvent<K>) => void,
  ): this;
  off<K extends ActorWorkerEventName>(
    event: K,
    handler: (content: ActorWorkerEvent<K>) => void,
  ): this;
  once<K extends ActorWorkerEventName>(
    event: K,
    handler: (content: ActorWorkerEvent<K>) => void,
  ): this;
  emit<K extends ActorWorkerEventName>(
    event: K,
    content: ActorWorkerEvent<K>,
  ): boolean;
}

export type ActorWorkerEventsEmitter = EventEmitter<ActorWorkerEventMap> &
  ActorWorkerEventSource;

export type ActorWorkerStatus = "preparing" | "running" | "idle";

export type ActorStatus = "sleep" | "switching" | "awake";
