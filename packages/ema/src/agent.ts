import { EventEmitter } from "node:events";

import { Tiktoken } from "js-tiktoken";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

import type { LLMClient } from "./llm";
import { AgentConfig } from "./config";
import { AgentLogger } from "./logger";
import { RetryExhaustedError } from "./retry";
import {
  type LLMResponse,
  type Message,
  type Content,
  type UserMessage,
  type ModelMessage,
  type ToolMessage,
  isModelMessage,
  isToolMessage,
  isUserMessage,
} from "./schema";
import { Tool, ToolResult } from "./tools/base";
import { EmaReplyTool, type EmaReply } from "./tools/ema_reply_tool";

const AgentEventDefs = {
  /* Emitted when token estimation falls back to the simple method. */
  tokenEstimationFallbacked: {} as { error: Error },
  /* Emitted to notify about message summarization steps. */
  summarizeMessagesStarted: {} as {
    localEstimatedTokens: number;
    apiReportedTokens: number;
    tokenLimit: number;
  },
  /* Emitted to notify about message summarization completion. */
  summarizeMessagesFinished: {} as
    | {
        ok: true;
        msg: string;
        oldTokens: number;
        newTokens: number;
        userMessageCount: number;
        summaryCount: number;
      }
    | {
        ok: false;
        msg: string;
      },
  /* Emitted to provide notices during the summarization process. */
  createSummaryFinished: {} as
    | {
        ok: true;
        msg: string;
        roundNum: number;
        summaryText: string;
      }
    | {
        ok: false;
        msg: string;
        roundNum: number;
        error: Error;
      },
  /* Emitted at the start of each agent step. */
  stepStarted: {} as { stepNumber: number; maxSteps: number },
  /* Emitted when the agent finished a run. */
  runFinished: {} as
    | { ok: true; msg: string }
    | { ok: false; msg: string; error: Error },
  /* Emitted when an LLM response is received. */
  llmResponseReceived: {} as { response: LLMResponse },
  /* Emitted when a tool call is started. */
  toolCallStarted: {} as {
    toolCallId: string;
    functionName: string;
    callArgs: Record<string, unknown>;
  },
  /* Emitted when a tool call is finished. */
  toolCallFinished: {} as {
    ok: boolean;
    toolCallId: string;
    functionName: string;
    result: ToolResult;
  },
  emaReplyReceived: {} as { reply: EmaReply },
} as const;

export type AgentEventName = keyof typeof AgentEventDefs;

export type AgentEventContents = {
  [K in AgentEventName]: (typeof AgentEventDefs)[K];
};

export type AgentEventContent<K extends AgentEventName = AgentEventName> =
  (typeof AgentEventDefs)[K];

export class AgentEventsEmitter {
  private readonly emitter = new EventEmitter();

  emit<K extends AgentEventName>(
    event: K,
    content: AgentEventContent<K>,
  ): boolean {
    return this.emitter.emit(event, content);
  }

  on<K extends AgentEventName>(
    event: K,
    handler: (content: AgentEventContent<K>) => void,
  ): AgentEventsEmitter {
    this.emitter.on(event, handler);
    return this;
  }

  off<K extends AgentEventName>(
    event: K,
    handler: (content: AgentEventContent<K>) => void,
  ): AgentEventsEmitter {
    this.emitter.off(event, handler);
    return this;
  }

  once<K extends AgentEventName>(
    event: K,
    handler: (content: AgentEventContent<K>) => void,
  ): AgentEventsEmitter {
    this.emitter.once(event, handler);
    return this;
  }
}

export const AgentEvents = Object.fromEntries(
  Object.keys(AgentEventDefs).map((key) => [key, key]),
) as { [K in AgentEventName]: K };

/** Conversation context container. */
export interface Context {
  /** Message history. */
  messages: Message[];
  /** Available tools. */
  tools: Tool[];
}

/** Manages conversation context and message history for the agent. */
export class ContextManager {
  llmClient: LLMClient;
  tokenLimit: number;
  events: AgentEventsEmitter;
  tools: Tool[];
  toolDict: Map<string, Tool>;
  messages: Message[];
  apiTotalTokens: number;
  skipNextTokenCheck: boolean;

