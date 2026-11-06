#!/usr/bin/env node
/**
 * Minimal EMA Prototype CLI Runner & Channel Watcher
 *
 * Demonstrates the 4 core properties of the Minimal variant:
 * 1. Zero Personality: Purely functional, neutral system prompt without persona.
 * 2. Zero Memory: EverMemoryArchive retrieval, indexing, and storage bypassed.
 *    (Local session transcript accumulates turns for user visibility).
 * 3. Penguin Channel Input: Watch bridge polling `penguin org channel tail --json`,
 *    filtering for human messages (`user:*`), and ingesting them into the persistent
 *    `ema_minimal` session.
 * 4. Penguin Channel Output: Formats and dispatches completions back to the channel
 *    on behalf of the operating employee agent (never the server owner).
 *
 * Usage:
 *   # Single-shot mode:
 *   node tests/scenarios/prototype/minimal/minimal-prototype.mjs [--channel <id>] [--read-latest] [--prompt <text>] [--dispatch] [--dry-run]
 *
 *   # Watcher mode:
 *   node tests/scenarios/prototype/minimal/minimal-prototype.mjs --channel <id> --watch [--session <session_id>] [--watch-for <duration>]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_MINIMAL_SYSTEM_PROMPT,
  normalizeChannelMessage,
  executeMinimalTurn,
  assertAgentIdentity,
  filterNewUserMessages,
  parseWatchDuration,
} from "../../../../packages/ema/dist/index.js";

const DEFAULT_SESSION_ID = "session-2026-11-05-10-19-24-d6815237";
const DEFAULT_STATE_FILE = "/tmp/ema-minimal-workspace/seen-messages.json";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    channel: "ch_ema_dev",
    readLatest: false,
    prompt: "",
    sender: "user:admin",
    dryRun: false,
    dispatch: false,
    watch: false,
    session: DEFAULT_SESSION_ID,
    watchFor: "4h",
    pollInterval: 5000,
    stateFile: DEFAULT_STATE_FILE,
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
    } else if (arg === "--watch") {
      options.watch = true;
      options.dispatch = true; // Watcher always dispatches unless --dry-run
    } else if (arg === "--session") {
      options.session = args[++i];
    } else if (arg === "--watch-for") {
      options.watchFor = args[++i];
    } else if (arg === "--poll-interval") {
      options.pollInterval = parseInt(args[++i], 10) || 5000;
    } else if (arg === "--state-file") {
      options.stateFile = args[++i];
    }
  }
  return options;
}

function fetchChannelMessages(channel, count = 10) {
  try {
    const raw = execFileSync(
      "penguin",
      ["org", "channel", "tail", "--channel", channel, "-n", String(count), "--json"],
      {
        encoding: "utf8",
        env: process.env,
      }
    );
    const parsed = JSON.parse(raw);
    return parsed.messages || [];
  } catch (err) {
    console.error(`[Error] Failed to fetch channel messages: ${err.message}`);
    return [];
  }
}

function loadSeenState(stateFilePath) {
  try {
    if (fs.existsSync(stateFilePath)) {
      const raw = fs.readFileSync(stateFilePath, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return new Set(data);
      if (Array.isArray(data.seenIds)) return new Set(data.seenIds);
    }
  } catch (err) {
    console.warn(`[Warning] Could not load state file ${stateFilePath}: ${err.message}`);
  }
  return new Set();
}

function saveSeenState(stateFilePath, seenSet) {
  try {
    const dir = path.dirname(path.resolve(stateFilePath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const arr = Array.from(seenSet);
    fs.writeFileSync(stateFilePath, JSON.stringify(arr, null, 2), "utf8");
  } catch (err) {
    console.error(`[Error] Failed to save state file ${stateFilePath}: ${err.message}`);
  }
}

async function runLlm(prompt, systemPrompt, sessionId) {
  try {
    const cmdArgs = ["run"];
    if (sessionId) {
      cmdArgs.push("--agent-id", "ema_minimal", "--session", sessionId);
    } else {
      cmdArgs.push(
        "--agent-id",
        "ema_minimal",
        "--workspace",
        "/tmp/ema-minimal-workspace"
      );
    }
    cmdArgs.push(
      "-m",
      prompt,
      "--approve",
      "deny-all",
      "--timeout",
      "45s",
      "--json"
    );

    const out = execFileSync("penguin", cmdArgs, {
      encoding: "utf8",
      timeout: 60000,
      env: process.env,
    });
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
  const agentId = assertAgentIdentity(process.env);
  console.log(`[Dispatching to ${channel} as ${agentId}]:\n${message}`);
  execFileSync("penguin", ["org", "channel", "send", "--channel", channel, "-m", message], {
    encoding: "utf8",
    env: process.env,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWatchMode(opts) {
  const agentId = assertAgentIdentity(process.env);
  const durationMs = parseWatchDuration(opts.watchFor);
  const endTime = Date.now() + durationMs;
  const seenIds = loadSeenState(opts.stateFile);

  console.log("=== Minimal EMA Prototype Watcher ===");
  console.log(`Channel:         ${opts.channel}`);
  console.log(`Persistent Sess: ${opts.session}`);
  console.log(`Watch Duration:  ${opts.watchFor} (${durationMs} ms, until ${new Date(endTime).toISOString()})`);
  console.log(`Operating Agent: ${agentId}`);
  console.log(`Poll Interval:   ${opts.pollInterval} ms`);
  console.log(`State File:      ${opts.stateFile}`);
  console.log(`Initial Seen IDs: ${seenIds.size}`);
  console.log("--------------------------------------");

  let running = true;
  const handleExit = () => {
    if (!running) return;
    console.log("\n[Watcher] Gracefully stopping watch loop...");
    running = false;
    saveSeenState(opts.stateFile, seenIds);
    process.exit(0);
  };
  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);

  while (running && Date.now() < endTime) {
    const rawMessages = fetchChannelMessages(opts.channel, 10);
    const newMessages = filterNewUserMessages(rawMessages, seenIds, opts.channel);

    for (const msg of newMessages) {
      console.log(`\n[Watcher] Ingesting message from ${msg.sender} (${msg.id}): "${msg.text}"`);
      seenIds.add(msg.id);
      saveSeenState(opts.stateFile, seenIds);

      const turnResult = await executeMinimalTurn(msg, {
        llmInvoker: async (prompt, sysPrompt) => {
          return runLlm(prompt, sysPrompt, opts.session);
        },
        channelDispatcher: async (channel, message) => {
          if (!opts.dryRun) {
            await dispatchToChannel(channel, message);
          } else {
            console.log(`[Dry-Run Dispatch Simulated] Would post to ${channel}:\n${message}`);
          }
        },
        env: process.env,
      });

      console.log(`[Watcher] Turn response:\n${turnResult.response}`);
      console.log(`[Watcher] Delivered to ${opts.channel} as ${agentId}`);
    }

    await sleep(opts.pollInterval);
  }

  console.log(`\n[Watcher] Watch duration (${opts.watchFor}) completed. Exiting.`);
  saveSeenState(opts.stateFile, seenIds);
}

async function runSingleShotMode(opts) {
  console.log("=== Minimal EMA Prototype Runner (Single-shot) ===");
  console.log(`Channel:  ${opts.channel}`);
  console.log(`Dispatch: ${opts.dispatch}`);
  console.log(`Dry Run:  ${opts.dryRun}`);

  if (opts.dispatch && !opts.dryRun) {
    const agentId = assertAgentIdentity(process.env);
    console.log(`Verified operating agent identity: ${agentId}`);
  }

  let inputMessage = null;
  if (opts.readLatest) {
    console.log(`Reading latest message from channel ${opts.channel}...`);
    const rawMessages = fetchChannelMessages(opts.channel, 5);
    const userMsgs = rawMessages.filter((m) => m.sender && !m.sender.startsWith("system"));
    const msg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : null;
    if (msg) {
      inputMessage = normalizeChannelMessage({ ...msg, channelId: opts.channel });
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
      return runLlm(prompt, sysPrompt, opts.session);
    },
    channelDispatcher: async (channel, message) => {
      if (opts.dispatch && !opts.dryRun) {
        await dispatchToChannel(channel, message);
      } else {
        console.log(`[Dry-Run Dispatch Simulated] Would post to ${channel}:\n${message}`);
      }
    },
    env: process.env,
  });

  console.log("\n=== Turn Result ===");
  console.log(`Memory Accessed: ${turnResult.memoryAccessed}`);
  console.log(`Personality Applied: ${turnResult.personalityApplied}`);
  console.log(`Dispatched Agent ID: ${turnResult.dispatchedAgentId || "none"}`);
  console.log(`Generated Response:\n${turnResult.response}`);
  console.log(`Formatted Output Message:\n${turnResult.outputMessage}`);
}

async function main() {
  const opts = parseArgs();
  if (opts.watch) {
    await runWatchMode(opts);
  } else {
    await runSingleShotMode(opts);
  }
}

main().catch((err) => {
  console.error(`[Fatal Error]: ${err.message}`);
  process.exit(1);
});
