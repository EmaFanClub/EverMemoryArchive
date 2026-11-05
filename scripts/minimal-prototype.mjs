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
 *   node scripts/minimal-prototype.mjs [--channel <id>] [--read-latest] [--prompt <text>] [--dispatch] [--dry-run]
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
    const raw = execFileSync("penguin", ["org", "channel", "tail", "--channel", channel, "-n", "5", "--json"], {
      encoding: "utf8",
    });
    const parsed = JSON.parse(raw);
    const msgs = (parsed.messages || []).filter((m) => m.sender !== "system");
    const msg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    if (!msg) return null;
    return normalizeChannelMessage({ ...msg, channelId: channel });
  } catch (err) {
    console.error(`[Error] Failed to fetch channel messages: ${err.message}`);
    return null;
  }
}

async function runLlm(prompt, systemPrompt) {
  try {
    const out = execFileSync(
      "penguin",
      [
        "run",
        "--agent-id",
        "ema_minimal",
        "--workspace",
        "/tmp/ema-minimal-workspace",
        "-m",
        prompt,
        "--approve",
        "allow-all",
        "--timeout",
        "45s",
        "--json",
      ],
      { encoding: "utf8", timeout: 60000 }
    );
    const parsed = JSON.parse(out);
    if (parsed && parsed.text) {
      return parsed.text.trim();
    }
    return String(out).trim();
  } catch (err) {
    console.error(`[LLM Invocation Warning]: ${err.message}`);
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
  console.log(`Dispatch: ${opts.dispatch}`);
  console.log(`Dry Run: ${opts.dryRun}`);

  let inputMessage = null;
  if (opts.readLatest) {
    console.log(`Reading latest message from channel ${opts.channel}...`);
    inputMessage = fetchLatestChannelMessage(opts.channel);
    if (inputMessage) {
      console.log(`Found latest channel message from ${inputMessage.sender}: "${inputMessage.text}"`);
    } else {
      console.log(`No user message found in channel ${opts.channel}.`);
    }
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