  constructor(
    llmClient: LLMClient,
    tokenLimit: number = 80000,
    events: AgentEventsEmitter,
    messages: Message[] = [],
    tools: Tool[] = [],
  ) {
    this.llmClient = llmClient;
    this.events = events;

    this.tokenLimit = tokenLimit;

    // Initialize message history with system prompt
    this.messages = messages;

    // Store tools
    this.tools = tools;
    this.toolDict = new Map(tools.map((tool) => [tool.name, tool]));

    // Token usage tracking
    // TODO: if messages are provided, we may want to calculate initial token usage
    this.apiTotalTokens = 0;
    this.skipNextTokenCheck = false;
  }

  /** Get current conversation context (messages and tools). */
  get context(): Context {
    return { messages: this.messages, tools: this.tools };
  }

  /** Add a user message to context. */
  addUserMessage(contents: Content[]): void {
    this.messages.push({ role: "user", contents: contents });
  }

  /** Add an model message to context. */
  addModelMessage(response: LLMResponse): void {
    this.messages.push(response.message);
  }

  /** Add a tool result message to context. */
  addToolMessage(result: ToolResult, name: string, toolCallId?: string): void {
    this.messages.push({
      role: "tool",
      id: toolCallId,
      name: name,
      result: result,
    });
  }

  /** Update API reported token count. */
  updateApiTokens(response: LLMResponse): void {
    if (response.totalTokens) {
      this.apiTotalTokens = response.totalTokens;
    }
  }

  /** Accurately calculate token count for message history using tiktoken. */
  estimateTokens(): number {
    const enc = new Tiktoken(cl100k_base);
    try {
      let totalTokens = 0;

      for (const msg of this.messages) {
        if (isUserMessage(msg) || isModelMessage(msg)) {
          for (const block of msg.contents) {
            if (block.type === "text") {
              totalTokens += enc.encode(block.text).length;
            } else {
              totalTokens += enc.encode(JSON.stringify(block)).length;
            }
          }
        }

        if (isModelMessage(msg) && msg.toolCalls) {
          totalTokens += enc.encode(JSON.stringify(msg.toolCalls)).length;
        }

        if (isToolMessage(msg)) {
          totalTokens += enc.encode(
            JSON.stringify({
              content: msg.result.content,
              error: msg.result.error,
              success: msg.result.success,
            }),
          ).length;
        }

        // Metadata overhead per message (approximately 4 tokens)
        totalTokens += 4;
      }

      return totalTokens;
    } catch (error) {
      // console.warn(
      //   `Token estimation fallback due to error: ${(error as Error).message}`,
      // );
      this.events.emit(AgentEvents.tokenEstimationFallbacked, {
        error: error as Error,
      });
      return this.estimateTokensFallback();
    }
  }

