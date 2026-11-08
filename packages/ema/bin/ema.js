#!/usr/bin/env node
/**
 * EMA Command-Line Interface (ema.js)
 *
 * Conforms to RFC-0001 (Ema Worlds and Actors).
 *
 * Commands:
 *   ema.js world ls
 *   ema.js world get <path>
 *   ema.js run [--channel <id>] [--session <id>] [--watch] [--watch-for <duration>] [--poll-interval <ms>]
 */

import {
  createMinimalPrototype,
  SimpleEmaRouter,
  PenguinChannelWorld,
  parseWatchDuration,
  assertAgentIdentity,
  DEFAULT_MINIMAL_SYSTEM_PROMPT,
} from "../dist/index.js";
import { execFileSync } from "node:child_process";

function printUsage() {
  console.log(`EMA Command-Line Interface (RFC-0001)

Usage:
  ema.js world ls
    List active worlds and their mounted route prefixes

  ema.js world get <path>
    Query resources from the EMA Router (e.g. /world/channel/parts)

  ema.js run [options]
    Run the Minimal Prototype with PenguinChannelWorld and transactional input batcher

Options for run:
  --channel <id>         Target Penguin channel part (default: ch_ema_minimal_test)
  --session <id>         Target Penguin session for turns (default: session-2026-11-05-10-19-24-d6815237)
  --watch                Run continuous polling watch bridge
  --watch-for <dur>      Watch horizon (e.g. 12h, 4h, 30m; default: 12h)
  --poll-interval <ms>   Polling interval in ms (default: 5000)
  --state-file <path>    Deduplication state file (default: /tmp/ema-minimal-workspace/seen-messages.json)
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printUsage();
    process.exit(0);
  }

  if (command === "world") {
    const sub = args[1];

    // Instantiate prototype router & worlds
    const router = new SimpleEmaRouter();
    const channelWorld = new PenguinChannelWorld({
      channels: ["ch_ema_minimal_test", "default_channel"],
      passive: true,
    });

    const ctx = {
      router,
      inputBatcher: { push: () => {}, onBatch: () => ({ dispose: () => {} }) },
      registry: { register: () => ({ dispose: () => {} }), get: () => undefined, list: () => [] },
    };

    const handle = channelWorld.start(ctx);

    if (sub === "ls") {
      const routes = router.listRoutes();
      for (const r of routes) {
        console.log(`PenguinChannelWorld ${r.prefix}`);
      }
      handle.dispose();
      process.exit(0);
    }

    if (sub === "get") {
      const targetPath = args[2];
      if (!targetPath) {
        console.error(
          "Error: Missing path argument for 'world get'. Example: ema.js world get /world/channel/parts",
        );
        handle.dispose();
        process.exit(1);
      }

      try {
        const result = await router.read(targetPath);
        console.log(JSON.stringify(result, null, 2));
        handle.dispose();
        process.exit(0);
      } catch (err) {
        console.error(`Error querying ${targetPath}:`, err.message || err);
        handle.dispose();
        process.exit(1);
      }
    }

    printUsage();
    process.exit(1);
  }

  if (command === "run") {
    let channel = "ch_ema_minimal_test";
    let session = "session-2026-11-05-10-19-24-d6815237";
    let watch = false;
    let watchFor = "12h";
    let pollInterval = 5000;
    let stateFile = "/tmp/ema-minimal-workspace/seen-messages.json";

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--channel") channel = args[++i];
      else if (arg === "--session") session = args[++i];
      else if (arg === "--watch") watch = true;
      else if (arg === "--watch-for") watchFor = args[++i];
      else if (arg === "--poll-interval") pollInterval = parseInt(args[++i], 10);
      else if (arg === "--state-file") stateFile = args[++i];
    }

    const agentId = assertAgentIdentity(process.env);
    const durationMs = parseWatchDuration(watchFor);
    const endTime = Date.now() + durationMs;

    console.log("=== Minimal EMA Prototype Runner (RFC-0001) ===");
    console.log(`World:           PenguinChannelWorld (/world/channel)`);
    console.log(`Target Part:     ${channel}`);
    console.log(`Persistent Sess: ${session}`);
    console.log(`Operating Agent: ${agentId}`);
    console.log(`Watch Mode:      ${watch}`);
    console.log(`Watch Duration:  ${watchFor} (until ${new Date(endTime).toISOString()})`);
    console.log(`Poll Interval:   ${pollInterval} ms`);
    console.log(`State File:      ${stateFile}`);
    console.log("-----------------------------------------------");

    const proto = createMinimalPrototype({
      channels: [channel],
      pollInterval,
      stateFile,
      systemPrompt: DEFAULT_MINIMAL_SYSTEM_PROMPT,
      batcherOptions: { debounceMs: 400, maxWaitMs: 1500 },
      actor: {
        id: "actor-ema-minimal",
        name: "Ema Minimal",
        session,
        agentId,
      },
      llmInvoker: async (xmlPayload, sysPrompt) => {
        console.log(`\n[Input Pusher -> session ${session}]:\n${xmlPayload}`);

        // Invoke turn via penguin run in the persistent session
        const stdout = execFileSync(
          "penguin",
          ["run", "--session", session, "-m", xmlPayload, "--approve", "deny-all"],
          { encoding: "utf8", env: process.env },
        );

        return stdout.trim();
      },
    });

    const shutdown = () => {
      console.log("\n[Runner] Shutting down Minimal Prototype...");
      proto.dispose();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    if (!watch) {
      // Single-shot run: wait briefly for initial poll and exit
      await new Promise((resolve) => setTimeout(resolve, 1000));
      proto.dispose();
      process.exit(0);
    }

    // Watcher mode: sleep until endTime
    const waitInterval = setInterval(() => {
      if (Date.now() >= endTime) {
        clearInterval(waitInterval);
        console.log(`\n[Runner] Watch duration (${watchFor}) completed. Exiting.`);
        proto.dispose();
        process.exit(0);
      }
    }, 10000);
    return;
  }

  printUsage();
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
