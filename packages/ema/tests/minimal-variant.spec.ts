import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_MINIMAL_SYSTEM_PROMPT,
  normalizeChannelMessage,
  executeMinimalTurn,
  assertAgentIdentity,
  isEligibleChannelMessage,
  filterNewUserMessages,
  parseWatchDuration,
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

  describe("Watch Mode Filter & Deduplication Logic", () => {
    it("allows messages from user:* principals that are not in seenIds", () => {
      const seen = new Set(["msg-1"]);
      expect(isEligibleChannelMessage({ id: "msg-2", sender: "user:admin" }, seen)).toBe(true);
      expect(isEligibleChannelMessage({ id: "msg-3", sender: "user:alice" }, seen)).toBe(true);
    });

    it("rejects messages already present in seenIds", () => {
      const seen = new Set(["msg-1"]);
      expect(isEligibleChannelMessage({ id: "msg-1", sender: "user:admin" }, seen)).toBe(false);
    });

    it("rejects messages from agent:* and system to prevent reply loops", () => {
      const seen = new Set<string>();
      expect(
        isEligibleChannelMessage({ id: "msg-2", sender: "agent:emafanclub_ema_dev" }, seen)
      ).toBe(false);
      expect(
        isEligibleChannelMessage({ id: "msg-3", sender: "agent:ema_minimal" }, seen)
      ).toBe(false);
      expect(isEligibleChannelMessage({ id: "msg-4", sender: "system" }, seen)).toBe(false);
    });

    it("rejects messages missing id or sender", () => {
      const seen = new Set<string>();
      expect(isEligibleChannelMessage({ sender: "user:admin" }, seen)).toBe(false);
      expect(isEligibleChannelMessage({ id: "msg-5" }, seen)).toBe(false);
    });

    it("filters and normalizes batches of raw messages", () => {
      const seen = new Set(["msg-seen"]);
      const rawBatch = [
        { id: "msg-seen", sender: "user:admin", text: "Old message", time: "2026-11-05T10:00:00Z" },
        { id: "msg-agent", sender: "agent:ema_dev", text: "Agent message", time: "2026-11-05T10:01:00Z" },
        { id: "msg-system", sender: "system", text: "System notice", time: "2026-11-05T10:02:00Z" },
        { id: "msg-new-1", sender: "user:admin", text: "hi", time: "2026-11-05T11:03:40Z" },
        { id: "msg-new-2", sender: "user:admin", text: "@emafanclub_ema_dev hi", time: "2026-11-05T11:03:52Z" },
      ];

      const filtered = filterNewUserMessages(rawBatch, seen, "ch_ema_minimal_test");
      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe("msg-new-1");
      expect(filtered[0].text).toBe("hi");
      expect(filtered[0].channel).toBe("ch_ema_minimal_test");
      expect(filtered[1].id).toBe("msg-new-2");
      expect(filtered[1].text).toBe("@emafanclub_ema_dev hi");
    });

    it("parses watch duration correctly", () => {
      expect(parseWatchDuration("4h")).toBe(4 * 60 * 60 * 1000);
      expect(parseWatchDuration("30m")).toBe(30 * 60 * 1000);
      expect(parseWatchDuration("45s")).toBe(45 * 1000);
      expect(parseWatchDuration("500ms")).toBe(500);
      expect(parseWatchDuration(60000)).toBe(60000);
      expect(parseWatchDuration("")).toBe(4 * 60 * 60 * 1000); // Default 4h
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
