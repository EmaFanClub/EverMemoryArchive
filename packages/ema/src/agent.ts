import fs from "node:fs";
import path from "node:path";

import { get_encoding, Tiktoken } from "@dqbd/tiktoken";
import stringWidth from "string-width";

import type { LLMClientBase } from "./llm/base";
import { OpenAIClient } from "./llm/openai_client";
import { Config } from "./config";
import { AgentLogger } from "./logger";
import { RetryExhaustedError } from "./retry";
import type { LLMResponse, Message } from "./schema";
import { Tool, ToolResult } from "./tools/base";

/** ANSI color codes for terminal output. */
class Colors {
  /** Reset color. */
  static readonly RESET = "\u001b[0m";
  /** Bold text. */
  static readonly BOLD = "\u001b[1m";
  /** Dim text. */
  static readonly DIM = "\u001b[2m";

  // Foreground colors
  static readonly RED = "\u001b[31m";
  static readonly GREEN = "\u001b[32m";
  static readonly YELLOW = "\u001b[33m";
  static readonly BLUE = "\u001b[34m";
  static readonly MAGENTA = "\u001b[35m";
  static readonly CYAN = "\u001b[36m";

  // Bright colors
  static readonly BRIGHT_BLACK = "\u001b[90m";
  static readonly BRIGHT_RED = "\u001b[91m";
  static readonly BRIGHT_GREEN = "\u001b[92m";
  static readonly BRIGHT_YELLOW = "\u001b[93m";
  static readonly BRIGHT_BLUE = "\u001b[94m";
  static readonly BRIGHT_MAGENTA = "\u001b[95m";
  static readonly BRIGHT_CYAN = "\u001b[96m";
  static readonly BRIGHT_WHITE = "\u001b[97m";
}

/** Conversation context container. */
export interface Context {
  /** Message history. */
  messages: Message[];
  /** Available tools. */
  tools: Tool[];
}

/** Manages conversation context and message history for the agent. */
export class ContextManager {
  llmClient: LLMClientBase;
  workspaceDir: string;
  systemPrompt: string;
  tokenLimit: number;
  tools: Tool[];
  toolDict: Map<string, Tool>;
  messages: Message[];
  apiTotalTokens: number;
  skipNextTokenCheck: boolean;

  constructor(
    systemPrompt: string,
    llmClient: LLMClientBase,
    tools: Tool[],
    workspaceDir: string,
    tokenLimit: number = 80000,
  ) {
    this.llmClient = llmClient;

    // Workspace handling and prompt enrichment
    this.workspaceDir = path.resolve(workspaceDir);
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    if (!systemPrompt.includes("Current Workspace")) {
      systemPrompt =
        `${systemPrompt}\n\n## Current Workspace\n` +
        `You are currently working in: \`${this.workspaceDir}\`\n` +
        "All relative paths will be resolved relative to this directory.";
    }

    this.systemPrompt = systemPrompt;
    this.tokenLimit = tokenLimit;

    // Initialize message history with system prompt
    this.messages = [{ role: "system", content: this.systemPrompt }];

    // Store tools
    this.tools = tools;
    this.toolDict = new Map(tools.map((tool) => [tool.name, tool]));

    // Token usage tracking
    this.apiTotalTokens = 0;
    this.skipNextTokenCheck = false;
  }

  /** Get current conversation context (messages and tools). */
  get context(): Context {
    return { messages: this.messages, tools: this.tools };
  }

  /** Add a user message to context. */
  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  /** Add an assistant message to context. */
  addAssistantMessage(response: LLMResponse): void {
    this.messages.push({
      role: "assistant",
      content: response.content,
      thinking: response.thinking,
      tool_calls: response.tool_calls,
    });
  }

  /** Add a tool result message to context. */
  addToolMessage(result: ToolResult, toolCallId: string, name: string): void {
    const content = result.success ? result.content : `Error: ${result.error}`;
    this.messages.push({
      role: "tool",
      content,
      tool_call_id: toolCallId,
      name,
    });
  }

  /** Update API reported token count. */
  updateApiTokens(response: LLMResponse): void {
    if (response.usage) {
      this.apiTotalTokens = response.usage.total_tokens;
    }
  }

  /** Accurately calculate token count for message history using tiktoken. */
  estimateTokens(): number {
    let encoding: Tiktoken | undefined;
    try {
      encoding = get_encoding("cl100k_base");
      let totalTokens = 0;

      for (const msg of this.messages) {
        const content = msg.content;
        if (typeof content === "string") {
          totalTokens += encoding.encode(content).length;
        } else if (Array.isArray(content)) {
          for (const block of content as unknown[]) {
            if (typeof block === "object" && block !== null) {
              totalTokens += encoding.encode(JSON.stringify(block)).length;
            }
          }
        } 

        if (msg.thinking) {
          totalTokens += encoding.encode(msg.thinking).length;
        }

        if (msg.tool_calls) {
          totalTokens += encoding.encode(JSON.stringify(msg.tool_calls)).length;
        }

        // Metadata overhead per message (approximately 4 tokens)
        totalTokens += 4;
      }

      return totalTokens;
    } catch (error) {
      console.warn(
        `Token estimation fallback due to error: ${(error as Error).message}`,
      );
      return this.estimateTokensFallback();
    } finally {
      encoding?.free();
    }
  }

