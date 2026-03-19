import { describe, expect, test } from "vitest";

import { buildUserMessageFromActorInput } from "../actor";

describe("buildUserMessageFromActorInput", () => {
  test("preserves inline image data in user messages", () => {
    const message = buildUserMessageFromActorInput(
      {
        kind: "chat",
        conversationId: 1,
        msgId: 1,
        channelMessageId: "1",
        speaker: {
          session: "qq-chat-1",
          uid: "1",
          name: "alice",
        },
        inputs: [
          { type: "text", text: "看看这个" },
          { type: "text", text: "[图片：test.jpg]" },
          {
            type: "inline_data",
            mimeType: "image/jpeg",
            data: "base64-data",
          },
        ],
        time: Date.UTC(2026, 2, 19, 0, 0, 0),
      },
      "1",
    );

    expect(message.role).toBe("user");
    expect(message.contents[0]).toEqual({
      type: "text",
      text: expect.stringContaining(
        'weekday="Thursday" speaker="owner" session="qq-chat-1" uid="1" name="alice" msg_id="1"',
      ),
    });
    expect(message.contents.slice(1)).toEqual([
      { type: "text", text: "看看这个" },
      { type: "text", text: "[图片：test.jpg]" },
      {
        type: "inline_data",
        mimeType: "image/jpeg",
        data: "base64-data",
      },
      {
        type: "text",
        text: "</chat>",
      },
    ]);
  });

  test("keeps generated text label for non-image media and omits inline data", () => {
    const message = buildUserMessageFromActorInput(
      {
        kind: "chat",
        conversationId: 1,
        msgId: 2,
        channelMessageId: "2",
        speaker: {
          session: "qq-chat-1",
          uid: "1",
          name: "alice",
        },
        inputs: [
          { type: "text", text: "先看这个文件" },
          { type: "text", text: "[文件：test.pdf]" },
          {
            type: "inline_data",
            mimeType: "application/pdf",
            data: "base64-data",
          },
        ],
        time: Date.UTC(2026, 2, 19, 0, 0, 1),
      },
      "1",
    );

    expect(message.contents[0]).toEqual({
      type: "text",
      text: expect.stringContaining(
        'weekday="Thursday" speaker="owner" session="qq-chat-1" uid="1" name="alice" msg_id="2"',
      ),
    });
    expect(message.contents.slice(1)).toEqual([
      { type: "text", text: "先看这个文件" },
      { type: "text", text: "[文件：test.pdf]" },
      { type: "text", text: "（application/pdf）" },
      {
        type: "text",
        text: "</chat>",
      },
    ]);
  });
});
