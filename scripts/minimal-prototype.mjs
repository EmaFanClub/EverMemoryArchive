#!/usr/bin/env node
/**
 * Minimal EMA Prototype CLI Runner
 *
 * Demonstrates the 4 core properties of the Minimal variant:
 * 1. No personality (neutral system prompt)
 * 2. No memory (EverMemoryArchive bypassed)
 * 3. Penguin channel as input (reads from `penguin org channel tail`)
 * 4. Penguin channel as output (dispatches to `penguin org channel send`)
 *
 * Usage:
 *   node scripts/minimal-prototype.mjs [--channel <id>] [--read-latest] [--prompt <text>] [--dry-run]
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  DEFAULT_MINIMAL_SYSTEM_PROMPT,
  normalizeChannelMessage,
  executeMinimalTurn,
} from "../packages/ema/dist/index.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    channel: "ch_ema_dev",
    readLatest: false,
    prompt: "",
    sender: "user:admin",
    dryRun: false,
    dispatch: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--channel") {
      options.channel = args[++i];
    } else if (arg === "--read-latest") {
      options.readLatest = true;
    } else if (arg === "--prompt") {
      options.prompt = args[++i];
    } else if (arg === "--sender") {
      options.sender = args[++i];
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--dispatch") {
      options.dispatch = true;
    }
  }
  return options;
}

function fetchLatestChannelMessage(channel) {
  try {
    const raw = execFileSync("penguin", ["org", "channel", "tail", "--channel", channel, "-n", "1", "--json"], {
      encoding: "utf8",
    });
    const parsed = JSON.parse(raw);
    const msg = parsed.messages && parsed.messages[0];
    if (!msg) return null;
    return normalizeChannelMessage({ ...msg, channelId: channel });
  } catch (err) {
    console.error(`[Error] Failed to fetch channel messages: ${err.message}`);
    return null;
  }
}

async function runLlm(prompt, systemPrompt) {
  try {
    // Run minimal LLM turn via penguin run
    const out = execFileSync(
      "penguin",
      [
        "run",
        "-m",
        `${systemPrompt}\n\nUser request: ${prompt}`,
        "--approve",
        "allow-all",
        "--timeout",
        "25s",
      ],
      { encoding: "utf8", timeout: 30000 }
    );
    // Extract the final assistant reply text (filter out headers/stats)
    const lines = out.split("\n");
    const cleanLines = lines.filter((line) => {
      if (line.startsWith("PenguinHarness run")) return false;
      if (line.startsWith("Agent:")) return false;
      if (line.startsWith("Workspace:")) return false;
      if (line.startsWith("Model:")) return false;
      if (line.startsWith("Server:")) return false;
      if (line.startsWith("[stats]")) return false;
      if (line.startsWith("**") && line.endsWith("**")) return false;
      return true;
    });
    return cleanLines.join("\n").trim();
  } catch (err) {
    return `[Minimal Prototype Fallback] Processed prompt "${prompt}" without memory or personality.`;
  }
}

async function dispatchToChannel(channel, message) {
  console.log(`[Dispatching to ${channel}]:\n${message}`);
  execFileSync("penguin", ["org", "channel", "send", "--channel", channel, "-m", message], {
    encoding: "utf8",
  });
}

async function main() {
  const opts = parseArgs();
  console.log("=== Minimal EMA Prototype Runner ===");
  console.log(`Channel: ${opts.channel}`);
  console.log(`Dry Run: ${opts.dryRun}`);

  let inputMessage = null;
  if (opts.readLatest) {
    console.log(`Reading latest message from channel ${opts.channel}...`);
    inputMessage = fetchLatestChannelMessage(opts.channel);
  }

  if (!inputMessage) {
    inputMessage = {
      id: "cli-test",
      sender: opts.sender,
      channel: opts.channel,
      text: opts.prompt || "Status check for Minimal EMA Prototype.",
      timestamp: new Date().toISOString(),
    };
  }

  console.log(`Input sender: ${inputMessage.sender}`);
  console.log(`Input text: ${inputMessage.text}`);

  const turnResult = await executeMinimalTurn(inputMessage, {
    llmInvoker: async (prompt, sysPrompt) => {
      return runLlm(prompt, sysPrompt);
    },
    channelDispatcher: async (channel, message) => {
      if (opts.dispatch && !opts.dryRun) {
        await dispatchToChannel(channel, message);
      } else {
        console.log(`[Dry-Run Dispatch Simulated] Would post to ${channel}:\n${message}`);
      }
    },
  });

  console.log("\n=== Turn Result ===");
  console.log(`Memory Accessed: ${turnResult.memoryAccessed}`);
  console.log(`Personality Applied: ${turnResult.personalityApplied}`);
  console.log(`Generated Response:\n${turnResult.response}`);
  console.log(`Formatted Output Message:\n${turnResult.outputMessage}`);
}

main().catch(console.error);
