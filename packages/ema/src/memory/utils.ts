import dayjs from "dayjs";
import { z } from "zod";
import type { InputContent, UserMessage } from "../schema";
import type { EmaReply } from "../tools/ema_reply_tool";
import type { BufferMessage } from "./base";

export const LONG_TERM_INDEX_MAP = {
  自我认知: [""],
  用户画像: [""],
  人物画像: [""],
  过往事件: ["用户事件", "其他事件"],
  百科知识: ["文史", "理工", "生活", "娱乐", "梗知识", "其他"],
  关系网络: ["人与人", "物与物", "人与物"],
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

/**
 * Converts a buffer message into a user message with a context header.
 * @param message - Buffer message to convert.
 * @returns UserMessage with a context header prepended.
 */
export function bufferMessageToUserMessage(
  message: BufferMessage,
): UserMessage {
  if (message.kind !== "user") {
    throw new Error(`Expected user message, got ${message.kind}`);
  }
  const time = dayjs(message.time).format("YYYY-MM-DD HH:mm:ss");
  const msgId = message.msg_id ?? "";
  return {
    role: "user",
    contents: [
      {
        type: "text",
        text: `<user time="${time}" role_id="${message.role_id}" msg_id="${msgId}">`,
      },
      ...message.contents,
      { type: "text", text: `</user>` },
    ],
  };
}

/**
 * Formats a buffer message as a single prompt line.
 * @param message - Buffer message to format.
 * @returns Prompt line containing time, role, id, and content.
 */
export function bufferMessageToPrompt(message: BufferMessage): string {
  const contents = message.contents
    .map((part) => (part.type === "text" ? part.text : JSON.stringify(part)))
    .join("\n");
  const msgId = message.msg_id ?? "";
  return `- [${dayjs(message.time).format("YYYY-MM-DD HH:mm:ss")}][${message.kind} role_id=${message.role_id} msg_id=${msgId}] ${contents}`;
}

/**
 * Builds a buffer message from user inputs.
 * @param userId - User identifier.
 * @param inputs - User message contents.
 * @param time - Optional timestamp (milliseconds since epoch).
 * @returns BufferMessage representing the user message.
 */
export function bufferMessageFromUser(
  userId: number,
  inputs: InputContent[],
  time: number = Date.now(),
): BufferMessage {
  return {
    kind: "user",
    role_id: userId,
    contents: inputs,
    time,
  };
}

/**
 * Builds a buffer message from an EMA reply.
 * @param actorId - Actor identifier.
 * @param reply - EMA reply response.
 * @param time - Optional timestamp (milliseconds since epoch).
 * @returns BufferMessage representing the EMA reply.
 */
export function bufferMessageFromEma(
  actorId: number,
  reply: EmaReply,
  time: number = Date.now(),
): BufferMessage {
  return {
    kind: "actor",
    role_id: actorId,
    contents: [{ type: "text", text: reply.response }],
    time,
  };
}