  /** Fallback token estimation method (when tiktoken is unavailable). */
  estimateTokensFallback(): number {
    let totalChars = 0;
    for (const msg of this.messages) {
      const content = msg.content;
      if (typeof content === "string") {
        totalChars += content.length;
      } else if (Array.isArray(content)) {
        for (const block of content as unknown[]) {
          if (typeof block === "object" && block !== null) {
            totalChars += JSON.stringify(block).length;
          }
        }
      }

      if (msg.thinking) {
        totalChars += msg.thinking.length;
      }
      if (msg.tool_calls) {
        totalChars += JSON.stringify(msg.tool_calls).length;
      }
    }

    // Rough estimation: average 2.5 characters = 1 token
    return Math.floor(totalChars / 2.5);
  }

  /**
   * Check and summarize message history if token limit exceeded.
   *
   * Strategy (Agent mode):
   * - Keep all user messages (these are user intents)
   * - Summarize content between each user-user pair (agent execution process)
   * - If last round is still executing (has agent/tool messages but no next user), also summarize
   * - Structure: system -> user1 -> summary1 -> user2 -> summary2 -> user3 -> summary3 (if executing)
   *
   * Summary is triggered when EITHER:
   * - Local token estimation exceeds limit
   * - API reported total_tokens exceeds limit
   */
  async summarizeMessages(): Promise<void> {
    // Skip check if we just completed a summary (wait for next LLM call to update apiTotalTokens)
    if (this.skipNextTokenCheck) {
      this.skipNextTokenCheck = false;
      return;
    }

    const estimatedTokens = this.estimateTokens();

    // Check both local estimation and API reported tokens
    const shouldSummarize =
      estimatedTokens > this.tokenLimit ||
      this.apiTotalTokens > this.tokenLimit;

    // If neither exceeded, no summary needed
    if (!shouldSummarize) {
      return;
    }

    console.log(
      `\n${Colors.BRIGHT_YELLOW}📊 Token usage - Local estimate: ${estimatedTokens}, ` +
        `API reported: ${this.apiTotalTokens}, Limit: ${this.tokenLimit}${Colors.RESET}`,
    );
    console.log(
      `${Colors.BRIGHT_YELLOW}🔄 Triggering message history summarization...${Colors.RESET}`,
    );

    // Find all user message indices (skip system prompt)
    const userIndices = this.messages
      .map((msg, index) => ({ msg, index }))
      .filter(({ msg, index }) => msg.role === "user" && index > 0)
      .map(({ index }) => index);

    // Need at least 1 user message to perform summary
    if (userIndices.length < 1) {
      console.log(
        `${Colors.BRIGHT_YELLOW}⚠️  Insufficient messages, cannot summarize${Colors.RESET}`,
      );
      return;
    }

    // Build new message list
    const newMessages: Message[] = [this.messages[0]]; // Keep system prompt
    let summaryCount = 0;

    // Iterate through each user message and summarize the execution process after it
    for (let i = 0; i < userIndices.length; i += 1) {
      const userIdx = userIndices[i];
      // Add current user message
      newMessages.push(this.messages[userIdx]);

      // Determine message range to summarize
      // If last user, go to end of message list; otherwise to before next user
      const nextUserIdx =
        i < userIndices.length - 1 ? userIndices[i + 1] : this.messages.length;

      // Extract execution messages for this round
      const executionMessages = this.messages.slice(userIdx + 1, nextUserIdx);

      // If there are execution messages in this round, summarize them
      if (executionMessages.length > 0) {
        const summaryText = await this.createSummary(executionMessages, i + 1);
        if (summaryText) {
          const summaryMessage: Message = {
            role: "user",
            content: `[Assistant Execution Summary]\n\n${summaryText}`,
          };
          newMessages.push(summaryMessage);
          summaryCount += 1;
        }
      }
    }

    // Replace message list
    this.messages = newMessages;

    // Skip next token check to avoid consecutive summary triggers
    // (apiTotalTokens will be updated after next LLM call)
    this.skipNextTokenCheck = true;

    const newTokens = this.estimateTokens();
    console.log(
      `${Colors.BRIGHT_GREEN}✓ Summary completed, local tokens: ${estimatedTokens} → ${newTokens}${Colors.RESET}`,
    );
    console.log(
      `${Colors.DIM}  Structure: system + ${userIndices.length} user messages + ${summaryCount} summaries${Colors.RESET}`,
    );
    console.log(
      `${Colors.DIM}  Note: API token count will update on next LLM call${Colors.RESET}`,
    );
  }

