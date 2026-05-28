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
});
