import { collapseContents, type UserMessage } from "../schema";
import { formatTimestamp } from "../utils";
import { formatReplyRef } from "../channel";
import type { ActorInput } from "./base";

function formatWeekday(timestamp: number): string {
  return [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][new Date(timestamp).getDay()];
}

export function buildUserMessageFromActorInput(
  input: ActorInput,
  ownerUid?: string,
): UserMessage {
  const timestamp = input.time ?? Date.now();
  const time = formatTimestamp("YYYY-MM-DD HH:mm:ss", timestamp);
  const weekday = formatWeekday(timestamp);
  if (input.kind === "chat") {
    const speaker =
      ownerUid && input.speaker.uid === ownerUid ? "owner" : "other";
    const metadata = [
      `time="${time}"`,
      `weekday="${weekday}"`,
      `speaker="${speaker}"`,
      `session="${input.speaker.session}"`,
      `uid="${input.speaker.uid}"`,
      `name="${input.speaker.name}"`,
      `msg_id="${input.msgId}"`,
    ];
    if (input.replyTo) {
      metadata.push(`reply_to="${formatReplyRef(input.replyTo)}"`);
    }
    return {
      role: "user",
      contents: [
        {
          type: "text",
          text: `<chat ${metadata.join(" ")}>`,
        },
        ...collapseContents(input.inputs, true),
        { type: "text", text: `</chat>` },
      ],
    };
  }
  return {
    role: "user",
    contents: [
      { type: "text", text: `<system time="${time}" weekday="${weekday}">` },
      ...collapseContents(input.inputs, true),
      { type: "text", text: `</system>` },
    ],
  };
}