  /** Create summary for one execution round. */
  async createSummary(messages: Message[], roundNum: number): Promise<string> {
    if (messages.length === 0) {
      return "";
    }

    // Build summary content
    let summaryContent = `Round ${roundNum} execution process:\n\n`;
    for (const msg of messages) {
      if (msg.role === "assistant") {
        const contentText = msg.content;
        summaryContent += `Assistant: ${contentText}\n`;
        if (msg.tool_calls) {
          const toolNames = msg.tool_calls.map((tc) => tc.function.name);
          summaryContent += `  → Called tools: ${toolNames.join(", ")}\n`;
        }
      } else if (msg.role === "tool") {
        const resultPreview = msg.content;
        summaryContent += `  ← Tool returned: ${resultPreview}...\n`;
      }
    }

    // Call LLM to generate concise summary
    try {
      const summaryPrompt = `Please provide a concise summary of the following Agent execution process:\n\n${summaryContent}\n\nRequirements:\n1. Focus on what tasks were completed and which tools were called\n2. Keep key execution results and important findings\n3. Be concise and clear, within 1000 words\n4. Use English\n5. Do not include "user" related content, only summarize the Agent's execution process`;

      const summaryMsg: Message = { role: "user", content: summaryPrompt };
      const response = await this.llmClient.generate([
        {
          role: "system",
          content:
            "You are an assistant skilled at summarizing Agent execution processes.",
        },
        summaryMsg,
      ]);

      const summaryText = response.content;
      console.log(
        `${Colors.BRIGHT_GREEN}✓ Summary for round ${roundNum} generated successfully${Colors.RESET}`,
      );
      return summaryText;
    } catch (error) {
      console.log(
        `${Colors.BRIGHT_RED}✗ Summary generation failed for round ${roundNum}: ${(error as Error).message}${Colors.RESET}`,
      );
      // Use simple text summary on failure
      return summaryContent;
    }
  }

  /** Get message history (shallow copy). */
  getHistory(): Message[] {
    return [...this.messages];
  }
}

/** Single agent with basic tools and MCP support. */
export class Agent {
  llm: LLMClientBase;
  config: Config;
  contextManager: ContextManager;
  logger: AgentLogger;

  constructor(
    config: Config,
    systemPrompt: string,
    tools: Tool[],
    tokenLimit: number = 80000,
  ) {
    this.config = config;

    this.llm = new OpenAIClient(
      this.config.llm.apiKey,
      this.config.llm.apiBase,
      this.config.llm.model,
      this.config.llm.retry,
    );

    // Initialize context manager with tools
    this.contextManager = new ContextManager(
      systemPrompt,
      this.llm,
      tools,
      this.config.agent.workspaceDir,
      tokenLimit,
    );

    // Initialize logger
    this.logger = new AgentLogger();
  }

