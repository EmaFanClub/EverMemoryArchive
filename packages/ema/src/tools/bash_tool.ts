/** Shell command execution tool with background process management.
 *
 * Supports both bash (Unix/Linux/macOS) and PowerShell (Windows).
 */

import os from "node:os";
import { ChildProcess, spawn, type StdioOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EOL } from "node:os";

import { Tool, ToolResult } from "./base";

class BashOutputResult extends ToolResult {
  /** Bash command execution result with separated stdout and stderr.
   *
   * Inherits from ToolResult which provides:
   * - success: bool
   * - content: str (used for formatted output message, auto-generated from stdout/stderr)
   * - error: str | None (used for error messages)
   */
  stdout: string;
  stderr: string;
  exitCode: number;
  bashId: string | null;

  constructor(options: {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    bashId?: string | null;
    content?: string;
    error?: string | null;
  }) {
    super({
      success: options.success,
      content: options.content ?? "",
      error: options.error ?? null,
    });
    this.stdout = options.stdout;
    this.stderr = options.stderr;
    this.exitCode = options.exitCode;
    this.bashId = options.bashId ?? null;

    // Auto-format content from stdout and stderr if content is empty.
    if (!this.content) {
      let output = "";
      if (this.stdout) {
        output += this.stdout;
      }
      if (this.stderr) {
        output += `${EOL}[stderr]:${EOL}${this.stderr}`;
      }
      if (this.bashId) {
        output += `${EOL}[bash_id]:${EOL}${this.bashId}`;
      }
      if (this.exitCode) {
        output += `${EOL}[exit_code]:${EOL}${this.exitCode}`;
      }

      if (!output) {
        output = "(no output)";
      }
      this.content = output;
    }
  }
}

class BackgroundShell {
  /** Background shell data container.
   *
   * Pure data class that only stores state and output.
   * IO operations are managed externally by BackgroundShellManager.
   */
  bashId: string;
  command: string;
  process: ChildProcess;
  startTime: number;
  stdoutLines: string[];
  stderrLines: string[];
  stdoutLastReadIndex: number;
  stderrLastReadIndex: number;
  status: "running" | "completed" | "failed" | "terminated" | "error";
  exitCode: number | null;

  constructor(options: {
    bashId: string;
    command: string;
    process: ChildProcess;
    startTime: number;
  }) {
    this.bashId = options.bashId;
    this.command = options.command;
    this.process = options.process;
    this.startTime = options.startTime;
    this.stdoutLines = [];
    this.stderrLines = [];
    this.stdoutLastReadIndex = 0;
    this.stderrLastReadIndex = 0;
    this.status = "running";
    this.exitCode = null;
  }

  addStdout(line: string): void {
    /** Add new stdout line. */
    this.stdoutLines.push(line);
  }

  addStderr(line: string): void {
    /** Add new stderr line. */
    this.stderrLines.push(line);
  }

  getNewOutput(filterPattern?: string | null): {
    stdoutLines: string[];
    stderrLines: string[];
  } {
    /** Get new output since last check, optionally filtered by regex. */
    const stdoutNewLines = this.stdoutLines.slice(this.stdoutLastReadIndex);
    const stderrNewLines = this.stderrLines.slice(this.stderrLastReadIndex);
    this.stdoutLastReadIndex = this.stdoutLines.length;
    this.stderrLastReadIndex = this.stderrLines.length;

    if (filterPattern) {
      try {
        const pattern = new RegExp(filterPattern);
        return {
          stdoutLines: stdoutNewLines.filter((line) => pattern.test(line)),
          stderrLines: stderrNewLines.filter((line) => pattern.test(line)),
        };
      } catch {
        // Invalid regex, return all lines
      }
    }

    return { stdoutLines: stdoutNewLines, stderrLines: stderrNewLines };
  }

  updateStatus(isAlive: boolean, exitCode: number | null = null): void {
    /** Update process status. */
    if (!isAlive) {
      this.status = exitCode === 0 ? "completed" : "failed";
      this.exitCode = exitCode;
    } else {
      this.status = "running";
    }
  }

  async terminate(): Promise<void> {
    /** Terminate the background process. */
    if (this.process.exitCode === null) {
      const gracefulTimeoutMs = 5000;
      const exitedGracefully = await new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onExit = () => {
          if (timer) clearTimeout(timer);
          resolve(true);
        };

        this.process.once("exit", onExit);

        try {
          this.process.kill("SIGTERM");
        } catch {
          // Process may have already exited.
        }

        timer = setTimeout(() => {
          this.process.removeListener("exit", onExit);
          resolve(false);
        }, gracefulTimeoutMs);

        if (this.process.exitCode !== null) {
          this.process.removeListener("exit", onExit);
          if (timer) clearTimeout(timer);
          resolve(true);
        }
      });

