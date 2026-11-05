import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_MINIMAL_SYSTEM_PROMPT,
  normalizeChannelMessage,
  executeMinimalTurn,
  assertAgentIdentity,
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

  describe("assertAgentIdentity Guard", () => {
    it("returns agentId when PENGUIN_AGENT_ID is present and trimmed", () => {
      const id = assertAgentIdentity({ PENGUIN_AGENT_ID: " emafanclub_ema_dev " });
      expect(id).toBe("emafanclub_ema_dev");
    });

    it("throws clear error when PENGUIN_AGENT_ID is unset", () => {
      expect(() => assertAgentIdentity({})).toThrow(
        "refusing to dispatch without an agent identity; channel send would run as the server owner"
      );
    });

    it("throws clear error when PENGUIN_AGENT_ID is empty or whitespace", () => {
      expect(() => assertAgentIdentity({ PENGUIN_AGENT_ID: "   " })).toThrow(
        "refusing to dispatch without an agent identity; channel send would run as the server owner"
      );
    });
  });

  it("executes minimal turn without memory or personality, verifying agent identity on dispatch", async () => {
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
      env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
    });

    // Invariants
    expect(result.memoryAccessed).toBe(false);
    expect(result.personalityApplied).toBe(false);
    expect(result.dispatchedAgentId).toBe("emafanclub_ema_dev");

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

  it("refuses to dispatch in executeMinimalTurn when agent identity is missing", async () => {
    const msg: MinimalChannelMessage = {
      id: "msg-2",
      sender: "user:admin",
      channel: "ch_ema_dev",
      text: "Testing dispatch rejection",
    };

    const mockDispatcher = vi.fn();

    await expect(
      executeMinimalTurn(msg, {
        channelDispatcher: mockDispatcher,
        env: {}, // Missing PENGUIN_AGENT_ID
      })
    ).rejects.toThrow(
      "refusing to dispatch without an agent identity; channel send would run as the server owner"
    );

    expect(mockDispatcher).not.toHaveBeenCalled();
  });
});
