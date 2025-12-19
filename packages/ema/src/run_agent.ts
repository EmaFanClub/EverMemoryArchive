import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { Agent } from "./agent";
import { Config } from "./config";
import { OpenAIClient } from "./llm/openai_client";
import type { Tool } from "./tools/base";

/** Minimal interactive runner for the TypeScript Agent. */
async function main(): Promise<void> {
  // Load configuration (uses built-in search order).
  const config = Config.load();

  // Resolve system prompt (fallback to a simple default when missing).
  const systemPromptPath = Config.findConfigFile(config.agent.systemPromptPath);
  const systemPrompt =
    "你的名字是ema，一个由EmaFanClub开发的智能助手。请简洁且有礼貌地回答用户的问题。";

  // Initialize LLM client (currently OpenAI protocol only).
  const llm = new OpenAIClient(
    config.llm.apiKey,
    config.llm.apiBase,
    config.llm.model,
    config.llm.retry,
  );

  // No tools by default; plug real Tool instances here when needed.
  const tools: Tool[] = [];

  // Create agent with config values.
  const agent = new Agent(
    llm,
    systemPrompt,
    tools,
    config.agent.maxSteps,
    config.agent.workspaceDir,
  );

  // Simple REPL loop.
  const rl = readline.createInterface({ input, output });
  console.log("Type your message, or /exit to quit.\n");

  while (true) {
    const userInput = (await rl.question("YOU > ")).trim();
    if (!userInput) {
      continue;
    }
    if (userInput === "/exit" || userInput === "/quit") {
      break;
    }
    agent.contextManager.addUserMessage(userInput);
    await agent.run();
    console.log("API Usage:", agent.contextManager.apiTotalTokens, "tokens");
  }

  rl.close();
}

main().catch((err) => {
  console.error("Fatal error in run_agent:", err);
  process.exit(1);
});
