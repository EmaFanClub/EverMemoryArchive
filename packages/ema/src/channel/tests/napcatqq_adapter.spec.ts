import { afterEach, describe, expect, test, vi } from "vitest";

import { NapCatQQAdapter } from "../index";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NapCatQQAdapter", () => {
  test("decodes private friend pure text message", async () => {
    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      time: 1711111111,
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      self_id: 10001,
      user_id: 12345,
      message_id: 67890,
      message: [{ type: "text", data: { text: "你好" } }],
      raw_message: "你好",
      sender: {
        user_id: 12345,
        nickname: "Alice",
      },
    });

    expect(decoded).toEqual({
      kind: "events",
      events: [
        {
          kind: "chat",
          channel: "qq",
          session: "qq-chat-12345",
          channelMessageId: "67890",
          speaker: {
            session: "qq-chat-12345",
            uid: "12345",
            name: "Alice",
          },
          inputs: [{ type: "text", text: "你好" }],
          time: 1711111111000,
        },
      ],
    });
  });

  test("decodes group normal pure text message", async () => {
    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      time: "1711111112",
      post_type: "message",
      message_type: "group",
      sub_type: "normal",
      self_id: "10001",
      user_id: "12345",
      group_id: "54321",
      message_id: "67891",
      message: "大家好",
      raw_message: "大家好",
      sender: {
        user_id: "12345",
        card: "Alice Card",
        nickname: "Alice",
      },
    });

    expect(decoded).toEqual({
      kind: "events",
      events: [
        {
          kind: "chat",
          channel: "qq",
          session: "qq-group-54321",
          channelMessageId: "67891",
          speaker: {
            session: "qq-group-54321",
            uid: "12345",
            name: "Alice Card",
          },
          inputs: [{ type: "text", text: "大家好" }],
          time: 1711111112000,
        },
      ],
    });
  });

  test("decodes mentions into text content", async () => {
    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      post_type: "message",
      message_type: "group",
      sub_type: "normal",
      self_id: "10001",
      message_id: "111",
      user_id: 12345,
      group_id: 54321,
      message: [
        { type: "at", data: { qq: "10001" } },
        { type: "text", data: { text: "你好" } },
      ],
    });

    expect(decoded).toEqual({
      kind: "events",
      events: [
        expect.objectContaining({
          inputs: [
            { type: "text", text: "@(YOU)" },
            { type: "text", text: "你好" },
          ],
        }),
      ],
    });
  });

  test("decodes non-self mentions into uid text content", async () => {
    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      post_type: "message",
      message_type: "group",
      sub_type: "normal",
      self_id: "10001",
      message_id: "112",
      user_id: 12345,
      group_id: 54321,
      message: [
        { type: "at", data: { qq: "20002" } },
        { type: "text", data: { text: "你好" } },
      ],
    });

    expect(decoded).toEqual({
      kind: "events",
      events: [
        expect.objectContaining({
          inputs: [
            { type: "text", text: "@(20002)" },
            { type: "text", text: "你好" },
          ],
        }),
      ],
    });
  });

  test("decodes market face gif as qq emoji text when gif is unsupported", async () => {
    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      self_id: "10001",
      message_id: "113",
      user_id: 12345,
      message: [
        {
          type: "image",
          data: {
            summary: "[棒]",
            file: "d9-test.gif",
            url: "https://example.com/test.gif",
            emoji_id: "emoji-test",
            emoji_package_id: 234163,
          },
        },
      ],
      raw: {
        elements: [
          {
            marketFaceElement: {
              faceName: "[棒]",
              emojiId: "emoji-test",
              emojiPackageId: 234163,
            },
          },
        ],
      },
    });

    expect(decoded).toEqual({
      kind: "events",
      events: [
        expect.objectContaining({
          inputs: [{ type: "text", text: "[QQ表情：[棒]]" }],
        }),
      ],
    });
  });

  test("decodes face using id when text is empty", async () => {
    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      self_id: "10001",
      message_id: "114",
      user_id: 12345,
      message: [{ type: "face", data: { text: "", id: 318 } }],
    });

    expect(decoded).toEqual({
      kind: "events",
      events: [
        expect.objectContaining({
          inputs: [{ type: "text", text: "[QQ表情：318]" }],
        }),
      ],
    });
  });

  test("fetches image from direct url and converts it to inline data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = Buffer.from("fake-image");
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(body.byteLength),
          },
        });
      }),
    );

    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      self_id: "10001",
      message_id: "115",
      user_id: 12345,
      message: [
        {
          type: "image",
          data: {
            file: "test.jpg",
            url: "https://example.com/test.jpg",
          },
        },
      ],
    });

    expect(decoded).toEqual({
      kind: "events",
      events: [
        expect.objectContaining({
          inputs: [
            {
              type: "inline_data",
              mimeType: "image/jpeg",
              data: Buffer.from("fake-image").toString("base64"),
              text: "[图片：test.jpg]",
            },
          ],
        }),
      ],
    });
  });

  test("treats animated emoji jpg as a normal image instead of qq emoji text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = Buffer.from("animated-emoji-jpg");
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(body.byteLength),
          },
        });
      }),
    );

    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      self_id: "10001",
      message_id: "115-animation",
      user_id: 12345,
      message: [
        {
          type: "image",
          data: {
            summary: "[动画表情]",
            file: "4BB917025DEDBDD6040477E3ADE659C5.jpg",
            url: "https://example.com/animated-emoji.jpg",
            sub_type: 1,
          },
        },
      ],
      raw: {
        elements: [
          {
            picElement: {
              summary: "[动画表情]",
            },
          },
        ],
      },
    });

    expect(decoded).toEqual({
      kind: "events",
      events: [
        expect.objectContaining({
          inputs: [
            {
              type: "inline_data",
              mimeType: "image/jpeg",
              data: Buffer.from("animated-emoji-jpg").toString("base64"),
              text: "[图片：4BB917025DEDBDD6040477E3ADE659C5.jpg]",
            },
          ],
        }),
      ],
    });
  });

  test("uses base64 file payload directly during decode", async () => {
    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      self_id: "10001",
      message_id: "116",
      user_id: 12345,
      message: [
        {
          type: "file",
          data: {
            file: "base64://ZmFrZS1wZGY=",
            mimeType: "application/pdf",
          },
        },
      ],
    });

    expect(decoded).toEqual({
      kind: "events",
      events: [
        expect.objectContaining({
          inputs: [
            {
              type: "inline_data",
              mimeType: "application/pdf",
              data: "ZmFrZS1wZGY=",
              text: "[文件]",
            },
          ],
        }),
      ],
    });
  });

  test("falls back to text when file does not provide base64", async () => {
    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      self_id: "10001",
      message_id: "117",
      user_id: 12345,
      message: [
        {
          type: "file",
          data: {
            file: "测试文件.pdf",
          },
        },
      ],
    });

    expect(decoded).toEqual({
      kind: "events",
      events: [
        expect.objectContaining({
          inputs: [{ type: "text", text: "[文件：测试文件.pdf]" }],
        }),
      ],
    });
  });

  test("fetches file by file_id and converts it to inline data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = Buffer.from("fake-pdf");
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-length": String(body.byteLength),
          },
        });
      }),
    );

    const adapter = new NapCatQQAdapter(async (apiCall) => {
      expect(apiCall).toEqual({
        method: "get_private_file_url",
        params: {
          user_id: "12345",
          file_id: "file-1",
        },
      });
      return {
        ok: true,
        data: {
          url: "https://example.com/test.pdf",
        },
      };
    });

    const decoded = await adapter.decode({
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      self_id: "10001",
      message_id: "118",
      user_id: 12345,
      message: [
        {
          type: "file",
          data: {
            file: "测试文件.pdf",
            file_id: "file-1",
          },
        },
      ],
    });

    expect(decoded).toEqual({
      kind: "events",
      events: [
        expect.objectContaining({
          inputs: [
            {
              type: "inline_data",
              mimeType: "application/pdf",
              data: Buffer.from("fake-pdf").toString("base64"),
              text: "[文件：测试文件.pdf]",
            },
          ],
        }),
      ],
    });
  });

  test("rejects cq-code string messages", async () => {
    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      message_id: "1",
      user_id: 12345,
      message: "[CQ:image,file=1.jpg]",
    });

    expect(decoded).toEqual({ kind: "ignore" });
  });

  test("builds private and group API calls for replies", async () => {
    const adapter = new NapCatQQAdapter();

    expect(
      await adapter.chatToAPICall({
        kind: "chat",
        actorId: 1,
        conversationId: 1,
        msgId: 1,
        session: "qq-chat-12345",
        ema_reply: {
          kind: "text",
          think: "",
          expression: "普通",
          action: "无",
          content: "你好",
        },
        time: 1,
      }),
    ).toEqual({
      method: "send_private_msg",
      params: {
        user_id: "12345",
        message: [{ type: "text", data: { text: "你好" } }],
      },
    });

    expect(
      await adapter.chatToAPICall({
        kind: "chat",
        actorId: 1,
        conversationId: 1,
        msgId: 1,
        session: "qq-group-54321",
        ema_reply: {
          kind: "text",
          think: "",
          expression: "普通",
          action: "无",
          content: "大家好",
        },
        time: 1,
      }),
    ).toEqual({
      method: "send_group_msg",
      params: {
        group_id: "54321",
        message: [{ type: "text", data: { text: "大家好" } }],
      },
    });
  });

  test("builds image segments for sticker replies", async () => {
    const adapter = new NapCatQQAdapter();

    expect(
      await adapter.chatToAPICall({
        kind: "chat",
        actorId: 1,
        conversationId: 1,
        msgId: 1,
        session: "qq-chat-12345",
        ema_reply: {
          kind: "sticker",
          think: "",
          expression: "开心",
          action: "比心",
          content: "ZmFrZS1zdGlja2Vy",
        },
        time: 1,
      }),
    ).toEqual({
      method: "send_private_msg",
      params: {
        user_id: "12345",
        message: [
          {
            type: "image",
            data: {
              file: "base64://ZmFrZS1zdGlja2Vy",
            },
          },
        ],
      },
    });
  });

  test("encodes API call using onebot websocket envelope", async () => {
    const adapter = new NapCatQQAdapter();
    expect(
      await adapter.encode(
        {
          method: "send_private_msg",
          params: {
            user_id: "12345",
            message: [{ type: "text", data: { text: "你好" } }],
          },
        },
        "req-1",
      ),
    ).toBe(
      JSON.stringify({
        action: "send_private_msg",
        params: {
          user_id: "12345",
          message: [{ type: "text", data: { text: "你好" } }],
        },
        echo: "req-1",
      }),
    );
  });

  test("extracts channel message id from send response", () => {
    const adapter = new NapCatQQAdapter();
    expect(
      adapter.resolveChannelMessageId(
        {
          ok: true,
          data: {
            message_id: 998877,
          },
        },
        {
          method: "send_private_msg",
        },
      ),
    ).toBe("998877");
  });

  test("decodes action response", async () => {
    const adapter = new NapCatQQAdapter();
    const decoded = await adapter.decode({
      status: "ok",
      retcode: 0,
      data: {
        message_id: 998877,
      },
      echo: "req-2",
    });

    expect(decoded).toEqual({
      kind: "response",
      requestId: "req-2",
      response: {
        ok: true,
        data: {
          message_id: 998877,
        },
      },
    });
  });
});
