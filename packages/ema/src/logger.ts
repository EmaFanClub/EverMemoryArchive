/** Agent run logger */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Message, ToolCall } from "./schema";

/**
 * Agent run logger
 *
 * Responsible for recording the complete interaction process of each agent run, including:
 * - LLM requests and responses
 * - Tool calls and results
 */
export class AgentLogger {
  /**
   * Log directory path.
   *
   * Logs are stored in `packages/ema/logs/` directory under current working dir.
   */
  private readonly logDir: string;

  /**
   * Current log file path.
   */
  private logFile: string | null;

  /**
   * Current log entry index.
   */
  private logIndex: number;

  /**
   * Initialize logger
   *
   * Logs are stored in `packages/ema/logs/` directory under current working dir by default.
   */
  constructor(logDir?: string) {
    this.logDir = logDir ?? path.join(process.cwd(), "packages", "ema", "logs");
    this.logFile = null;
    this.logIndex = 0;
  }

  /**
   * Start new run, create new log file.
   */
  async startNewRun(): Promise<void> {
    await this.ensureLogDir();

    const timestamp = this.formatFilenameTimestamp(new Date());
    const logFilename = `agent_run_${timestamp}.log`;
    this.logFile = path.join(this.logDir, logFilename);
    this.logIndex = 0;

    const now = new Date();
    const header =
      `${"=".repeat(80)}\n` +
      `Agent Run Log - ${this.formatTimestampSeconds(now)}\n` +
      `${"=".repeat(80)}\n\n`;

    await fs.writeFile(this.logFile, header, { encoding: "utf-8" });
  }

  /**
   * Log LLM request.
   *
   * @param messages - Message list.
   * @param tools - Tool list (optional).
   */
  logRequest(
    messages: Message[],
    tools: Array<{ name: string }> | null = null,
  ): Promise<void> {
    this.logIndex += 1;

    const requestData: {
      messages: Array<Record<string, unknown>>;
      tools: string[];
    } = {
      messages: [],
      tools: [],
    };

    for (const msg of messages) {
      const msgDict: Record<string, unknown> = {
        role: msg.role,
        content: msg.content,
      };

      if (msg.thinking) {
        msgDict.thinking = msg.thinking;
      }
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        msgDict.tool_calls = msg.tool_calls;
      }
      if (msg.tool_call_id) {
        msgDict.tool_call_id = msg.tool_call_id;
      }
      if (msg.name) {
        msgDict.name = msg.name;
      }

      requestData.messages.push(msgDict);
    }

    if (tools) {
      requestData.tools = tools.map((tool) => tool.name);
    }

    let content = "LLM Request:\n\n";
    content += JSON.stringify(requestData, null, 2);

    return this.writeLog("REQUEST", content);
  }

  /**
   * Log LLM response.
   *
   * @param content - Response content.
   * @param thinking - Thinking content (optional).
   * @param toolCalls - Tool call list (optional).
   * @param finishReason - Finish reason (optional).
   */
  logResponse(
    content: string,
    thinking: string | null = null,
    toolCalls: ToolCall[] | null = null,
    finishReason: string | null = null,
  ): Promise<void> {
    this.logIndex += 1;

    const responseData: Record<string, unknown> = {
      content,
    };

    if (thinking) {
      responseData.thinking = thinking;
    }

    if (toolCalls && toolCalls.length > 0) {
      responseData.tool_calls = toolCalls;
    }

    if (finishReason) {
      responseData.finish_reason = finishReason;
    }

    let logContent = "LLM Response:\n\n";
    logContent += JSON.stringify(responseData, null, 2);

    return this.writeLog("RESPONSE", logContent);
  }

  /**
   * Log tool execution result.
   *
   * @param toolName - Tool name.
   * @param toolArguments - Tool arguments.
   * @param resultSuccess - Whether successful.
   * @param resultContent - Result content (on success).
   * @param resultError - Error message (on failure).
   */
  logToolResult(
    toolName: string,
    toolArguments: Record<string, unknown>,
    resultSuccess: boolean,
    resultContent: string | null = null,
    resultError: string | null = null,
  ): Promise<void> {
    this.logIndex += 1;

    const toolResultData: Record<string, unknown> = {
      tool_name: toolName,
      arguments: toolArguments,
      success: resultSuccess,
    };

    if (resultSuccess) {
      toolResultData.result = resultContent;
    } else {
      toolResultData.error = resultError;
    }

    let content = "Tool Execution:\n\n";
    content += JSON.stringify(toolResultData, null, 2);

    return this.writeLog("TOOL_RESULT", content);
  }

  /**
   * Get current log file path.
   */
  getLogFilePath(): string | null {
    return this.logFile;
  }

  /**
   * Write log entry.
   *
   * @param logType - Log type (REQUEST, RESPONSE, TOOL_RESULT).
   * @param content - Log content.
   */
  private async writeLog(logType: string, content: string): Promise<void> {
    if (this.logFile === null) {
      return;
    }

    const now = new Date();
    const entry =
      `\n${"-".repeat(80)}\n` +
      `[${this.logIndex}] ${logType}\n` +
      `Timestamp: ${this.formatTimestampMilliseconds(now)}\n` +
      `${"-".repeat(80)}\n` +
      `${content}\n`;

    await fs.appendFile(this.logFile, entry, { encoding: "utf-8" });
  }

  private ensureLogDir(): Promise<void> {
    return fs.mkdir(this.logDir, { recursive: true }).then(() => {});
  }

  private formatFilenameTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = this.pad2(date.getMonth() + 1);
    const day = this.pad2(date.getDate());
    const hours = this.pad2(date.getHours());
    const minutes = this.pad2(date.getMinutes());
    const seconds = this.pad2(date.getSeconds());
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
  }

  private formatTimestampSeconds(date: Date): string {
    const year = date.getFullYear();
    const month = this.pad2(date.getMonth() + 1);
    const day = this.pad2(date.getDate());
    const hours = this.pad2(date.getHours());
    const minutes = this.pad2(date.getMinutes());
    const seconds = this.pad2(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  private formatTimestampMilliseconds(date: Date): string {
    const base = this.formatTimestampSeconds(date);
    const millis = String(date.getMilliseconds()).padStart(3, "0");
    return `${base}.${millis}`;
  }

  private pad2(value: number): string {
    return String(value).padStart(2, "0");
  }
}
