import { z } from "zod";
import { collapseContents, type TextItem } from "../shared/schema";
import { formatTimestamp } from "../shared/utils";
import { formatReplyRef } from "../channel";
import {
  type BufferMessage,
  type ShortTermMemory,
  type ShortTermMemoryRecord,
  type ShortTermMemoryTaskData,
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

/**
 * Resolves structured short-term-memory task metadata from tool context data.
 * @param data - Unstructured tool context payload.
 * @returns Parsed task data when available and valid.
 */
export function getShortTermMemoryTaskData(
  data?: Record<string, unknown>,
): ShortTermMemoryTaskData | null {
  if (!data || typeof data.triggeredAt !== "number") {
    return null;
  }
  if (data.task === "conversation_rollup") {
    return {
      task: "conversation_rollup",
      triggeredAt: data.triggeredAt,
      ...(data.activityAdded === true ? { activityAdded: true } : {}),
    };
  }
  if (data.task === "activity") {
    return {
      task: "activity",
      triggeredAt: data.triggeredAt,
      ...(data.activityAdded === true ? { activityAdded: true } : {}),
    };
  }
  if (data.task !== "memory_rollup" || !Array.isArray(data.activitySnapshot)) {
    return null;
  }
  const activitySnapshot = data.activitySnapshot.filter(
    isShortTermMemoryRecord,
  );
  return {
    task: "memory_rollup",
    triggeredAt: data.triggeredAt,
    ...(data.memoryUpdated === true ? { memoryUpdated: true } : {}),
    activitySnapshot,
  };
}

/**
 * Formats the canonical date key for a short-term memory kind.
 * @param kind - Target memory kind.
 * @param timestamp - Source timestamp in milliseconds.
 * @returns Canonical date key.
 */
export function formatShortTermMemoryDate(
  kind: ShortTermMemory["kind"],
  timestamp: number,
): string {
  switch (kind) {
    case "activity":
    case "day":
      return formatTimestamp("YYYY-MM-DD", timestamp);
    case "month":
      return formatTimestamp("YYYY-MM", timestamp);
    case "year":
      return formatTimestamp("YYYY", timestamp);
  }
}

function isShortTermMemoryRecord(
  value: unknown,
): value is ShortTermMemoryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<ShortTermMemoryRecord>;
  return (
    typeof item.id === "number" &&
    typeof item.kind === "string" &&
    typeof item.date === "string" &&
    typeof item.memory === "string"
  );
}