      if (!exitedGracefully && this.process.exitCode === null) {
        this.process.kill("SIGKILL");
      }
    }
    this.status = "terminated";
    this.exitCode = this.process.exitCode;
  }
}

class BackgroundShellManager {
  /** Manager for all background shell processes. */
  static _shells: Map<string, BackgroundShell> = new Map();

  static add(shell: BackgroundShell): void {
    /** Add a background shell to management. */
    this._shells.set(shell.bashId, shell);
  }

  static get(bashId: string): BackgroundShell | undefined {
    /** Get a background shell by ID. */
    return this._shells.get(bashId);
  }

  static getAvailableIds(): string[] {
    /** Get all available bash IDs. */
    return Array.from(this._shells.keys());
  }

  static _remove(bashId: string): void {
    /** Remove a background shell from management (internal use only). */
    this._shells.delete(bashId);
  }

  static startMonitor(bashId: string): void {
    /** Start monitoring a background shell's output. */
    const shell = this.get(bashId);
    if (!shell) return;

    const { process } = shell;
    const handleStdoutData = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line) => {
        if (line !== "") {
          shell.addStdout(line);
        }
      });
    };
    const handleStderrData = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line) => {
        if (line !== "") {
          shell.addStderr(line);
        }
      });
    };

    process.stdout?.on("data", handleStdoutData);
    process.stderr?.on("data", handleStderrData);

    process.on("close", (code: number | null) => {
      shell.updateStatus(false, code ?? null);
    });

    process.on("error", (err: Error) => {
      shell.status = "error";
      shell.addStderr(`Monitor error: ${err.message}`);
    });
  }

  static async terminate(bashId: string): Promise<BackgroundShell> {
    /** Terminate a background shell and clean up all resources.
     *
     * Args:
     *     bashId: The unique identifier of the background shell
     *
     * Returns:
     *     The terminated BackgroundShell object
     *
     * Raises:
     *     ValueError: If shell not found
     */
    const shell = this.get(bashId);
    if (!shell) {
      throw new Error(`Shell not found: ${bashId}`);
    }

    await shell.terminate();
    this._remove(bashId);
    return shell;
  }
}

export class BashTool extends Tool {
  /** Execute shell commands in foreground or background.
   *
   * Automatically detects OS and uses appropriate shell:
   * - Windows: PowerShell
   * - Unix/Linux/macOS: bash
   */

  isWindows: boolean;
  shellName: string;

  constructor() {
    /** Initialize BashTool with OS-specific shell detection. */
    super();
    this.isWindows = os.platform() === "win32";
    this.shellName = this.isWindows ? "PowerShell" : "bash";
  }

  get name(): string {
    return "bash";
  }

  get description(): string {
    const shellExamples: Record<string, string> = {
      Windows: `Execute PowerShell commands in foreground or background.

For terminal operations like git, npm, docker, etc. DO NOT use for file operations - use specialized tools.

Parameters:
  - command (required): PowerShell command to execute
  - timeout (optional): Timeout in seconds (default: 120, max: 600) for foreground commands
  - run_in_background (optional): Set true for long-running commands (servers, etc.)

Tips:
  - Quote file paths with spaces: cd "My Documents"
  - Chain dependent commands with semicolon: git add . ; git commit -m "msg"
  - Use absolute paths instead of cd when possible
  - For background commands, monitor with bash_output and terminate with bash_kill

Examples:
  - git status
  - npm test
  - python -m http.server 8080 (with run_in_background=true)`,
      Unix: `Execute bash commands in foreground or background.

For terminal operations like git, npm, docker, etc. DO NOT use for file operations - use specialized tools.

Parameters:
  - command (required): Bash command to execute
  - timeout (optional): Timeout in seconds (default: 120, max: 600) for foreground commands
  - run_in_background (optional): Set true for long-running commands (servers, etc.)

Tips:
  - Quote file paths with spaces: cd "My Documents"
  - Chain dependent commands with &&: git add . && git commit -m "msg"
  - Use absolute paths instead of cd when possible
  - For background commands, monitor with bash_output and terminate with bash_kill

Examples:
  - git status
  - npm test
  - python3 -m http.server 8080 (with run_in_background=true)`,
    };
    return this.isWindows ? shellExamples.Windows : shellExamples.Unix;
  }

