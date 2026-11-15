import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
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

    it("isolates listener failure and transitions items to completed without leaving stranded batched state", async () => {
      const batcher = new SimpleEmaInputBatcher({
        dbPath: ":memory:",
        debounceMs: 30,
      });

      let attempt = 0;

      batcher.onBatch(async () => {
        attempt++;
        if (attempt === 1) {
          throw new Error("Simulated transient LLM or network failure");
        }
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

    it("never emits duplicate batches across multiple partitions during concurrent or overlapping flushes", async () => {
      const batcher = new SimpleEmaInputBatcher({
        dbPath: ":memory:",
        debounceMs: 10,
      });

      const emittedBatchIds: string[] = [];
      batcher.onBatch(async (batch) => {
        // simulate async turn processing delay (e.g. LLM call)
        await new Promise((resolve) => setTimeout(resolve, 80));
        for (const item of batch) {
          emittedBatchIds.push(item.id);
        }
      });

      // Push message for Partition A
      batcher.push({
        id: "msg-part-a",
        world: "channel",
        partId: "ch_alpha",
        sender: { id: "user:u1", name: "User1" },
        content: "alpha message",
        timestamp: 1000,
      });

      // Push message for Partition B in same initial debounce
      batcher.push({
        id: "msg-part-b",
        world: "channel",
        partId: "ch_beta",
        sender: { id: "user:u2", name: "User2" },
        content: "beta message",
        timestamp: 1001,
      });

      // Wait 15ms so initial flush starts and enters listener on Partition A
      await new Promise((resolve) => setTimeout(resolve, 15));

      // While Partition A is awaiting listener, push message for Partition C (triggering second flush)
      batcher.push({
        id: "msg-part-c",
        world: "channel",
        partId: "ch_gamma",
        sender: { id: "user:u3", name: "User3" },
        content: "gamma message",
        timestamp: 1002,
      });

      // Wait for all flushes and listeners to settle
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Every message must be emitted EXACTLY ONCE
      const countA = emittedBatchIds.filter((id) => id === "msg-part-a").length;
      const countB = emittedBatchIds.filter((id) => id === "msg-part-b").length;
      const countC = emittedBatchIds.filter((id) => id === "msg-part-c").length;

      expect(countA).toBe(1);
      expect(countB).toBe(1);
      expect(countC).toBe(1);

      batcher.dispose();
    });

    it("automatically marks inputs as completed upon flush without requiring manual markCompleted", async () => {
      const batcher = new SimpleEmaInputBatcher({
        dbPath: ":memory:",
        debounceMs: 10,
      });

      batcher.onBatch(() => {
        // Consumer does NOT call markCompleted
      });

      batcher.push({
        id: "msg-auto-complete-1",
        world: "channel",
        partId: "ch_auto",
        sender: { id: "user:u1", name: "User1" },
        content: "auto complete check",
        timestamp: 1000,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const db = (
        batcher as unknown as {
          db: { prepare: (sql: string) => { all: () => Array<{ status: string }> } };
        }
      ).db;
      const rows = db
        .prepare("SELECT status FROM input_queue WHERE id = 'msg-auto-complete-1'")
        .all();
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe("completed");

      batcher.dispose();
    });

    it("drains all pending items when backlog exceeds maxBatchSize", async () => {
      const batcher = new SimpleEmaInputBatcher({
        dbPath: ":memory:",
        debounceMs: 10,
        maxBatchSize: 2,
      });

      const emittedBatchIds: string[] = [];
      batcher.onBatch((batch) => {
        for (const item of batch) {
          emittedBatchIds.push(item.id);
        }
      });

      // Push 5 items with maxBatchSize = 2
      for (let i = 1; i <= 5; i++) {
        batcher.push({
          id: `msg-backlog-${i}`,
          world: "channel",
          partId: "ch_backlog",
          sender: { id: "user:u1", name: "User1" },
          content: `backlog message ${i}`,
          timestamp: 1000 + i,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(emittedBatchIds.length).toBe(5);

      const db = (
        batcher as unknown as {
          db: { prepare: (sql: string) => { all: () => Array<{ status: string }> } };
        }
      ).db;
      const pendingRows = db.prepare("SELECT * FROM input_queue WHERE status = 'pending'").all();
      expect(pendingRows.length).toBe(0);

      batcher.dispose();
    });

    it("provides lifecycle disposal to clean up timers and close SQLite database", () => {
      const batcher = new SimpleEmaInputBatcher({
        dbPath: ":memory:",
        debounceMs: 10000,
      });

      expect(typeof batcher.dispose).toBe("function");
      batcher.dispose();

      const db = (batcher as unknown as { db: { prepare: (sql: string) => unknown } }).db;
      expect(() => db.prepare("SELECT 1")).toThrow(/closed|database/i);
    });
  });

  describe("Resource Cleanup & Error Handling Issues", () => {
    it("closes SQLite database on PenguinChannelWorld teardown", () => {
      const world = new PenguinChannelWorld({
        channels: ["ch_cleanup_test"],
        dbPath: ":memory:",
        env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
      });

      expect(typeof world.dispose).toBe("function");
      world.dispose();

      const db = (world as unknown as { db: unknown }).db;
      expect(db).toBeNull();
    });

    it("safely handles rejected promise from async channelSender without unhandled rejection", async () => {
      const mockSender = vi.fn().mockRejectedValue(new Error("Network timeout to channel service"));
      const world = new PenguinChannelWorld({
        channels: ["ch_err_test"],
        dbPath: ":memory:",
        channelSender: mockSender,
        env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
      });

      const ctx = {
        router: new SimpleEmaRouter(),
        inputBatcher: new SimpleEmaInputBatcher({ dbPath: ":memory:" }),
        registry: { register: () => ({ dispose: () => {} }), get: () => undefined, list: () => [] },
      };

      const actor = { id: "a1", name: "Ema", session: "s1", agentId: "emafanclub_ema_dev" };

      expect(() => {
        world.interact(ctx, actor, "ch_err_test", "reply", "test error handling");
      }).not.toThrow();

      // Give event loop tick to verify no unhandledRejection terminates the process
      await new Promise((resolve) => setTimeout(resolve, 20));

      world.dispose();
      ctx.inputBatcher.dispose();
    });
  });

  describe("CLI Commands (bin/ema.js)", () => {
    let hub: any;
    let tmpDir = "";
    let tmpConfigPath = "";

    beforeAll(async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { ensureSharedWorldServer } = await import("../src/world-server.js");

      tmpDir = fs.mkdtempSync("/tmp/ema-cli-test-fixture-");
      const worldsDir = path.join(tmpDir, "worlds");
      const appDataDir = path.join(tmpDir, "app-data");
      const sakanaStateDir = path.join(appDataDir, "agents", "sakana_kawaii", "agent_state");
      fs.mkdirSync(worldsDir, { recursive: true });
      fs.mkdirSync(sakanaStateDir, { recursive: true });

      tmpConfigPath = path.join(tmpDir, "config.toml");
      fs.writeFileSync(
        tmpConfigPath,
        `app_data_dir = "${appDataDir}"
personas_dir = "/tmp/ema-cli-test-personas"

[world]
host = "127.0.0.1"
port = 17495
url = "http://127.0.0.1:17495"
data_dir = "${worldsDir}"

[world.web]
db_path = "${path.join(worldsDir, "web-world.sqlite")}"
initial_sessions = ["default"]

[world.qq]
db_path = "${path.join(worldsDir, "qq-world.sqlite")}"
self_id = "1000000001"
gateway_url = "http://localhost:13000"
groups = ["2000000001"]
private_users = ["3000000001"]

[world.bilibili]
db_path = "${path.join(worldsDir, "bilibili-world.sqlite")}"
rooms = ["123456"]
video_targets = ["video:BV1xx411c7mD"]
dm_targets = ["3000000001"]

[world.channel]
db_path = "${path.join(worldsDir, "channel-world.sqlite")}"
channels = ["ch_ema_minimal_test", "default_channel"]

[sandbox]
owner = "rei"
allowed_bins = ["node", "bash", "sh", "ls", "grep"]
`,
        "utf8",
      );

      fs.writeFileSync(
        path.join(sakanaStateDir, "config.toml"),
        `[agent]
id = "sakana_kawaii"
name = "大肥鱼"
owner = "rei"

[world]
url = "http://127.0.0.1:17495"

[world.web]
channel_id = "web:chatroom:default"

[sandbox]
owner_approved_bins = []
`,
        "utf8",
      );

      hub = await ensureSharedWorldServer({ configPath: tmpConfigPath });
    });

    afterAll(async () => {
      const fs = await import("node:fs");
      hub?.dispose();
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes 'world ls' passively without network errors", async () => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const cliPath = new URL("../bin/ema.js", import.meta.url).pathname;

      const { stdout } = await execFileAsync(
        "node",
        [cliPath, "world", "ls", "--config", tmpConfigPath],
        {
          encoding: "utf8",
          env: { ...process.env, PENGUIN_ORG_ID: "" }, // No org id
        },
      );

      expect(stdout).toContain("PenguinChannelWorld /world/channel/*");
    });

    it("executes 'world get' passively to retrieve part list", async () => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const cliPath = new URL("../bin/ema.js", import.meta.url).pathname;

      const { stdout } = await execFileAsync(
        "node",
        [cliPath, "world", "get", "/world/channel/parts", "--config", tmpConfigPath],
        {
          encoding: "utf8",
          env: { ...process.env, PENGUIN_ORG_ID: "" },
        },
      );

      const parsed = JSON.parse(stdout);
      expect(parsed.world).toBe("channel");
      expect(Array.isArray(parsed.parts)).toBe(true);
      expect(parsed.parts.some((p: { id: string }) => p.id === "ch_ema_minimal_test")).toBe(true);
    });

    it("panics immediately when global or agent config.toml is missing or malformed", async () => {
      const { loadEmaGlobalConfig, loadEmaAgentConfig } = await import("../src/config.js");

      expect(() => loadEmaGlobalConfig("/tmp/non-existent-ema-config-99999.toml")).toThrow(
        /\[EMA Config Panic\] Global config\.toml not found/,
      );

      expect(() =>
        loadEmaAgentConfig("non_existent_agent_99999", { globalConfigPath: tmpConfigPath }),
      ).toThrow(/\[EMA Config Panic\] Agent config\.toml for 'non_existent_agent_99999' not found/);

      const globalCfg = loadEmaGlobalConfig(tmpConfigPath);
      expect(globalCfg.world.url).toBe("http://127.0.0.1:17495");
      expect(globalCfg.world.dataDir).toContain("/worlds");
      expect(globalCfg.sandbox?.owner).toBe("rei");
      expect(globalCfg.sandbox?.allowedBins).toContain("node");
      expect(globalCfg.sandbox?.allowedBins).not.toContain("ssh");

      const sakanaCfg = loadEmaAgentConfig("sakana_kawaii", globalCfg.appDataDir);
      expect(sakanaCfg.agent.id).toBe("sakana_kawaii");
      expect(sakanaCfg.world.url).toBe("http://127.0.0.1:17495");
      expect(sakanaCfg.sandbox?.ownerApprovedBins).toEqual([]);

      const { assertSandboxBinaryAllowed } = await import("../src/config.js");
      expect(() => assertSandboxBinaryAllowed("node", globalCfg, sakanaCfg)).not.toThrow();
      expect(() => assertSandboxBinaryAllowed("ssh", globalCfg, sakanaCfg)).toThrow(
        /\[EMA Sandbox Panic\] Binary 'ssh' is blocked \(not in sandbox bin whitelist\)\. Execution requires explicit approval from the EMA Agent Owner/,
      );
    });
  });
});
