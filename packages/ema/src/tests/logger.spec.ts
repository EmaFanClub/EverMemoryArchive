import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let mockHomeDir = "";

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => mockHomeDir,
  };
});

describe("AgentLogger", () => {
  let AgentLogger: typeof import("../logger").AgentLogger;
  let tempHomeDir: string;
  let logger: import("../logger").AgentLogger;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 2, 3, 4, 5, 6));

    tempHomeDir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-ema-logger-home-"),
    );
    mockHomeDir = tempHomeDir;

    ({ AgentLogger } = await import("../logger"));
    logger = new AgentLogger();
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
  });

  it("creates new run log file with header", async () => {
    await logger.startNewRun();

    const logPath = logger.getLogFilePath();
    expect(logPath).toBe(
      path.join(tempHomeDir, ".ema", "log", "agent_run_20240102_030405.log"),
    );

    const content = fs.readFileSync(logPath as string, "utf-8");
    expect(content).toContain("=".repeat(80));
    expect(content).toContain("Agent Run Log - 2024-01-02 03:04:05");
  });

  it("logs request/response/tool results with expected JSON keys and indexes", async () => {
    await logger.startNewRun();

    await logger.logRequest(
      [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "ok",
          thinking: "thought",
          tool_calls: [],
        },
      ],
      [{ name: "bash" }],
    );

    await logger.logResponse(
      "done",
      "response thinking",
      [
        {
          id: "call_1",
          type: "function",
          function: { name: "bash", arguments: { command: "echo 1" } },
        },
      ],
      "stop",
    );

    await logger.logToolResult(
      "bash",
      { command: "echo 1" },
      true,
      "1\n",
      null,
    );

    await logger.logToolResult(
      "bash",
      { command: "bad" },
      false,
      null,
      "error",
    );

    const logPath = logger.getLogFilePath() as string;
    const content = fs.readFileSync(logPath, "utf-8");

    expect(content).toContain("[1] REQUEST");
    expect(content).toContain("Timestamp: 2024-01-02 03:04:05.006");
    expect(content).toMatch(/"tools":\s*\[\s*"bash"\s*\]/m);
    expect(content).toContain('"thinking": "thought"');
    expect(content).not.toContain('"tool_calls": []');

    expect(content).toContain("[2] RESPONSE");
    expect(content).toContain('"finish_reason": "stop"');
    expect(content).toContain('"tool_calls": [');
    expect(content).toContain('"id": "call_1"');
    expect(content).toContain('"function": {');
    expect(content).toContain('"name": "bash"');
    expect(content).toMatch(/"arguments":\s*{\s*"command":\s*"echo 1"\s*}/m);

    expect(content).toContain("[3] TOOL_RESULT");
    expect(content).toContain('"tool_name": "bash"');
    expect(content).toContain('"success": true');
    expect(content).toContain('"result": "1\\n"');

    expect(content).toContain("[4] TOOL_RESULT");
    expect(content).toContain('"success": false');
    expect(content).toContain('"error": "error"');
  });
});
