import dayjs from "dayjs";
import type { Content, UserMessage } from "../schema";
import type { EmaReply } from "../tools/ema_reply_tool";
import type { BufferMessage } from "./memory";

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
  const context = [
    "<CONTEXT>",
    `<time>${dayjs(message.time).format("YYYY-MM-DD HH:mm:ss")}</time>`,
    `<id>${message.id}</id>`,
    `<name>${message.name}</name>`,
    "</CONTEXT>",
  ].join("\n");
  return {
    role: "user",
    contents: [{ type: "text", text: context }, ...message.contents],
  };
}

/**
 * Formats a buffer message as a single prompt line.
 * @param message - Buffer message to format.
 * @returns Prompt line containing time, role, id, name, and content.
 */
export function bufferMessageToPrompt(message: BufferMessage): string {
  const contents = message.contents
    .map((part) => (part.type === "text" ? part.text : JSON.stringify(part)))
    .join("\n");
  return `- [${dayjs(message.time).format("YYYY-MM-DD HH:mm:ss")}][role:${
    message.kind
  }][id:${message.id}][name:${message.name}] ${contents}`;
}

/**
 * Builds a buffer message from user inputs.
 * @param userId - User identifier.
 * @param userName - User display name.
 * @param inputs - User message contents.
 * @param time - Optional timestamp (milliseconds since epoch).
 * @returns BufferMessage representing the user message.
 */
export function bufferMessageFromUser(
  userId: number,
  userName: string,
  inputs: Content[],
  time: number = Date.now(),
): BufferMessage {
  return {
    kind: "user",
    name: userName,
    id: userId,
    contents: inputs,
    time,
  };
}

/**
 * Builds a buffer message from an EMA reply.
 * @param actorId - Actor identifier.
 * @param actorName - Actor display name.
 * @param reply - EMA reply response.
 * @param time - Optional timestamp (milliseconds since epoch).
 * @returns BufferMessage representing the EMA reply.
 */
export function bufferMessageFromEma(
  actorId: number,
  actorName: string,
  reply: EmaReply,
  time: number = Date.now(),
): BufferMessage {
  return {
    kind: "actor",
    name: actorName,
    id: actorId,
    contents: [{ type: "text", text: reply.response }],
    time,
  };
}