  get parameters(): Record<string, any> {
    const cmdDesc = `The ${this.shellName} command to execute. Quote file paths with spaces using double quotes.`;
    return {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: cmdDesc,
        },
        timeout: {
          type: "integer",
          description:
            "Optional: Timeout in seconds (default: 120, max: 600). Only applies to foreground commands.",
          default: 120,
        },
        run_in_background: {
          type: "boolean",
          description:
            "Optional: Set to true to run the command in the background. Use this for long-running commands like servers. You can monitor output using bash_output tool.",
          default: false,
        },
      },
      required: ["command"],
    };
  }

  async execute(
    command: string,
    timeout: number = 120,
    runInBackground: boolean = false,
  ): Promise<ToolResult> {
    /** Execute shell command with optional background execution.
     *
     * Args:
     *     command: The shell command to execute
     *     timeout: Timeout in seconds (default: 120, max: 600)
     *     runInBackground: Set true to run command in background
     *
     * Returns:
     *     BashExecutionResult with command output and status
     */
    try {
      // Validate timeout
      if (timeout > 600) {
        timeout = 600;
      } else if (timeout < 1) {
        timeout = 120;
      }

      // Prepare shell-specific command execution
      const stdioOptions: StdioOptions = ["ignore", "pipe", "pipe"];
      const spawnArgs = this.isWindows
        ? {
            cmd: "powershell.exe",
            args: ["-NoProfile", "-Command", command],
            options: { stdio: stdioOptions },
          }
        : {
            cmd: command,
            args: [],
            options: { shell: true, stdio: stdioOptions },
          };

      if (runInBackground) {
        // Background execution: Create isolated process
        const bashId = randomUUID().slice(0, 8);
        const process = spawn(spawnArgs.cmd, spawnArgs.args, spawnArgs.options);

        const bgShell = new BackgroundShell({
          bashId,
          command,
          process,
          startTime: Date.now(),
        });
        BackgroundShellManager.add(bgShell);
        BackgroundShellManager.startMonitor(bashId);

        const message = `Command started in background. Use bash_output to monitor (bash_id='${bashId}').`;
        const formattedContent = `${message}\n\nCommand: ${command}\nBash ID: ${bashId}`;

        return new BashOutputResult({
          success: true,
          content: formattedContent,
          stdout: `Background command started with ID: ${bashId}`,
          stderr: "",
          exitCode: 0,
          bashId,
        });
      }

      // Foreground execution: Create isolated process
      const process = spawn(spawnArgs.cmd, spawnArgs.args, spawnArgs.options);

      let stdout = "";
      let stderr = "";

      const stdoutPromise = new Promise<void>((resolve) => {
        process.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        process.stdout?.on("end", () => resolve());
      });

      const stderrPromise = new Promise<void>((resolve) => {
        process.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        process.stderr?.on("end", () => resolve());
      });

      const exitPromise = new Promise<number>((resolve) => {
        process.on("close", (code: number | null) => {
          resolve(code ?? 0);
        });
      });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        process.kill();
      }, timeout * 1000);

      const exitCode = await exitPromise;
      clearTimeout(timer);
      await Promise.all([stdoutPromise, stderrPromise]);

      if (timedOut) {
        const errorMsg = `Command timed out after ${timeout} seconds`;
        return new BashOutputResult({
          success: false,
          error: errorMsg,
          stdout: "",
          stderr: errorMsg,
          exitCode: -1,
        });
      }

      const isSuccess = exitCode === 0;
      let errorMsg: string | null = null;
      if (!isSuccess) {
        errorMsg = `Command failed with exit code ${exitCode}`;
        if (stderr.trim()) {
          errorMsg += `\n${stderr.trim()}`;
        }
      }

      return new BashOutputResult({
        success: isSuccess,
        error: errorMsg,
        stdout,
        stderr,
        exitCode,
      });
    } catch (error) {
      const message = (error as Error).message;
      return new BashOutputResult({
        success: false,
        error: message,
        stdout: "",
        stderr: message,
        exitCode: -1,
      });
    }
  }
}

export class BashOutputTool extends Tool {
  /** Retrieve output from background bash shells. */

  get name(): string {
    return "bash_output";
  }

  get description(): string {
    return `Retrieves output from a running or completed background bash shell.

        - Takes a bash_id parameter identifying the shell
        - Always returns only new output since the last check
        - Returns stdout and stderr output along with shell status
        - Supports optional regex filtering to show only lines matching a pattern
        - Use this tool when you need to monitor or check the output of a long-running shell
        - Shell IDs can be found using the bash tool with run_in_background=true

        Process status values:
          - "running": Still executing
          - "completed": Finished successfully
          - "failed": Finished with error
          - "terminated": Was terminated
          - "error": Error occurred

        Example: bash_output(bash_id="abc12345")`;
  }

