#!/usr/bin/env node
/**
 * EMA Command-Line Interface (ema.js)
 *
 * Conforms to RFC-0001 (Ema Worlds and Actors).
 *
 * Commands:
 *   ema.js world ls [--db <path>]
 *   ema.js world get <path> [--db <path>]
 *   ema.js world post <path> [jsonBody] [--channel <id>] [--message <text>] [--db <path>]
 *   ema.js web install-workbench --agent <id> [--name <companion_name>] [--owner <owner_name>] [--app-data-dir <dir>]
 *   ema.js run [--channel <id>] [--session <id>] [--watch] [--watch-for <duration>] [--poll-interval <ms>]
 */

import path from "node:path";
import {
  createMinimalPrototype,
  SimpleEmaRouter,
  PenguinChannelWorld,
  BilibiliWorld,
  WebWorld,
  installWebWorkbench,
  BilibiliLoginManager,
  publishBilibiliDynamic,
  parseWatchDuration,
  assertAgentIdentity,
  DEFAULT_MINIMAL_SYSTEM_PROMPT,
} from "../dist/index.js";
import { execFileSync } from "node:child_process";

function printUsage() {
  console.log(`EMA Command-Line Interface (RFC-0001 / RFC-0002)

Usage:
  ema.js world ls [--db <path>]
    List active worlds and their mounted route prefixes

  ema.js world get <path> [--db <path>]
    Query resources from the EMA Router (e.g. /world/web/channels/web:chatroom:default/items)

  ema.js world post <path> [jsonBody] [--channel <id>] [--message <text>] [--db <path>]
    Dispatch an action or post an item to an EMA Router endpoint
    (e.g. ema.js world post /world/web/actions/message.post '{"channelId":"web:chatroom:default","message":"你好！"}')

  ema.js web install-workbench --agent <id> [options]
    Install the Web Companion Portal Workbench (companion_portal) into a Penguin agent

  ema.js bilibili login [options]
    Interactive Playwright QR code login for Bilibili account authentication

  ema.js bilibili post-dynamic <text> [options]
    Publish a feed dynamic post via Playwright browser automation

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

    // Parse optional flags (--db, --channel, --message, --parent)
    let webDbPath = process.env.EMA_WEB_DB_PATH || ":memory:";
    let flagChannel;
    let flagMessage;
    let flagParent;
    const positional = [];

    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--db" && i + 1 < args.length) {
        webDbPath = args[++i];
      } else if ((args[i] === "--channel" || args[i] === "--channel-id") && i + 1 < args.length) {
        flagChannel = args[++i];
      } else if (
        (args[i] === "--message" || args[i] === "--text" || args[i] === "-m") &&
        i + 1 < args.length
      ) {
        flagMessage = args[++i];
      } else if ((args[i] === "--parent" || args[i] === "--reply-to") && i + 1 < args.length) {
        flagParent = args[++i];
      } else {
        positional.push(args[i]);
      }
    }

    // Instantiate prototype router & worlds
    const router = new SimpleEmaRouter();
    const channelWorld = new PenguinChannelWorld({
      channels: ["ch_ema_minimal_test", "default_channel"],
      passive: true,
    });
    const bilibiliWorld = new BilibiliWorld({
      rooms: ["123456"],
      videoTargets: ["video:BV1xx411c7mD"],
      dmTargets: ["1001"],
      passive: true,
    });
    const webWorld = new WebWorld({
      initialSessions: ["default"],
      dbPath: webDbPath,
      heartbeatIntervalMs: 0,
    });

    const ctx = {
      router,
      inputBatcher: { push: () => {}, onBatch: () => ({ dispose: () => {} }) },
      registry: { register: () => ({ dispose: () => {} }), get: () => undefined, list: () => [] },
    };

    const handle = channelWorld.start(ctx);
    const biliHandle = bilibiliWorld.start(ctx);
    const webHandle = webWorld.start(ctx);

    const disposeAll = () => {
      handle.dispose();
      biliHandle.dispose();
      webHandle.dispose();
    };

    if (sub === "ls") {
      const routes = router.listRoutes();
      for (const r of routes) {
        if (r.prefix.startsWith("/world/channel")) {
          console.log(`PenguinChannelWorld ${r.prefix}`);
        } else if (r.prefix.startsWith("/world/bilibili")) {
          console.log(`BilibiliWorld ${r.prefix}`);
        } else if (r.prefix.startsWith("/world/web")) {
          console.log(`WebWorld ${r.prefix}`);
        } else {
          console.log(`${r.worldName || "World"} ${r.prefix}`);
        }
      }
      disposeAll();
      process.exit(0);
    }

    if (sub === "get") {
      const targetPath = positional[0];
      if (!targetPath) {
        console.error(
          "Error: Missing path argument for 'world get'. Example: ema.js world get /world/web/channels/web:chatroom:default/items",
        );
        disposeAll();
        process.exit(1);
      }

      try {
        const result = await router.read(targetPath);
        console.log(JSON.stringify(result, null, 2));
        disposeAll();
        process.exit(0);
      } catch (err) {
        console.error(`Error querying ${targetPath}:`, err.message || err);
        disposeAll();
        process.exit(1);
      }
    }

    if (sub === "post") {
      const targetPath = positional[0];
      if (!targetPath) {
        console.error(
          'Error: Missing path argument for \'world post\'. Example: ema.js world post /world/web/actions/message.post \'{"channelId":"web:chatroom:default","message":"Hello"}\'',
        );
        disposeAll();
        process.exit(1);
      }

      let payloadObj = {};
      if (positional[1]) {
        try {
          payloadObj = JSON.parse(positional[1]);
        } catch {
          payloadObj = { message: positional[1] };
        }
      }
      if (flagChannel !== undefined) payloadObj.channelId = flagChannel;
      if (flagMessage !== undefined) payloadObj.message = flagMessage;
      if (flagParent !== undefined) payloadObj.parentItemId = flagParent;

      try {
        const result = await router.read(targetPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadObj),
        });
        console.log(JSON.stringify(result, null, 2));
        disposeAll();
        process.exit(0);
      } catch (err) {
        console.error(`Error posting to ${targetPath}:`, err.message || err);
        disposeAll();
        process.exit(1);
      }
    }

    disposeAll();
    printUsage();
    process.exit(1);
  }

  if (command === "web") {
    const sub = args[1];
    if (sub === "install-workbench") {
      let agentId = "";
      let companionName;
      let ownerName;
      let workbenchId;
      let appDataDir;
      let dbPath;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--agent" || args[i] === "-a") agentId = args[++i];
        else if (args[i] === "--name") companionName = args[++i];
        else if (args[i] === "--owner") ownerName = args[++i];
        else if (args[i] === "--workbench-id") workbenchId = args[++i];
        else if (args[i] === "--app-data-dir") appDataDir = args[++i];
        else if (args[i] === "--db") dbPath = args[++i];
        else if (!agentId && !args[i].startsWith("-")) agentId = args[i];
      }
      if (!agentId) {
        console.error(
          "Error: Missing --agent <agent_id>. Example: ema.js web install-workbench --agent aoi_rei",
        );
        process.exit(1);
      }
      const res = installWebWorkbench({
        agentId,
        companionName,
        ownerName,
        workbenchId,
        appDataDir,
        dbPath,
      });
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    }
    printUsage();
    process.exit(1);
  }

  if (command === "bilibili") {
    const sub = args[1];
    if (sub === "login") {
      let qrPath = path.resolve(process.cwd(), ".bilibili-login-qrcode.png");
      let cookiePath = path.resolve(process.cwd(), "bilibili-cookies.json");
      let storageStatePath = path.resolve(process.cwd(), "bilibili-storage-state.json");
      let profileDir = path.resolve(process.cwd(), ".bilibili-profile");
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--qr-path") qrPath = path.resolve(args[++i]);
        else if (args[i] === "--cookie-path") cookiePath = path.resolve(args[++i]);
        else if (args[i] === "--state-path") storageStatePath = path.resolve(args[++i]);
        else if (args[i] === "--profile") profileDir = path.resolve(args[++i]);
      }
      const mgr = new BilibiliLoginManager({
        outputQrPath: qrPath,
        cookieSavePath: cookiePath,
        storageStatePath,
        userDataDir: profileDir,
      });
      const result = await mgr.login();
      if (result.success) {
        console.log(`\nLogin successful! Welcome, ${result.uname} (UID: ${result.uid})`);
        console.log(`Session saved to: ${storageStatePath}`);
        console.log(`Cookies saved to: ${cookiePath}`);
      } else {
        console.error(`\nLogin failed: ${result.message}`);
      }
      process.exit(result.success ? 0 : 1);
    }

    if (sub === "post-dynamic" || sub === "publish-dynamic") {
      let text = args[2];
      let storageStatePath = "bilibili-storage-state.json";
      let profileDir = ".bilibili-profile";
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--text") text = args[++i];
        else if (args[i] === "--state-path") storageStatePath = args[++i];
        else if (args[i] === "--profile") profileDir = args[++i];
      }
      if (!text) {
        console.error(
          "Error: Missing text for dynamic post. Example: ema.js bilibili post-dynamic 'Hello from Ema'",
        );
        process.exit(1);
      }
      console.log(`Publishing Bilibili dynamic via Playwright browser automation...`);
      const res = await publishBilibiliDynamic(text, {
        userDataDir: profileDir,
        storageStatePath,
      });
      if (res.success) {
        console.log(`\nDynamic published successfully!`);
        if (res.dynamicId) console.log(`Dynamic ID:  ${res.dynamicId}`);
        if (res.url) console.log(`Dynamic URL: ${res.url}`);
      } else {
        console.error(`\nFailed to publish dynamic: ${res.message}`);
      }
      process.exit(res.success ? 0 : 1);
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
