import { describe, expect, test } from "vitest";

import { checkCompleteMessages } from "../agent";
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
});