  /** Fallback token estimation method (when tiktoken is unavailable). */
  estimateTokensFallback(): number {
    let totalChars = 0;
    for (const msg of this.messages) {
      if (isModelMessage(msg) || isUserMessage(msg)) {
        for (const block of msg.contents) {
          if (block.type === "text") {
            totalChars += block.text.length;
          } else {
            totalChars += JSON.stringify(block).length;
          }
        }
      }

      if (isModelMessage(msg) && msg.toolCalls) {
        totalChars += JSON.stringify(msg.toolCalls).length;
      }

      if (isToolMessage(msg)) {
        totalChars += JSON.stringify({
          content: msg.result.content,
          error: msg.result.error,
          success: msg.result.success,
        }).length;
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

    // console.log(
    //   `\n${Colors.BRIGHT_YELLOW}📊 Token usage - Local estimate: ${estimatedTokens}, ` +
    //     `API reported: ${this.apiTotalTokens}, Limit: ${this.tokenLimit}${Colors.RESET}`,
    // );
    // console.log(
    //   `${Colors.BRIGHT_YELLOW}🔄 Triggering message history summarization...${Colors.RESET}`,
    // );

    this.events.emit(AgentEvents.summarizeMessagesStarted, {
      localEstimatedTokens: estimatedTokens,
      apiReportedTokens: this.apiTotalTokens,
      tokenLimit: this.tokenLimit,
    });

    // Find all user message indices (skip system prompt)
    const userIndices = this.messages
      .map((msg, index) => ({ msg, index }))
      .filter(({ msg }) => isUserMessage(msg))
      .map(({ index }) => index);

    // Need at least 1 user message to perform summary
    if (userIndices.length < 1) {
      // console.log(
      //   `${Colors.BRIGHT_YELLOW}⚠️  Insufficient messages, cannot summarize${Colors.RESET}`,
      // );
      this.events.emit(AgentEvents.summarizeMessagesFinished, {
        ok: false,
        msg: "Insufficient messages, cannot summarize.",
      });
      return;
    }

    // Build new message list
    const newMessages: Message[] =
      this.messages.length > 0 && this.messages[0].role !== "user"
        ? [this.messages[0]]
        : [];
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
            contents: [
              {
                type: "text",
                text: `[Model Execution Summary]\n\n${summaryText}`,
              },
            ],
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
    // console.log(
    //   `${Colors.BRIGHT_GREEN}✓ Summary completed, local tokens: ${estimatedTokens} → ${newTokens}${Colors.RESET}`,
    // );
    // console.log(
    //   `${Colors.DIM}  Structure: system + ${userIndices.length} user messages + ${summaryCount} summaries${Colors.RESET}`,
    // );
    // console.log(
    //   `${Colors.DIM}  Note: API token count will update on next LLM call${Colors.RESET}`,
    // );
    // this.events.emit(AgentEvents.summarizeMessagesNotice, {
    //   content: `${Colors.BRIGHT_GREEN}✓ Summary completed, local tokens: ${estimatedTokens} → ${newTokens}${Colors.RESET}`
    // });
    // this.events.emit(AgentEvents.summarizeMessagesNotice, {
    //   content: `${Colors.DIM}  Structure: system + ${userIndices.length} user messages + ${summaryCount} summaries${Colors.RESET}`
    // });
    // this.events.emit(AgentEvents.summarizeMessagesNotice, {
    //   content: `${Colors.DIM}  Note: API token count will update on next LLM call${Colors.RESET}`
    // });
    this.events.emit(AgentEvents.summarizeMessagesFinished, {
      ok: true,
      msg: "Summary completed and API token count will update on next LLM call.",
      oldTokens: estimatedTokens,
      newTokens: newTokens,
      userMessageCount: userIndices.length,
      summaryCount: summaryCount,
    });
  }

  /** Create summary for one execution round. */
  async createSummary(messages: Message[], roundNum: number): Promise<string> {
    if (messages.length === 0) {
      return "";
    }

    // Build summary content
    let summaryContent = `Round ${roundNum} execution process:\n\n`;
    for (const msg of messages) {
      if (isModelMessage(msg)) {
        const textParts =
          msg.contents?.filter((c) => c.type === "text").map((c) => c.text) ??
          [];
        const contentText = textParts.join("\n");
        summaryContent += `Assistant: ${contentText}\n`;
        const toolCalls = msg.toolCalls ?? [];
        if (toolCalls.length > 0) {
          const toolNames = toolCalls.map((tc) => tc.name);
          summaryContent += `  → Called tools: ${toolNames.join(", ")}\n`;
        }
      } else if (isToolMessage(msg)) {
        const result = msg.result;
        const preview = result.content || result.error || "";
        summaryContent += `  ← Tool returned: ${preview}...\n`;
      }
    }

    // Call LLM to generate concise summary
    try {
      const summaryPrompt = `Please provide a concise summary of the following Agent execution process:\n\n${summaryContent}\n\nRequirements:\n1. Focus on what tasks were completed and which tools were called\n2. Keep key execution results and important findings\n3. Be concise and clear, within 1000 words\n4. Use English\n5. Do not include "user" related content, only summarize the Agent's execution process`;

      const summaryMsg: Message = {
        role: "user",
        contents: [{ type: "text", text: summaryPrompt }],
      };
      const response = await this.llmClient.generate([
        {
          role: "user",
          contents: [
            {
              type: "text",
              text: "You are an assistant skilled at summarizing Agent execution processes.",
            },
          ],
        },
        summaryMsg,
      ]);

      const summaryText =
        (response.message.contents ?? [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n") ?? "";
      // console.log(
      //   `${Colors.BRIGHT_GREEN}✓ Summary for round ${roundNum} generated successfully${Colors.RESET}`,
      // );
      this.events.emit(AgentEvents.createSummaryFinished, {
        ok: true,
        msg: "Summary generation succeeded.",
        roundNum: roundNum,
        summaryText: summaryText,
      });
      return summaryText;
    } catch (error) {
      // console.log(
      //   `${Colors.BRIGHT_RED}✗ Summary generation failed for round ${roundNum}: ${(error as Error).message}${Colors.RESET}`,
      // );
      this.events.emit(AgentEvents.createSummaryFinished, {
        ok: false,
        msg: "Summary generation failed.",
        roundNum: roundNum,
        error: error as Error,
      });
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
  /** Event emitter for agent lifecycle notifications. */
  events: AgentEventsEmitter = new AgentEventsEmitter();
  /** Manages conversation context, history, and available tools. */
  contextManager: ContextManager;
  /** Logger instance used for agent-related logging. */
  logger: AgentLogger;

  constructor(
    /** Configuration for the agent. */
    private config: AgentConfig,
    /** LLM client used by the agent to generate responses. */
    private llm: LLMClient,
    /** System prompt is used to guide the agent's behavior. */
    private systemPrompt: string,
    /** Initial messages for the agent's context. */
    messages: Message[] = [],
    /** Tools available to the agent. */
    tools: Tool[] = [],
  ) {
    // Initialize context manager with tools
    this.contextManager = new ContextManager(
      this.llm,
      this.config.tokenLimit,
      this.events,
      messages,
      tools,
    );

    // Initialize logger
    this.logger = new AgentLogger();
  }

  /** Execute agent loop until task is complete or max steps reached. */
  async run(): Promise<void> {
    // Start new run, initialize log file
    // await this.logger.startNewRun();
    // console.log(
    //   `${Colors.DIM}📝 Log file: ${this.logger.getLogFilePath()}${Colors.RESET}`,
    // );

    const maxSteps = this.config.maxSteps;
    let step = 0;

    while (step < maxSteps) {
      // Check and summarize message history to prevent context overflow
      await this.contextManager.summarizeMessages();

      // Step header with proper width calculation
      // const BOX_WIDTH = 58;
      // const stepText = `${Colors.BOLD}${Colors.BRIGHT_CYAN}💭 Step ${step + 1}/${maxSteps}${Colors.RESET}`;
      // const stepDisplayWidth = stringWidth(stepText);
      // const padding = Math.max(0, BOX_WIDTH - 1 - stepDisplayWidth); // -1 for leading space

      // console.log(`${Colors.DIM}╭${"─".repeat(BOX_WIDTH)}╮${Colors.RESET}`);
      // console.log(
      //   `${Colors.DIM}│${Colors.RESET} ${stepText}${" ".repeat(padding)}${Colors.DIM}│${Colors.RESET}`,
      // );
      // console.log(`${Colors.DIM}╰${"─".repeat(BOX_WIDTH)}╯${Colors.RESET}`);
      this.events.emit(AgentEvents.stepStarted, {
        stepNumber: step + 1,
        maxSteps: maxSteps,
      });

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
          this.systemPrompt,
        );
        this.events.emit(AgentEvents.llmResponseReceived, {
          response: response,
        });
      } catch (error) {
        if (error instanceof RetryExhaustedError) {
          const errorMsg =
            `LLM call failed after ${error.attempts} retries\n` +
            `Last error: ${String(error.lastException)}`;
          // console.log(
          //   `\n${Colors.BRIGHT_RED}❌ Retry failed:${Colors.RESET} ${errorMsg}`,
          // );
          this.events.emit(AgentEvents.runFinished, {
            ok: false,
            msg: errorMsg,
            error: error as RetryExhaustedError,
          });
          return;
        }
        // const errorMsg = `LLM call failed: ${(error as Error).message}`;
        // console.log(
        //   `\n${Colors.BRIGHT_RED}❌ Error:${Colors.RESET} ${errorMsg}`,
        // );
        this.events.emit(AgentEvents.runFinished, {
          ok: false,
          msg: `LLM call failed.`,
          error: error as Error,
        });
        return;
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

      // Add model message to context
      this.contextManager.addModelMessage(response);

      // Print thinking if present
      // if (response.thinking) {
      //   console.log(
      //     `\n${Colors.BOLD}${Colors.MAGENTA}🧠 Thinking:${Colors.RESET}`,
      //   );
      //   console.log(`${Colors.DIM}${response.thinking}${Colors.RESET}`);
      // }

      // // Print assistant response
      // if (response.content) {
      //   console.log(
      //     `\n${Colors.BOLD}${Colors.BRIGHT_BLUE}🤖 Assistant:${Colors.RESET}`,
      //   );
      //   console.log(`${response.content}`);
      // }

      // Check if task is complete (no tool calls)
      if (
        !response.message.toolCalls ||
        response.message.toolCalls.length === 0
      ) {
        this.events.emit(AgentEvents.runFinished, {
          ok: true,
          msg: response.finishReason,
        });
        return;
      }

      // Execute tool calls
      for (const toolCall of response.message.toolCalls) {
        const toolCallId = toolCall.id;
        const functionName = toolCall.name;
        const callArgs = toolCall.args;

        // Tool call header
        // console.log(
        //   `\n${Colors.BRIGHT_YELLOW}🔧 Tool Call:${Colors.RESET} ` +
        //     `${Colors.BOLD}${Colors.CYAN}${functionName}${Colors.RESET}`,
        // );

        // Arguments (formatted display)
        // console.log(`${Colors.DIM}   Arguments:${Colors.RESET}`);
        // Truncate each argument value to avoid overly long output
        // const truncatedArgs: Record<string, unknown> = {};
        // for (const [key, value] of Object.entries(callArgs)) {
        //   const valueStr = String(value);
        //   truncatedArgs[key] =
        //     valueStr.length > 200 ? `${valueStr.slice(0, 200)}...` : value;
        // }
        // const argsJson = JSON.stringify(truncatedArgs, null, 2);
        // for (const line of argsJson.split("\n")) {
        //   console.log(`   ${Colors.DIM}${line}${Colors.RESET}`);
        // }
        this.events.emit(AgentEvents.toolCallStarted, {
          toolCallId: toolCallId ?? "",
          functionName: functionName,
          callArgs: callArgs,
        });

        // Execute tool
        let result: ToolResult;
        const tool = this.contextManager.toolDict.get(functionName);
        if (!tool) {
          result = new ToolResult({
            success: false,
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
          // let resultText = result.content;
          // if (resultText.length > 300) {
          //   resultText = `${resultText.slice(0, 300)}${Colors.DIM}...${Colors.RESET}`;
          // }
          // console.log(
          //   `${Colors.BRIGHT_GREEN}✓ Result:${Colors.RESET} ${resultText}`,
          // );
          this.events.emit(AgentEvents.toolCallFinished, {
            ok: true,
            toolCallId: toolCallId ?? "",
            functionName: functionName,
            result: result,
          });
          if (functionName === "ema_reply" && result.success) {
            this.events.emit(AgentEvents.emaReplyReceived, {
              reply: JSON.parse(result.content!),
            });
            result.content = undefined;
          }
        } else {
          // console.log(
          //   `${Colors.BRIGHT_RED}✗ Error:${Colors.RESET} ` +
          //     `${Colors.RED}${result.error}${Colors.RESET}`,
          // );
          this.events.emit(AgentEvents.toolCallFinished, {
            ok: false,
            toolCallId: toolCallId ?? "",
            functionName: functionName,
            result: result,
          });
        }

        // Add tool result message to context
        this.contextManager.addToolMessage(result, functionName, toolCallId);
      }

      step += 1;
    }

    // Max steps reached
    const errorMsg = `Task couldn't be completed after ${maxSteps} steps.`;
    // console.log(`\n${Colors.BRIGHT_YELLOW}⚠️  ${errorMsg}${Colors.RESET}`);
    this.events.emit(AgentEvents.runFinished, {
      ok: false,
      msg: errorMsg,
      error: new Error(errorMsg),
    });
    return;
  }

  /** Get message history. */
  getHistory(): Message[] {
    return this.contextManager.getHistory();
  }
}
