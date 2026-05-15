import { describe, expect, test, vi } from "vitest";

import { Agent, checkCompleteMessages } from "../agent";
import type { AgentConfig } from "../../config";
import type { LLMClient } from "../../llm";
import type { Message } from "../../llm/schema";

describe("Agent helpers", () => {
  test("checkCompleteMessages returns true for final text response", () => {
    const messages: Message[] = [
      {
        role: "model",
        contents: [{ type: "text", text: "done" }],
      },
    ];

    expect(checkCompleteMessages(messages)).toBe(true);
  });

  test("checkCompleteMessages returns false when model still has tool calls", () => {
    const messages: Message[] = [
      {
        role: "model",
        contents: [
          {
            type: "tool_call",
            toolCallId: "call-1",
            name: "get_skill",
            arguments: { name: "schedule-skill" },
          },
        ],
      },
    ];

    expect(checkCompleteMessages(messages)).toBe(false);
  });

  test("checkCompleteMessages rejects empty history", () => {
    expect(() => checkCompleteMessages([])).toThrow("Message history is empty");
  });

  test("passes state trace id to LLM generation", async () => {
    const traceId = "actors/actor_1/chat/42/2026-05-15/2026-05-15_10-30-12-123";
    const generate = vi.fn().mockResolvedValue({
      role: "model",
      contents: [{ type: "text", text: "done" }],
    });
    const llm = {
      setRetryCallback: vi.fn(),
      generate,
    } as unknown as LLMClient;
    const agent = new Agent({} as AgentConfig, llm);

    await agent.runWithState({
      traceId,
      systemPrompt: "system prompt",
      messages: [{ role: "user", contents: [{ type: "text", text: "hi" }] }],
      tools: [],
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId,
      }),
    );
  });
});