  get parameters(): Record<string, any> {
    return {
      type: "object",
      properties: {
        bash_id: {
          type: "string",
          description:
            "The ID of the background shell to retrieve output from. Shell IDs are returned when starting a command with run_in_background=true.",
        },
        filter_str: {
          type: "string",
          description:
            "Optional regular expression to filter the output lines. Only lines matching this regex will be included in the result. Any lines that do not match will no longer be available to read.",
        },
      },
      required: ["bash_id"],
    };
  }

  async execute(
    bashId: string,
    filterStr: string | null = null,
  ): Promise<ToolResult> {
    /** Retrieve output from background shell.
     *
     * Args:
     *     bashId: The unique identifier of the background shell
     *     filterStr: Optional regex pattern to filter output lines
     *
     * Returns:
     *     BashOutputResult with shell output including stdout, stderr, status, and success flag
     */
    try {
      const bgShell = BackgroundShellManager.get(bashId);
      if (!bgShell) {
        const availableIds = BackgroundShellManager.getAvailableIds();
        return new BashOutputResult({
          success: false,
          error: `Shell not found: ${bashId}. Available: ${availableIds.length ? availableIds : "none"}`,
          stdout: "",
          stderr: "",
          exitCode: -1,
        });
      }

      const { stdoutLines, stderrLines } = bgShell.getNewOutput(filterStr);
      const stdout = stdoutLines.length ? stdoutLines.join("\n") : "";
      const stderr = stderrLines.length ? stderrLines.join("\n") : "";

      return new BashOutputResult({
        success: true,
        stdout,
        stderr,
        exitCode: bgShell.exitCode ?? 0,
        bashId,
      });
    } catch (error) {
      return new BashOutputResult({
        success: false,
        error: `Failed to get bash output: ${(error as Error).message}`,
        stdout: "",
        stderr: (error as Error).message,
        exitCode: -1,
      });
    }
  }
}

export class BashKillTool extends Tool {
  /** Terminate a running background bash shell. */

  get name(): string {
    return "bash_kill";
  }

  get description(): string {
    return `Kills a running background bash shell by its ID.

        - Takes a bash_id parameter identifying the shell to kill
        - Attempts graceful termination (SIGTERM) first, then forces (SIGKILL) if needed
        - Returns the final status and any remaining output before termination
        - Cleans up all resources associated with the shell
        - Use this tool when you need to terminate a long-running shell
        - Shell IDs can be found using the bash tool with run_in_background=true

        Example: bash_kill(bash_id="abc12345")`;
  }

  get parameters(): Record<string, any> {
    return {
      type: "object",
      properties: {
        bash_id: {
          type: "string",
          description:
            "The ID of the background shell to terminate. Shell IDs are returned when starting a command with run_in_background=true.",
        },
      },
      required: ["bash_id"],
    };
  }

  async execute(bashId: string): Promise<ToolResult> {
    /** Terminate a background shell process.
     *
     * Args:
     *     bashId: The unique identifier of the background shell to terminate
     *
     * Returns:
     *     BashOutputResult with termination status and remaining output
     */
    try {
      const bgShell = BackgroundShellManager.get(bashId);
      const remainingOutput = bgShell
        ? bgShell.getNewOutput()
        : { stdoutLines: [], stderrLines: [] };

      const terminatedShell = await BackgroundShellManager.terminate(bashId);
      const stdout = remainingOutput.stdoutLines.length
        ? remainingOutput.stdoutLines.join("\n")
        : "";
      const stderr = remainingOutput.stderrLines.length
        ? remainingOutput.stderrLines.join("\n")
        : "";

      return new BashOutputResult({
        success: true,
        stdout,
        stderr,
        exitCode: terminatedShell.exitCode ?? 0,
        bashId,
      });
    } catch (error) {
      if ((error as Error).message.startsWith("Shell not found")) {
        const availableIds = BackgroundShellManager.getAvailableIds();
        return new BashOutputResult({
          success: false,
          error: `${(error as Error).message}. Available: ${availableIds.length ? availableIds : "none"}`,
          stdout: "",
          stderr: (error as Error).message,
          exitCode: -1,
        });
      }
      return new BashOutputResult({
        success: false,
        error: `Failed to terminate bash shell: ${(error as Error).message}`,
        stdout: "",
        stderr: (error as Error).message,
        exitCode: -1,
      });
    }
  }
}
