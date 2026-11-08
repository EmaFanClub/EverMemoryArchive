import { describe, it, expect, vi } from "vitest";
import {
  SimpleEmaRouter,
  SimpleEmaInputBatcher,
  formatBatchToXml,
  PenguinChannelWorld,
  type EmaInput,
} from "../src/index.js";

describe("Adversarial Issues Verification Suite", () => {
  describe("Router Issues", () => {
    it("propagates specific domain error message instead of generic Internal Server Error", async () => {
      const router = new SimpleEmaRouter();
      router.serve("/test/error", () => {
        throw new Error("Specific domain error: Resource #404 not found");
      });

      await expect(router.read("/test/error")).rejects.toThrow(
        "Specific domain error: Resource #404 not found",
      );
    });

    it("handles route handlers returning undefined without JSON parse crash", async () => {
      const router = new SimpleEmaRouter();
      router.serve("/test/empty", () => {
        return undefined;
      });

      const result = await router.read("/test/empty");
      expect(result).toBeUndefined();
    });
  });

  describe("PenguinChannelWorld Issues", () => {
    it("parses CLI 'time' field as timestamp instead of falling back to Date.now()", async () => {
      const fixedIsoTime = "2026-11-01T12:00:00.000Z";
      const expectedTimestamp = new Date(fixedIsoTime).getTime();

      const receivedInputs: EmaInput[] = [];
      const mockBatcher = {
        push: (input: EmaInput) => {
          receivedInputs.push(input);
        },
        onBatch: () => ({ dispose: () => {} }),
      };

      const mockFetcher = vi.fn().mockReturnValue([
        {
          id: "msg-time-test",
          sender: "user:testuser",
          text: "Checking timestamp parsing",
          time: fixedIsoTime, // CLI emits 'time', not 'timestamp'
        },
      ]);

      const world = new PenguinChannelWorld({
        channels: ["ch_time_test"],
        pollInterval: 100000,
        dbPath: ":memory:",
        channelFetcher: mockFetcher,
        env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
      });

      const handle = world.start({
        router: new SimpleEmaRouter(),
        inputBatcher: mockBatcher as never,
        registry: { register: () => ({ dispose: () => {} }), get: () => undefined, list: () => [] },
      });

      expect(receivedInputs.length).toBe(1);
      expect(receivedInputs[0].timestamp).toBe(expectedTimestamp);

      handle.dispose();
    });
  });

  describe("InputBatcher Issues", () => {
    it("partitions concurrent inputs from different channels into separate batches", async () => {
      const batcher = new SimpleEmaInputBatcher({
        dbPath: ":memory:",
        debounceMs: 50,
      });

      const batches: Array<ReadonlyArray<EmaInput>> = [];
      batcher.onBatch((batch) => {
        batches.push(batch);
      });

      // Push message from Channel A
      batcher.push({
        id: "msg-a1",
        world: "channel",
        partId: "ch_alpha",
        sender: { id: "user:alice", name: "Alice" },
        content: "Alice in Alpha",
        timestamp: 1000,
      });

      // Push message from Channel B within same debounce window
      batcher.push({
        id: "msg-b1",
        world: "channel",
        partId: "ch_beta",
        sender: { id: "user:bob", name: "Bob" },
        content: "Bob in Beta",
        timestamp: 1001,
      });

      await new Promise((resolve) => setTimeout(resolve, 120));

      // Each channel batch must be separate so XML and reply dispatching do not cross-talk
      expect(batches.length).toBe(2);

      const alphaBatch = batches.find((b) => b.some((m) => m.partId === "ch_alpha"));
      const betaBatch = batches.find((b) => b.some((m) => m.partId === "ch_beta"));

      expect(alphaBatch).toBeDefined();
      expect(betaBatch).toBeDefined();
      expect(alphaBatch?.every((m) => m.partId === "ch_alpha")).toBe(true);
      expect(betaBatch?.every((m) => m.partId === "ch_beta")).toBe(true);

      // Verify formatBatchToXml produces homogeneous payload
      const alphaXml = formatBatchToXml(alphaBatch!);
      expect(alphaXml).toContain("<Channel>ch_alpha</Channel>");
      expect(alphaXml).not.toContain("Bob in Beta");

      const betaXml = formatBatchToXml(betaBatch!);
      expect(betaXml).toContain("<Channel>ch_beta</Channel>");
      expect(betaXml).not.toContain("Alice in Alpha");
    });

    it("recovers or retries pending items when async listener fails", async () => {
      const batcher = new SimpleEmaInputBatcher({
        dbPath: ":memory:",
        debounceMs: 30,
      });

      let attempt = 0;
      let succeededBatch: ReadonlyArray<EmaInput> | null = null;

      batcher.onBatch(async (batch) => {
        attempt++;
        if (attempt === 1) {
          throw new Error("Simulated transient LLM or network failure");
        }
        succeededBatch = batch;
      });

      batcher.push({
        id: "msg-retry-1",
        world: "channel",
        partId: "ch_retry",
        sender: { id: "user:alice", name: "Alice" },
        content: "Please retry me",
        timestamp: 1000,
      });

      // Wait for initial attempt and potential retry
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(attempt).toBeGreaterThanOrEqual(1);
      // Item should not be permanently stuck in 'batched' status
      const db = (
        batcher as unknown as {
          db: { prepare: (sql: string) => { all: () => Array<{ status: string }> } };
        }
      ).db;
      const rows = db.prepare("SELECT status FROM input_queue WHERE id = 'msg-retry-1'").all();
      expect(rows.length).toBe(1);
      // Status should NOT remain stuck in 'batched'
      expect(rows[0].status).not.toBe("batched");
    });

    it("provides lifecycle disposal to clean up timers and close SQLite database", () => {
      const batcher = new SimpleEmaInputBatcher({
        dbPath: ":memory:",
        debounceMs: 10000,
      });

      expect(typeof (batcher as unknown as { dispose?: () => void }).dispose).toBe("function");
    });
  });

  describe("Resource Cleanup Issues", () => {
    it("closes SQLite database on PenguinChannelWorld teardown", () => {
      const world = new PenguinChannelWorld({
        channels: ["ch_cleanup_test"],
        dbPath: ":memory:",
        env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
      });

      expect(typeof (world as unknown as { dispose?: () => void }).dispose).toBe("function");
    });
  });

  describe("CLI Commands (bin/ema.js)", () => {
    it("executes 'world ls' passively without network errors", async () => {
      const { execFileSync } = await import("child_process");
      const cliPath = new URL("../bin/ema.js", import.meta.url).pathname;

      const stdout = execFileSync("node", [cliPath, "world", "ls"], {
        encoding: "utf8",
        env: { ...process.env, PENGUIN_ORG_ID: "" }, // No org id
      });

      expect(stdout).toContain("PenguinChannelWorld /world/channel/*");
    });

    it("executes 'world get' passively to retrieve part list", async () => {
      const { execFileSync } = await import("child_process");
      const cliPath = new URL("../bin/ema.js", import.meta.url).pathname;

      const stdout = execFileSync("node", [cliPath, "world", "get", "/world/channel/parts"], {
        encoding: "utf8",
        env: { ...process.env, PENGUIN_ORG_ID: "" },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed.world).toBe("channel");
      expect(Array.isArray(parsed.parts)).toBe(true);
      expect(parsed.parts.some((p: { id: string }) => p.id === "ch_ema_minimal_test")).toBe(true);
    });
  });
});