  /** Execute agent loop until task is complete or max steps reached. */
  async run(): Promise<string> {
    // Start new run, initialize log file
    // await this.logger.startNewRun();
    // console.log(
    //   `${Colors.DIM}📝 Log file: ${this.logger.getLogFilePath()}${Colors.RESET}`,
    // );

    const maxSteps = this.config.agent.maxSteps;
    let step = 0;

    while (step < maxSteps) {
      // Check and summarize message history to prevent context overflow
      await this.contextManager.summarizeMessages();

      // Step header with proper width calculation
      const BOX_WIDTH = 58;
      const stepText = `${Colors.BOLD}${Colors.BRIGHT_CYAN}💭 Step ${step + 1}/${maxSteps}${Colors.RESET}`;
      const stepDisplayWidth = stringWidth(stepText);
      const padding = Math.max(0, BOX_WIDTH - 1 - stepDisplayWidth); // -1 for leading space

      console.log(`${Colors.DIM}╭${"─".repeat(BOX_WIDTH)}╮${Colors.RESET}`);
      console.log(
        `${Colors.DIM}│${Colors.RESET} ${stepText}${" ".repeat(padding)}${Colors.DIM}│${Colors.RESET}`,
      );
      console.log(`${Colors.DIM}╰${"─".repeat(BOX_WIDTH)}╯${Colors.RESET}`);

      // Log LLM request
      // await this.logger.logRequest(
      //   this.contextManager.context.messages,
      //   this.contextManager.context.tools,
      // );

      // Call LLM with context from context manager
      let response: LLMResponse;
      try {
        response = await this.llm.generate(
          this.contextManager.context.messages,
          this.contextManager.context.tools,
        );
      } catch (error) {
        if (error instanceof RetryExhaustedError) {
          const errorMsg =
            `LLM call failed after ${error.attempts} retries\n` +
            `Last error: ${String(error.lastException)}`;
          console.log(
            `\n${Colors.BRIGHT_RED}❌ Retry failed:${Colors.RESET} ${errorMsg}`,
          );
          return errorMsg;
        }
        const errorMsg = `LLM call failed: ${(error as Error).message}`;
        console.log(
          `\n${Colors.BRIGHT_RED}❌ Error:${Colors.RESET} ${errorMsg}`,
        );
        return errorMsg;
      }

      // Update API reported token usage in context manager
      this.contextManager.updateApiTokens(response);

      // Log LLM response
      // await this.logger.logResponse(
      //   response.content,
      //   response.thinking ?? null,
      //   response.tool_calls ?? null,
      //   response.finish_reason ?? null,
      // );

      // Add assistant message to context
      this.contextManager.addAssistantMessage(response);

      // Print thinking if present
      if (response.thinking) {
        console.log(
          `\n${Colors.BOLD}${Colors.MAGENTA}🧠 Thinking:${Colors.RESET}`,
        );
        console.log(`${Colors.DIM}${response.thinking}${Colors.RESET}`);
      }

      // Print assistant response
      if (response.content) {
        console.log(
          `\n${Colors.BOLD}${Colors.BRIGHT_BLUE}🤖 Assistant:${Colors.RESET}`,
        );
        console.log(`${response.content}`);
      }

      // Check if task is complete (no tool calls)
      if (!response.tool_calls || response.tool_calls.length === 0) {
        return response.content;
      }

      // Execute tool calls
      for (const toolCall of response.tool_calls) {
        const toolCallId = toolCall.id;
        const functionName = toolCall.function.name;
        const callArgs = toolCall.function.arguments as Record<string, unknown>;

        // Tool call header
        console.log(
          `\n${Colors.BRIGHT_YELLOW}🔧 Tool Call:${Colors.RESET} ` +
            `${Colors.BOLD}${Colors.CYAN}${functionName}${Colors.RESET}`,
        );

        // Arguments (formatted display)
        console.log(`${Colors.DIM}   Arguments:${Colors.RESET}`);
        // Truncate each argument value to avoid overly long output
        const truncatedArgs: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(callArgs)) {
          const valueStr = String(value);
          truncatedArgs[key] =
            valueStr.length > 200 ? `${valueStr.slice(0, 200)}...` : value;
        }
        const argsJson = JSON.stringify(truncatedArgs, null, 2);
        for (const line of argsJson.split("\n")) {
          console.log(`   ${Colors.DIM}${line}${Colors.RESET}`);
        }

        // Execute tool
        let result: ToolResult;
        const tool = this.contextManager.toolDict.get(functionName);
        if (!tool) {
          result = new ToolResult({
            success: false,
            content: "",
            error: `Unknown tool: ${functionName}`,
          });
        } else {
          try {
            const props = (
              tool.parameters as { properties?: Record<string, unknown> }
            ).properties;
            const positionalArgs = props
              ? Object.keys(props).map((key) => callArgs[key])
              : Object.values(callArgs);
            result = await tool.execute(...positionalArgs);
          } catch (err) {
            const errorDetail = `${(err as Error).name}: ${(err as Error).message}`;
            const errorTrace = (err as Error).stack ?? "";
            result = new ToolResult({
              success: false,
              content: "",
              error: `Tool execution failed: ${errorDetail}\n\nTraceback:\n${errorTrace}`,
            });
          }
        }

        // Log tool execution result
        // await this.logger.logToolResult(
        //   functionName,
        //   callArgs,
        //   result.success,
        //   result.success ? result.content : null,
        //   result.success ? null : result.error,
        // );

        // Print result
        if (result.success) {
          let resultText = result.content;
          if (resultText.length > 300) {
            resultText = `${resultText.slice(0, 300)}${Colors.DIM}...${Colors.RESET}`;
          }
          console.log(
            `${Colors.BRIGHT_GREEN}✓ Result:${Colors.RESET} ${resultText}`,
          );
        } else {
          console.log(
            `${Colors.BRIGHT_RED}✗ Error:${Colors.RESET} ` +
              `${Colors.RED}${result.error}${Colors.RESET}`,
          );
        }

        // Add tool result message to context
        this.contextManager.addToolMessage(result, toolCallId, functionName);
      }

      step += 1;
    }

    // Max steps reached
    const errorMsg = `Task couldn't be completed after ${maxSteps} steps.`;
    console.log(`\n${Colors.BRIGHT_YELLOW}⚠️  ${errorMsg}${Colors.RESET}`);
    return errorMsg;
  }

  /** Get message history. */
  getHistory(): Message[] {
    return this.contextManager.getHistory();
  }
}
