import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { Agent, AgentEvents } from "./agent";
import { Config } from "./config";
import type { Tool } from "./tools/base";

/** ANSI color helpers for a slightly nicer CLI. */
class Colors {
  static readonly RESET = "\u001b[0m";
  static readonly BOLD = "\u001b[1m";
  static readonly DIM = "\u001b[2m";
  static readonly RED = "\u001b[31m";
  static readonly GREEN = "\u001b[32m";
  static readonly YELLOW = "\u001b[33m";
  static readonly BLUE = "\u001b[34m";
  static readonly MAGENTA = "\u001b[35m";
  static readonly CYAN = "\u001b[36m";
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Minimal interactive runner for the TypeScript Agent. */
export async function main(): Promise<void> {
  // Load configuration (uses built-in search order).
  const config = Config.load();

  // Resolve system prompt (fallback to a simple default when missing).
  const systemPrompt =
    "你的名字是ema，一个由EmaFanClub开发的智能助手。请简洁且有礼貌地回答用户的问题。";

  // No tools by default; plug real Tool instances here when needed.
  const tools: Tool[] = [];

  // Create agent with config values.
  const agent = new Agent(config, systemPrompt, tools);
  attachEventLogging(agent);

  // Simple REPL loop.
  const rl = readline.createInterface({ input, output });
  rl.on("SIGINT", () => {
    console.log(`\n${Colors.DIM}Exiting...${Colors.RESET}`);
    rl.close();
    process.exit(0);
  });
  console.log(
    `${Colors.BOLD}${Colors.CYAN}Type your message, or /exit to quit. Commands: /history, /clear${Colors.RESET}`,
  );

  while (true) {
    console.log(`${Colors.DIM}${"─".repeat(64)}${Colors.RESET}`);
    const userInput = (await rl.question("YOU > ")).trim();
    if (!userInput) {
      continue;
    }
    if (userInput === "/exit" || userInput === "/quit") {
      break;
    }
    if (userInput === "/clear") {
      console.clear();
      continue;
    }
    if (userInput === "/history") {
      for (const msg of agent.contextManager.getHistory()) {
        console.log(
          `${Colors.DIM}${msg.role.toUpperCase()}${Colors.RESET} ${formatJson(msg.content)}`,
        );
      }
      continue;
    }
    agent.contextManager.addUserMessage(userInput);
    await agent.run();
  }

  rl.close();
}

function attachEventLogging(agent: Agent): void {
  const { events } = agent;

  events.on(AgentEvents.tokenEstimationFallbacked, (payload) => {
    console.log(
      `${Colors.YELLOW}Token estimation fell back due to error:${Colors.RESET} ${payload.error.message}`,
    );
  });

  events.on(AgentEvents.summarizeMessagesStarted, (payload) => {
    console.log(
      `${Colors.YELLOW}🔄 Summarizing messages...${Colors.RESET} ` +
        `(local ${payload.localEstimatedTokens}, api ${payload.apiReportedTokens}, limit ${payload.tokenLimit})`,
    );
  });

  events.on(AgentEvents.summarizeMessagesFinished, (payload) => {
    if (payload.ok) {
      console.log(
        `${Colors.GREEN}✓ Summary completed${Colors.RESET} ${payload.oldTokens} → ${payload.newTokens} tokens ` +
          `(users: ${payload.userMessageCount}, summaries: ${payload.summaryCount})`,
      );
    } else {
      console.log(
        `${Colors.RED}✗ Summary failed${Colors.RESET} ${payload.msg}`,
      );
    }
  });

  events.on(AgentEvents.createSummaryFinished, (payload) => {
    if (payload.ok) {
      console.log(
        `${Colors.GREEN}✓ Round ${payload.roundNum} summary generated${Colors.RESET}`,
      );
    } else {
      console.log(
        `${Colors.RED}✗ Round ${payload.roundNum} summary failed${Colors.RESET} ${payload.error.message}`,
      );
    }
  });

  events.on(AgentEvents.stepStarted, (payload) => {
    const stepLabel = `${Colors.BOLD}${Colors.CYAN}💭 Step ${payload.stepNumber}/${payload.maxSteps}${Colors.RESET}`;
    console.log(stepLabel);
  });

  events.on(AgentEvents.llmResponseReceived, (payload) => {
    if (payload.response.thinking) {
      console.log(
        `${Colors.MAGENTA}🧠 Thinking:${Colors.RESET}\n${payload.response.thinking}`,
      );
    }
    if (payload.response.content) {
      console.log(
        `${Colors.BLUE}🤖 EMA:${Colors.RESET} ${payload.response.content}`,
      );
    }
  });

  events.on(AgentEvents.toolCallStarted, (payload) => {
    console.log(
      `${Colors.YELLOW}🔧 Tool Call:${Colors.RESET} ${Colors.BOLD}${payload.functionName}${Colors.RESET}`,
    );
    console.log(`${Colors.DIM}${formatJson(payload.callArgs)}${Colors.RESET}`);
  });

  events.on(AgentEvents.toolCallFinished, (payload) => {
    if (payload.ok && payload.result.success) {
      let resultText = payload.result.content;
      if (resultText.length > 300) {
        resultText = `${resultText.slice(0, 300)}${Colors.DIM}...${Colors.RESET}`;
      }
      console.log(
        `${Colors.GREEN}✓ Tool ${payload.functionName} result:${Colors.RESET} ${resultText}`,
      );
    } else {
      console.log(
        `${Colors.RED}✗ Tool ${payload.functionName} error:${Colors.RESET} ${payload.result.error}`,
      );
    }
  });

  events.on(AgentEvents.runFinished, (payload) => {
    if (payload.ok) {
      console.log(
        `${Colors.GREEN}🎉 Done${Colors.RESET} ` +
          `${Colors.DIM}(API Usage: ${agent.contextManager.apiTotalTokens} tokens)${Colors.RESET}`,
      );
    } else {
      console.log(`${Colors.RED}❌ Failed:${Colors.RESET} ${payload.msg}`);
    }
  });
}
