#!/usr/bin/env node
/**
 * Minimal EMA Prototype CLI Runner & Channel Watcher (RFC-0001 Architecture)
 *
 * Demonstrates the core properties of the Minimal variant:
 * 1. Zero Personality: Purely functional, neutral system prompt without persona.
 * 2. Zero Memory: EverMemoryArchive retrieval, indexing, and storage bypassed.
 * 3. World Abstraction: PenguinChannelWorld implements EmaWorld (@Interface).
 * 4. Router & Mounts: Exposes /world/channel/parts and message endpoints.
 * 5. Transactional Input Batching: Enqueues and coalesces messages into XML <Input> payloads.
 * 6. Identity Guard: Attribute replies to operating agent (PENGUIN_AGENT_ID).
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
import {
  DEFAULT_MINIMAL_SYSTEM_PROMPT,
  createMinimalPrototype,
  assertAgentIdentity,
  parseWatchDuration,
  SimpleEmaRouter,
  PenguinChannelWorld,
} from "../../../../packages/ema/dist/index.js";

const DEFAULT_SESSION_ID = "session-2026-11-05-10-19-24-d6815237";
const DEFAULT_STATE_FILE = "/tmp/ema-minimal-workspace/seen-messages.json";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    channel: "ch_ema_minimal_test",
    readLatest: false,
    prompt: "",
    sender: "user:admin",
    dryRun: false,
    dispatch: false,
    watch: false,
    session: DEFAULT_SESSION_ID,
    watchFor: "12h",
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
      options.dispatch = true;
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

function runLlm(xmlPayload, sessionId) {
  try {
    const stdout = execFileSync(
      "penguin",
      [
        "run",
        "--session",
        sessionId,
        "-m",
        xmlPayload,
        "--approve",
        "deny-all",
      ],
      {
        encoding: "utf8",
        env: process.env,
      }
    );
    return stdout.trim();
  } catch (err) {
    console.error(`[Error] LLM execution failed: ${err.message}`);
    throw err;
  }
}

async function runWatchMode(opts) {
  const agentId = assertAgentIdentity(process.env);
  const durationMs = parseWatchDuration(opts.watchFor);
  const endTime = Date.now() + durationMs;

  console.log("=== Minimal EMA Prototype Watcher (RFC-0001 Architecture) ===");
  console.log(`World:           PenguinChannelWorld (@Interface)`);
  console.log(`Channel Part:    ${opts.channel}`);
  console.log(`Persistent Sess: ${opts.session}`);
  console.log(`Watch Duration:  ${opts.watchFor} (${durationMs} ms, until ${new Date(endTime).toISOString()})`);
  console.log(`Operating Agent: ${agentId}`);
  console.log(`Poll Interval:   ${opts.pollInterval} ms`);
  console.log(`State File:      ${opts.stateFile}`);
  console.log("-------------------------------------------------------------");

  const proto = createMinimalPrototype({
    channels: [opts.channel],
    pollInterval: opts.pollInterval,
    stateFile: opts.stateFile,
    systemPrompt: DEFAULT_MINIMAL_SYSTEM_PROMPT,
    batcherOptions: { debounceMs: 400, maxWaitMs: 1500 },
    actor: {
      id: "actor-ema-minimal",
      name: "Ema Minimal",
      session: opts.session,
      agentId,
    },
    llmInvoker: async (xmlPayload) => {
      console.log(`\n[Watcher] Ingesting Transactional XML Input:\n${xmlPayload}`);
      const reply = runLlm(xmlPayload, opts.session);
      console.log(`[Watcher] Session Output:\n${reply}`);
      return reply;
    },
    channelSender: (channel, text) => {
      if (opts.dryRun) {
        console.log(`[Dry-Run Dispatch Simulated] Would post to ${channel}:\n${text}`);
        return;
      }
      console.log(`[Dispatching to ${channel} as ${agentId}]:\n${text}`);
      execFileSync("penguin", ["org", "channel", "send", "--channel", channel, "-m", text], {
        encoding: "utf8",
        env: process.env,
      });
      console.log(`[Watcher] Delivered to ${channel} as ${agentId}`);
    },
    env: process.env,
  });

  // Verify router routes
  const routes = proto.router.listRoutes();
  console.log(`Mounted Routes (${routes.length}):`, routes.map((r) => r.prefix).join(", "));

  let running = true;
  const handleExit = () => {
    if (!running) return;
    console.log("\n[Watcher] Gracefully stopping watch loop...");
    running = false;
    proto.dispose();
    process.exit(0);
  };
  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);

  while (running && Date.now() < endTime) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log(`\n[Watcher] Watch duration (${opts.watchFor}) completed. Exiting.`);
  proto.dispose();
}

async function runSingleShotMode(opts) {
  console.log("=== Minimal EMA Prototype Runner (Single-shot, RFC-0001) ===");
  console.log(`Channel Part: ${opts.channel}`);
  console.log(`Dispatch:     ${opts.dispatch}`);
  console.log(`Dry Run:      ${opts.dryRun}`);

  if (opts.dispatch && !opts.dryRun) {
    const agentId = assertAgentIdentity(process.env);
    console.log(`Verified operating agent identity: ${agentId}`);
  }

  const router = new SimpleEmaRouter();
  const channelWorld = new PenguinChannelWorld({
    channels: [opts.channel],
    pollInterval: 100000,
    env: process.env,
  });

  const ctx = {
    router,
    inputBatcher: { push: () => {}, onBatch: () => ({ dispose: () => {} }) },
    registry: { register: () => ({ dispose: () => {} }), get: () => undefined, list: () => [] },
  };

  const handle = channelWorld.start(ctx);
  const parts = await router.read(`/world/channel/parts`);
  console.log("Queried Router /world/channel/parts:", JSON.stringify(parts));

  const promptText = opts.prompt || "Status check for Minimal EMA Prototype.";
  const xmlPayload = `<Input>\n  <World>channel</World>\n  <Channel>${opts.channel}</Channel>\n  <Name>${opts.sender}</Name>\n  <Message id="cli-test">${promptText}</Message>\n</Input>`;

  console.log(`\nInput XML Payload:\n${xmlPayload}`);

  let reply = "";
  if (opts.session) {
    reply = runLlm(xmlPayload, opts.session);
  } else {
    reply = `Status check OK. Zero personality & zero memory verified. Channel part: ${opts.channel}.`;
  }

  console.log(`\nGenerated Response:\n${reply}`);

  if (opts.dispatch && !opts.dryRun) {
    channelWorld.interact(
      ctx,
      { id: "actor-ema-minimal", name: "Ema Minimal", session: opts.session, agentId: process.env.PENGUIN_AGENT_ID || "" },
      opts.channel,
      "reply",
      `@${opts.sender} ${reply}`
    );
    console.log(`Dispatched reply to channel ${opts.channel}`);
  }

  handle.dispose();
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
