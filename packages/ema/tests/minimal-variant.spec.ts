import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_MINIMAL_SYSTEM_PROMPT,
  normalizeChannelMessage,
  executeMinimalTurn,
  type MinimalChannelMessage,
} from "../src/minimal.js";

describe("Minimal EMA Prototype Variant", () => {
  it("defines default minimal system prompt with no persona and no memory", () => {
    expect(DEFAULT_MINIMAL_SYSTEM_PROMPT).toContain("minimal assistant prototype");
    expect(DEFAULT_MINIMAL_SYSTEM_PROMPT).toContain("Do not adopt a persona or emotional tone");
    expect(DEFAULT_MINIMAL_SYSTEM_PROMPT).toContain(
      "EverMemoryArchive memory storage and retrieval are disabled"
    );
  });

  it("normalizes raw channel messages into standard MinimalChannelMessage", () => {
    const raw = {
      id: "msg-12345",
      sender: "user:admin",
      channelId: "ch_ema_dev",
      text: "Hello minimal agent!",
      time: "2026-11-05T10:00:00.000Z",
    };
    const msg = normalizeChannelMessage(raw);

    expect(msg.id).toBe("msg-12345");
    expect(msg.sender).toBe("user:admin");
    expect(msg.channel).toBe("ch_ema_dev");
    expect(msg.text).toBe("Hello minimal agent!");
    expect(msg.timestamp).toBe("2026-11-05T10:00:00.000Z");
  });

  it("executes minimal turn without memory or personality, calling invoker and dispatcher", async () => {
    const msg: MinimalChannelMessage = {
      id: "msg-1",
      sender: "user:admin",
      channel: "ch_ema_dev",
      text: "Ping minimal prototype",
      timestamp: "2026-11-05T10:05:00.000Z",
    };

    const mockInvoker = vi.fn().mockResolvedValue("Pong! Minimal prototype is operational.");
    const mockDispatcher = vi.fn().mockResolvedValue(undefined);

    const result = await executeMinimalTurn(msg, {
      llmInvoker: mockInvoker,
      channelDispatcher: mockDispatcher,
    });

    // Invariants
    expect(result.memoryAccessed).toBe(false);
    expect(result.personalityApplied).toBe(false);

    // Prompt & Invoker
    expect(mockInvoker).toHaveBeenCalledTimes(1);
    expect(mockInvoker).toHaveBeenCalledWith("Ping minimal prototype", DEFAULT_MINIMAL_SYSTEM_PROMPT);

    // Dispatcher & Output formatting
    expect(mockDispatcher).toHaveBeenCalledTimes(1);
    expect(mockDispatcher).toHaveBeenCalledWith(
      "ch_ema_dev",
      "@user:admin Pong! Minimal prototype is operational."
    );

    expect(result.response).toBe("Pong! Minimal prototype is operational.");
    expect(result.outputMessage).toBe("@user:admin Pong! Minimal prototype is operational.");
    expect(result.outputChannel).toBe("ch_ema_dev");
  });
});
