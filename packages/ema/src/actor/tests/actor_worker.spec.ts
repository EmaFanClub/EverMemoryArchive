import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../../llm", () => ({
  LLMClient: class LLMClient {
    constructor(readonly config: Record<string, unknown>) {}
    setRetryCallback() {}
    generate() {
      throw new Error("LLM generate should be mocked by Agent.runWithState.");
    }
  },
}));

import { Agent } from "../../agent";
import { buildSession } from "../../channel";
import { ActorWorker } from "../actor_worker";

describe("ActorWorker token usage context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("runs chat agents with chat token usage context", async () => {
    const conversationId = 42;
    const session = buildSession("web", "chat", "owner");
    const server = {
      dbService: {
        conversationDB: {
          getConversation: vi.fn(async () => ({
            id: conversationId,
            actorId: 1,
            session,
          })),
        },
        getActorLLMConfig: vi.fn(async () => ({
          model: "gpt-5.5",
          apiKey: "test",
          baseUrl: "https://example.com",
        })),
        tokenUsageDB: {
          createTokenUsageRecord: vi.fn(async () => 1),
        },
      },
      memoryManager: {
        getOwnerUid: vi.fn(async () => "owner"),
        buildSystemPromptForChat: vi.fn(async () => "system prompt"),
        addToBuffer: vi.fn(async () => undefined),
      },
    };
    const runWithStateSpy = vi
      .spyOn(Agent.prototype, "runWithState")
      .mockImplementation(async function (this: Agent, state) {
        this.events.emit("llmUsageReceived", {
          createdAt: 1000,
          model: "gpt-5.5",
          usageContext: state.usageContext!,
          usageMetadata: {
            cachedTokens: 1,
            promptTokens: 2,
            thoughtTokens: 3,
            responseTokens: 4,
          },
        });
      });

    const worker = await ActorWorker.create(1, conversationId, server as any);
    await worker.work({
      kind: "system",
      inputs: [{ type: "text", text: "hi" }],
    });

    expect(runWithStateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        usageContext: {
          actorId: 1,
          conversationId,
          source: "chat",
        },
      }),
    );
    expect(
      server.dbService.tokenUsageDB.createTokenUsageRecord,
    ).toHaveBeenCalledWith({
      actorId: 1,
      conversationId,
      createdAt: 1000,
      source: "chat",
      model: "gpt-5.5",
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
      outputTokens: 7,
      totalTokens: 10,
    });
  });

  test("persists keep_silence and emits stop-following before finishing work", async () => {
    const conversationId = 42;
    const session = buildSession("qq", "group", "1000");
    const server = {
      dbService: {
        conversationDB: {
          getConversation: vi.fn(async () => ({
            id: conversationId,
            actorId: 1,
            session,
          })),
        },
        conversationMessageDB: {
          reserveMessageId: vi.fn(async () => 7),
        },
        getActorLLMConfig: vi.fn(async () => ({
          model: "gpt-5.5",
          apiKey: "test",
          baseUrl: "https://example.com",
        })),
        tokenUsageDB: {
          createTokenUsageRecord: vi.fn(async () => 1),
        },
      },
      memoryManager: {
        getOwnerUid: vi.fn(async () => "owner"),
        buildSystemPromptForChat: vi.fn(async () => "system prompt"),
        persistChatMessage: vi.fn(async () => undefined),
        addToBuffer: vi.fn(async () => undefined),
      },
    };
    vi.spyOn(Agent.prototype, "runWithState").mockImplementation(
      async function (this: Agent) {
        this.events.emit("keepSilenceReceived", {
          think: "暂时不再关注这个群聊。",
          stopFollowingGroup: true,
        });
        this.events.emit("runFinished", {
          ok: true,
          msg: "keep_silence",
        });
      },
    );

    const worker = await ActorWorker.create(1, conversationId, server as any);
    const events: string[] = [];
    worker.events.on("keepSilenceReceived", (event) => {
      events.push("keepSilenceReceived");
      expect(event.stopFollowingGroup).toBe(true);
      expect(event.response).toMatchObject({
        kind: "keep_silence",
        actorId: 1,
        conversationId,
        msgId: 7,
        session,
        think: "暂时不再关注这个群聊。",
      });
    });
    worker.events.on("workFinished", () => {
      events.push("workFinished");
    });

    await worker.work({
      kind: "system",
      conversationId,
      inputs: [{ type: "text", text: "hi" }],
    });

    expect(events).toEqual(["keepSilenceReceived", "workFinished"]);
    expect(server.memoryManager.persistChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "keep_silence",
        msgId: 7,
        think: "暂时不再关注这个群聊。",
      }),
    );
    expect(server.memoryManager.addToBuffer).toHaveBeenCalledWith(
      conversationId,
      7,
      true,
      expect.any(Number),
    );
  });

  test("flushes token usage writes before reporting failed agent events", async () => {
    const conversationId = 42;
    const session = buildSession("qq", "group", "1000");
    let resolveTokenUsageWrite: (() => void) | undefined;
    const tokenUsageWrite = new Promise<void>((resolve) => {
      resolveTokenUsageWrite = resolve;
    });
    const server = {
      dbService: {
        conversationDB: {
          getConversation: vi.fn(async () => ({
            id: conversationId,
            actorId: 1,
            session,
          })),
        },
        conversationMessageDB: {
          reserveMessageId: vi.fn(async () => 7),
        },
        getActorLLMConfig: vi.fn(async () => ({
          model: "gpt-5.5",
          apiKey: "test",
          baseUrl: "https://example.com",
        })),
        tokenUsageDB: {
          createTokenUsageRecord: vi.fn(async () => tokenUsageWrite),
        },
      },
      controller: {
        chat: {
          publishConversationMessage: vi.fn(async () => undefined),
        },
      },
      memoryManager: {
        getOwnerUid: vi.fn(async () => "owner"),
        buildSystemPromptForChat: vi.fn(async () => "system prompt"),
        persistChatMessage: vi.fn(async () => {
          throw new Error("persist failed");
        }),
        addToBuffer: vi.fn(async () => undefined),
      },
    };
    vi.spyOn(Agent.prototype, "runWithState").mockImplementation(
      async function (this: Agent, state) {
        this.events.emit("llmUsageReceived", {
          createdAt: 1000,
          model: "gpt-5.5",
          usageContext: state.usageContext!,
          usageMetadata: {
            cachedTokens: 1,
            promptTokens: 2,
            thoughtTokens: 3,
            responseTokens: 4,
          },
        });
        this.events.emit("emaReplyReceived", {
          reply: {
            kind: "text",
            content: "hello",
            think: "尝试回复。",
          },
        });
      },
    );

    const worker = await ActorWorker.create(1, conversationId, server as any);
    const workFinishedEvents: Array<{ ok: boolean; msg: string }> = [];
    worker.events.on("workFinished", (event) => {
      workFinishedEvents.push(event);
    });

    const work = worker.work({
      kind: "system",
      conversationId,
      inputs: [{ type: "text", text: "hi" }],
    });
    await vi.waitFor(() => {
      expect(
        server.dbService.tokenUsageDB.createTokenUsageRecord,
      ).toHaveBeenCalled();
    });
    await Promise.resolve();

    expect(workFinishedEvents).toEqual([]);
    resolveTokenUsageWrite?.();
    await expect(work).rejects.toThrow("persist failed");

    expect(workFinishedEvents).toEqual([
      expect.objectContaining({
        ok: false,
        msg: "persist failed",
      }),
    ]);
  });

  test("serializes ema_reply before later stop-following silence", async () => {
    const conversationId = 42;
    const session = buildSession("qq", "group", "1000");
    let nextMsgId = 6;
    const server = {
      dbService: {
        conversationDB: {
          getConversation: vi.fn(async () => ({
            id: conversationId,
            actorId: 1,
            session,
          })),
        },
        conversationMessageDB: {
          reserveMessageId: vi.fn(async () => {
            nextMsgId += 1;
            return nextMsgId;
          }),
        },
        getActorLLMConfig: vi.fn(async () => ({
          model: "gpt-5.5",
          apiKey: "test",
          baseUrl: "https://example.com",
        })),
        tokenUsageDB: {
          createTokenUsageRecord: vi.fn(async () => 1),
        },
      },
      controller: {
        chat: {
          publishConversationMessage: vi.fn(async () => undefined),
        },
      },
      memoryManager: {
        getOwnerUid: vi.fn(async () => "owner"),
        buildSystemPromptForChat: vi.fn(async () => "system prompt"),
        persistChatMessage: vi.fn(async (message) => {
          if (message.kind === "chat") {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }),
        addToBuffer: vi.fn(async () => undefined),
      },
    };
    vi.spyOn(Agent.prototype, "runWithState").mockImplementation(
      async function (this: Agent) {
        this.events.emit("emaReplyReceived", {
          reply: {
            kind: "text",
            content: "好，那我先不盯着这个群了",
            think: "已经简单回应，后续等有人明确叫我再参与。",
          },
        });
        this.events.emit("keepSilenceReceived", {
          think: "已经简单回应，后续等有人明确叫我再参与。",
          stopFollowingGroup: true,
        });
        this.events.emit("runFinished", {
          ok: true,
          msg: "done",
        });
      },
    );

    const worker = await ActorWorker.create(1, conversationId, server as any);
    const events: string[] = [];
    worker.events.on("actorResponsed", () => {
      events.push("actorResponsed");
    });
    worker.events.on("keepSilenceReceived", () => {
      events.push("keepSilenceReceived");
    });
    worker.events.on("workFinished", () => {
      events.push("workFinished");
    });

    await worker.work({
      kind: "system",
      conversationId,
      inputs: [{ type: "text", text: "hi" }],
    });

    expect(events).toEqual([
      "actorResponsed",
      "keepSilenceReceived",
      "workFinished",
    ]);
    expect(server.memoryManager.persistChatMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "chat",
        msgId: 7,
      }),
    );
    expect(server.memoryManager.persistChatMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "keep_silence",
        msgId: 8,
      }),
    );
  });
});
