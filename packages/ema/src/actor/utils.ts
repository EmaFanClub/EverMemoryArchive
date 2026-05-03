import { expandContentsForModel, type UserMessage } from "../shared/schema";
import { formatTimestamp } from "../shared/utils";
import { formatReplyRef } from "../channel";
import type { ActorInput } from "./base";

export function buildUserMessageFromActorInput(
  input: ActorInput,
  ownerUid?: string,
): UserMessage {
  const timestamp = input.time ?? Date.now();
  const time = formatTimestamp("YYYY-MM-DD HH:mm:ss", timestamp);
  if (input.kind === "chat") {
    const speaker =
      ownerUid && input.speaker.uid === ownerUid ? "owner" : "other";
    const metadata = [
      `time="${time}"`,
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
        ...expandContentsForModel(input.inputs),
        { type: "text", text: `</chat>` },
      ],
    };
  }
  return {
    role: "user",
    contents: [
      { type: "text", text: `<system time="${time}">` },
      ...expandContentsForModel(input.inputs),
      { type: "text", text: `</system>` },
    ],
  };
}
