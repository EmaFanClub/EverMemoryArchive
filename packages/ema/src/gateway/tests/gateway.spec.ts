import { describe, expect, test, vi } from "vitest";

import type { ActorChatResponse } from "../../actor";
import { Gateway } from "../gateway";

function createResponse(session: string): ActorChatResponse {
  return {
    kind: "chat",
    actorId: 1,
    conversationId: 1,
    msgId: 1,
    session,
    ema_reply: {
      kind: "text",
      think: "thinking",
      expression: "普通",
      action: "无",
      content: "你好",
    },
  };
}

describe("Gateway", () => {
  test("dispatchActorResponse sends through the resolved channel", async () => {
    const gateway = new Gateway({} as never);
    const send = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(gateway.channelRegistry, "getChannel").mockReturnValue({
      name: "web",
      send,
    } as never);

    const result = await gateway.dispatchActorResponse(
      createResponse("web-chat-1"),
    );

    expect(result).toEqual({
      ok: true,
      msg: "accepted",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 1,
        session: "web-chat-1",
      }),
    );
  });

  test("dispatchActorResponse rejects invalid sessions", async () => {
    const gateway = new Gateway({} as never);

    const result = await gateway.dispatchActorResponse(
      createResponse("invalid-session"),
    );

    expect(result).toEqual({
      ok: false,
      msg: "Invalid session.",
    });
  });
});
