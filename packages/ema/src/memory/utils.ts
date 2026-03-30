import { z } from "zod";
import { collapseContents, type TextItem } from "../schema";
import { formatTimestamp } from "../utils";
import { formatReplyRef } from "../channel";
import {
  type BufferMessage,
  type BufferUserMessage,
  type BufferWriteMessage,
} from "./base";

export const LONG_TERM_INDEX_MAP = {
  过往事件: ["owner", "other", "self"],
  人物画像: ["owner", "other", "self"],
  百科知识: ["文史", "理工", "生活", "娱乐", "梗知识", "其他"],
  经验方法: ["general"],
} as const;

export type LongTermIndex0 = keyof typeof LONG_TERM_INDEX_MAP;
export type LongTermIndex1 =
  (typeof LONG_TERM_INDEX_MAP)[LongTermIndex0][number];

const index0Values = Object.keys(LONG_TERM_INDEX_MAP) as LongTermIndex0[];
const index1Values = Array.from(
  new Set(Object.values(LONG_TERM_INDEX_MAP).flat()),
) as LongTermIndex1[];

export const Index0Enum = z.enum(
  index0Values as [LongTermIndex0, ...LongTermIndex0[]],
);
export const Index1Enum = z.enum(
  index1Values as [LongTermIndex1, ...LongTermIndex1[]],
);

export type UpdateLongTermMemoryDTO = {
  index0: LongTermIndex0;
  index1: LongTermIndex1;
  memory: string;
  msg_ids?: number[];
};

export function isAllowedIndex1(
  index0: LongTermIndex0,
  index1: LongTermIndex1,
): boolean {
  const allowed = LONG_TERM_INDEX_MAP[index0] as readonly LongTermIndex1[];
  return allowed.includes(index1);
}

export function isActorChatResponse(
  message: BufferWriteMessage,
): message is Extract<BufferWriteMessage, { ema_reply: unknown }> {
  return "ema_reply" in message;
}

export function isActorChatInput(
  message: BufferWriteMessage,
): message is Extract<BufferWriteMessage, { speaker: unknown }> {
  return !isActorChatResponse(message);
}

/**
 * Formats a buffer message as a single prompt line.
 * @param message - Buffer message to format.
 * @param ownerUid - Known owner uid for speaker classification.
 * @returns Prompt line containing time, session metadata, message ID, and content.
 */
export function buildPromptFromBufferMessage(
  message: BufferMessage,
  ownerUid: string | null,
): string {
  const contents = (collapseContents(message.contents, false) as TextItem[])
    .map((part) => part.text)
    .join(" ")
    .replaceAll("\n", " ");
  if (message.kind === "actor") {
    const metadata = [`speaker="self"`, `msg_id="${message.msgId}"`];
    if (message.replyTo) {
      metadata.push(`reply_to="${formatReplyRef(message.replyTo)}"`);
    }
    if (message.think && message.think.length > 0) {
      metadata.push(`think="${message.think}"`);
    }
    return `- [${formatTimestamp("YYYY-MM-DD HH:mm:ss", message.time)}][${metadata.join(" ")}] ${contents}`;
  }
  const userMessage = message as BufferUserMessage;
  const speaker =
    ownerUid !== null && userMessage.speaker.uid === ownerUid
      ? "owner"
      : "other";
  const metadata = [
    `speaker="${speaker}"`,
    `session="${userMessage.speaker.session}"`,
    `uid="${userMessage.speaker.uid}"`,
    `name="${userMessage.speaker.name}"`,
    `msg_id="${userMessage.msgId}"`,
  ];
  if (userMessage.replyTo) {
    metadata.push(`reply_to="${formatReplyRef(userMessage.replyTo)}"`);
  }
  return `- [${formatTimestamp("YYYY-MM-DD HH:mm:ss", userMessage.time)}][${metadata.join(" ")}] ${contents}`;
}
