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

import fs from "node:fs";
import path from "node:path";
import {
  createMinimalPrototype,
  SimpleEmaRouter,
  PenguinChannelWorld,
  BilibiliWorld,
  WebWorld,
  QQWorld,
  QQLoginManager,
  createQQCompanionRunner,
  installWebWorkbench,
  BilibiliLoginManager,
  publishBilibiliDynamic,
  parseWatchDuration,
  assertAgentIdentity,
  DEFAULT_MINIMAL_SYSTEM_PROMPT,
  loadGalgameDataset,
  loadExternalPersonaSeed,
  EmaPersonaTrainer,
  EmaMemoryCompactor,
  EmaDreamEngine,
  loadOrCreateCognitiveState,
  startParallelRouteSessionConsolidator,
  runModelAndThinkingAblation,
  syncCompanionAgentState,
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

  ema.js qq login [options]
    Interactive QR code login for QQ / OneBot gateway authentication

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

    // Parse optional flags (--db, --channel, --message, --parent, --qq-gateway, etc.)
    let webDbPath = process.env.EMA_WEB_DB_PATH || ":memory:";
    let qqGatewayUrl = process.env.SNOWLUMA_GATEWAY_URL || process.env.ONEBOT_GATEWAY_URL;
    let qqGatewayToken = process.env.SNOWLUMA_TOKEN || process.env.ONEBOT_TOKEN;
    let qqAllowedUsers;
    let qqAllowedGroups;
    let flagChannel;
    let flagMessage;
    let flagParent;
    const positional = [];

    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--db" && i + 1 < args.length) {
        webDbPath = args[++i];
      } else if (args[i] === "--qq-gateway" && i + 1 < args.length) {
        qqGatewayUrl = args[++i];
      } else if (args[i] === "--qq-token" && i + 1 < args.length) {
        qqGatewayToken = args[++i];
      } else if (args[i] === "--qq-allowed-users" && i + 1 < args.length) {
        qqAllowedUsers = args[++i].split(",").map((s) => s.trim());
      } else if (args[i] === "--qq-allowed-groups" && i + 1 < args.length) {
        qqAllowedGroups = args[++i].split(",").map((s) => s.trim());
      } else if ((args[i] === "--channel" || args[i] === "--channel-id") && i + 1 < args.length) {
        flagChannel = args[++i];
      } else if ((args[i] === "--message" || args[i] === "--text" || args[i] === "-m") && i + 1 < args.length) {
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
    const qqWorld = new QQWorld({
      selfId: process.env.SNOWLUMA_SELF_ID || process.env.ONEBOT_SELF_ID || "1835387598",
      gatewayUrl: qqGatewayUrl,
      gatewayToken: qqGatewayToken,
      allowedUsers: qqAllowedUsers,
      allowedGroups: qqAllowedGroups,
      groups: ["1044916258", "123456"],
      privateUsers: ["789012"],
      passive: true,
      dbPath: webDbPath,
    });

    const ctx = {
      router,
      inputBatcher: { push: () => {}, onBatch: () => ({ dispose: () => {} }) },
      registry: { register: () => ({ dispose: () => {} }), get: () => undefined, list: () => [] },
    };

    const handle = channelWorld.start(ctx);
    const biliHandle = bilibiliWorld.start(ctx);
    const webHandle = webWorld.start(ctx);
    const qqHandle = qqWorld.start(ctx);

    const disposeAll = () => {
      handle.dispose();
      biliHandle.dispose();
      webHandle.dispose();
      qqHandle.dispose();
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
        } else if (r.prefix.startsWith("/world/qq")) {
          console.log(`QQWorld ${r.prefix}`);
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
          "Error: Missing path argument for 'world post'. Example: ema.js world post /world/web/actions/message.post '{\"channelId\":\"web:chatroom:default\",\"message\":\"Hello\"}'",
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

  if (command === "qq" || command === "snowluma") {
    const sub = args[1];
    if (sub === "run") {
      let gateway = process.env.SNOWLUMA_GATEWAY_URL || process.env.ONEBOT_GATEWAY_URL || "http://localhost:13000";
      let token = process.env.SNOWLUMA_TOKEN || process.env.ONEBOT_TOKEN;
      let group = "1044916258";
      let session = "619e98db";
      let agent = "aoi_rei";
      let pollInterval = 2000;
      let watchFor = "";
      let requireMention = true;
      let dbPath =
        process.env.EMA_QQ_DB_PATH ||
        (fs.existsSync("/home/rei/work/aoi-rei")
          ? "/home/rei/work/aoi-rei/data/qq-world.sqlite"
          : path.resolve(process.cwd(), "data", "qq-world.sqlite"));

      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--gateway" || args[i] === "--url") gateway = args[++i];
        else if (args[i] === "--token") token = args[++i];
        else if (args[i] === "--group") group = args[++i];
        else if (args[i] === "--session") session = args[++i];
        else if (args[i] === "--agent") agent = args[++i];
        else if (args[i] === "--poll-interval") pollInterval = parseInt(args[++i], 10);
        else if (args[i] === "--watch-for") watchFor = args[++i];
        else if (args[i] === "--all-messages") requireMention = false;
        else if (args[i] === "--db") dbPath = path.resolve(args[++i]);
      }

      const durationMs = watchFor ? parseWatchDuration(watchFor) : Infinity;
      const endTime = Number.isFinite(durationMs) ? Date.now() + durationMs : Infinity;

      console.log("=== EMA QQ Companion Runner (SnowLuma / OneBot 11) ===");
      console.log(`Gateway:         ${gateway}`);
      console.log(`Target Group:    ${group} (Ema 同好会)`);
      console.log(`Backend Session: ${session} (Agent: ${agent})`);
      console.log(`Mention Filter:  ${requireMention ? "Only reply when @mentioned or replied to" : "Reply to all messages"}`);
      console.log(`Poll Interval:   ${pollInterval} ms`);
      console.log(`Watch Duration:  ${Number.isFinite(durationMs) ? `${watchFor} (until ${new Date(endTime).toISOString()})` : "Permanent (persistent companion mode)"}`);
      console.log(`Local DB:        ${dbPath}`);
      console.log("------------------------------------------------------");

      const runner = createQQCompanionRunner({
        gatewayUrl: gateway,
        gatewayToken: token,
        groupId: group,
        session,
        agentId: agent,
        pollIntervalMs: pollInterval,
        requireMentionInGroups: requireMention,
        dbPath,
      });

      const shutdown = () => {
        console.log("\n[QQ Runner] Shutting down companion bridge...");
        runner.dispose();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      if (Number.isFinite(durationMs)) {
        const waitInterval = setInterval(() => {
          if (Date.now() >= endTime) {
            clearInterval(waitInterval);
            console.log(`\n[QQ Runner] Watch duration (${watchFor}) completed. Exiting.`);
            runner.dispose();
            process.exit(0);
          }
        }, 10000);
      }
      return;
    }

    if (sub === "login") {
      let qrPath = path.resolve(process.cwd(), ".qq-login-qrcode.png");
      let credentialPath = path.resolve(process.cwd(), "qq-credentials.json");
      let gatewayUrl = process.env.ONEBOT_GATEWAY_URL || "http://127.0.0.1:3000";
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--qr-path") qrPath = path.resolve(args[++i]);
        else if (args[i] === "--credential-path") credentialPath = path.resolve(args[++i]);
        else if (args[i] === "--gateway" || args[i] === "--url") gatewayUrl = args[++i];
      }
      const mgr = new QQLoginManager({
        outputQrPath: qrPath,
        credentialSavePath: credentialPath,
        gatewayHttpUrl: gatewayUrl,
      });
      const result = await mgr.loginInteractive();
      if (result.success) {
        console.log(`\nLogin successful! Welcome, ${result.nickname} (QQ: ${result.userId})`);
        console.log(`Credentials saved to: ${credentialPath}`);
      } else {
        console.error(`\nLogin failed: ${result.message}`);
      }
      process.exit(result.success ? 0 : 1);
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
        console.error("Error: Missing text for dynamic post. Example: ema.js bilibili post-dynamic 'Hello from Ema'");
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

  if (command === "train") {
    let scriptPath = "";
    let seedPath = "";
    let outPath = "./ema-persona-checkpoint.json";
    let agentId = "";
    let targetCharacter = "";
    let protagonistCharacter = "";
    let maxScenes = 10;
    let studentModelId = "gemini-3.8-flash";
    let teacherModelId = "gemini-3.8-flash";
    let thinkingLevel = "medium";

    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--script" && i + 1 < args.length) scriptPath = args[++i];
      else if (args[i] === "--seed" && i + 1 < args.length) seedPath = args[++i];
      else if (args[i] === "--out" && i + 1 < args.length) outPath = args[++i];
      else if (args[i] === "--agent-id" && i + 1 < args.length) agentId = args[++i];
      else if (args[i] === "--target" && i + 1 < args.length) targetCharacter = args[++i];
      else if (args[i] === "--protagonist" && i + 1 < args.length) protagonistCharacter = args[++i];
      else if (args[i] === "--scenes" && i + 1 < args.length) maxScenes = Number(args[++i]);
      else if (args[i] === "--student-model" && i + 1 < args.length) studentModelId = args[++i];
      else if (args[i] === "--teacher-model" && i + 1 < args.length) teacherModelId = args[++i];
      else if (args[i] === "--thinking" && i + 1 < args.length) thinkingLevel = args[++i];
    }

    if (!scriptPath) {
      console.error("Error: --script <path> is required for `ema.js train`.");
      process.exit(1);
    }

    const seed = seedPath ? loadExternalPersonaSeed(seedPath) : null;
    const ds = loadGalgameDataset(scriptPath, {
      targetCharacter: targetCharacter || seed?.targetCharacter,
      protagonistCharacter: protagonistCharacter || seed?.protagonistCharacter,
      speakerAliases: seed?.speakerAliases,
      sceneSpeakerOverrides: seed?.sceneSpeakerOverrides,
    });

    const selected = ds.scenes.slice(0, maxScenes);
    const trainer = new EmaPersonaTrainer(
      {
        targetCharacter: ds.targetCharacter,
        protagonistCharacter: ds.protagonistCharacter,
        companionAgentId: agentId || "ema_minimal",
        studentModel: { provider: "penguin-go", modelId: studentModelId, thinkingLevel },
        teacherModel: { provider: "penguin-go", modelId: teacherModelId, thinkingLevel: "medium" },
        rsiScoreThreshold: 85,
        maxWindowAttempts: 2,
        studentBatchSize: 12,
        enableReflectionCheck: true,
        syncAgentOnDisk: Boolean(agentId),
      },
      {
        initialPersonality: seed?.personality,
      },
    );

    if (!seed?.personality && selected.length > 0) {
      console.log(`[Warmup] Distilling initial P_0_0 for ${ds.targetCharacter}...`);
      await trainer.distillInitialPersonalityFromWarmup(selected.slice(0, 3));
    }

    const counter = { count: 0 };
    const results = [];
    for (const s of selected) {
      const r = await trainer.trainSceneWindow(s, counter);
      results.push(r);
      console.log(
        `[Train] ${s.sceneId} (${s.title}) | ${r.initialMeanScore} -> ${r.finalMeanScore} | P=${trainer.personality.version} | cost=$${r.metrics.costUsd}`,
      );
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          personality: trainer.personality,
          memoryIndex: trainer.memoryIndex,
          results,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`Saved checkpoint to ${outPath}`);
    return;
  }

  if (command === "compact") {
    let agentId = "aoi_rei";
    let routeSessionId = "";
    let statePath = "";
    let archivePath = "";
    let targetCharacter = "";
    let protagonistCharacter = "Owner";
    let rollupThreshold = 40;
    let modelId = "gemini-3.8-flash";

    for (let i = 1; i < args.length; i++) {
      if ((args[i] === "--agent-id" || args[i] === "--agent") && i + 1 < args.length)
        agentId = args[++i];
      else if ((args[i] === "--route-session" || args[i] === "--session") && i + 1 < args.length)
        routeSessionId = args[++i];
      else if (args[i] === "--state" && i + 1 < args.length) statePath = args[++i];
      else if (args[i] === "--archive" && i + 1 < args.length) archivePath = args[++i];
      else if (args[i] === "--target" && i + 1 < args.length) targetCharacter = args[++i];
      else if (args[i] === "--protagonist" && i + 1 < args.length) protagonistCharacter = args[++i];
      else if (args[i] === "--rollup-threshold" && i + 1 < args.length)
        rollupThreshold = Number(args[++i]);
      else if (args[i] === "--model" && i + 1 < args.length) modelId = args[++i];
    }

    if (!statePath) {
      statePath = path.resolve(process.cwd(), "data", `${agentId}-ema-state.json`);
    }
    if (!archivePath) {
      archivePath = path.resolve(path.dirname(statePath), `${agentId}-memory-archive.jsonl`);
    }

    const state = loadOrCreateCognitiveState({
      statePath,
      agentId,
      companionName: targetCharacter || agentId,
      protagonistName: protagonistCharacter,
    });

    const compactor = new EmaMemoryCompactor({
      targetCharacter: state.personality.name,
      protagonistCharacter: state.protagonistName,
      model: { provider: "penguin-go", modelId, thinkingLevel: "medium" },
      companionAgentId: agentId,
      l0RollupThreshold: rollupThreshold,
      archiveJsonlPath: archivePath,
      statePath,
      syncAgentOnDisk: true,
    });

    if (!routeSessionId) {
      console.error("Error: --route-session <id> is required for `ema.js compact`.");
      process.exit(1);
    }

    const res = await compactor.compactRouteSession(routeSessionId, state);
    console.log(
      `[Compact] Agent=${agentId} Session=${routeSessionId} | CompactedTurns=${res.compactedTurnCount} (${res.previousCursor}->${res.newCursor}) | +${res.newL0Items.length} L0, +${res.newL1Items.length} L1 | cost=$${res.metrics.costUsd}`,
    );
    return;
  }

  if (command === "dream") {
    let agentId = "aoi_rei";
    let routeSessionId = "";
    let statePath = "";
    let archivePath = "";
    let outPath = "";
    let watch = false;
    let pollIntervalMs = 10_000;
    let forceRefine = false;
    let modelId = "gemini-3.8-flash";

    for (let i = 1; i < args.length; i++) {
      if ((args[i] === "--agent-id" || args[i] === "--agent") && i + 1 < args.length)
        agentId = args[++i];
      else if ((args[i] === "--route-session" || args[i] === "--session") && i + 1 < args.length)
        routeSessionId = args[++i];
      else if (args[i] === "--state" && i + 1 < args.length) statePath = args[++i];
      else if (args[i] === "--archive" && i + 1 < args.length) archivePath = args[++i];
      else if (args[i] === "--out" && i + 1 < args.length) outPath = args[++i];
      else if (args[i] === "--watch") watch = true;
      else if (args[i] === "--poll-interval" && i + 1 < args.length)
        pollIntervalMs = Number(args[++i]);
      else if (args[i] === "--force-refine") forceRefine = true;
      else if (args[i] === "--model" && i + 1 < args.length) modelId = args[++i];
    }

    if (!statePath) {
      statePath = path.resolve(process.cwd(), "data", `${agentId}-ema-state.json`);
    }
    if (!archivePath) {
      archivePath = path.resolve(path.dirname(statePath), `${agentId}-memory-archive.jsonl`);
    }

    const state = loadOrCreateCognitiveState({
      statePath,
      agentId,
    });

    const dreamer = new EmaDreamEngine({
      targetCharacter: state.personality.name,
      protagonistCharacter: state.protagonistName,
      companionAgentId: agentId,
      studentModel: { provider: "penguin-go", modelId, thinkingLevel: "medium" },
      teacherModel: { provider: "penguin-go", modelId, thinkingLevel: "medium" },
      forcePersonaRefinement: forceRefine,
      archiveJsonlPath: archivePath,
      statePath,
      syncAgentOnDisk: true,
    });

    if (watch && routeSessionId) {
      console.log(
        `[Dream Daemon] Attached in parallel to Route Session ${routeSessionId} (agent=${agentId}, poll=${pollIntervalMs}ms)...`,
      );
      const handle = startParallelRouteSessionConsolidator({
        dreamer,
        state,
        routeSessionId,
        pollIntervalMs,
        onCompact: (c) => {
          if (c) {
            console.log(
              `[Parallel Compact] +${c.newL0Items.length} L0, +${c.newL1Items.length} L1 | cursor=${c.newCursor} | cost=$${c.metrics.costUsd}`,
            );
          }
        },
        onDream: (d) => {
          console.log(
            `[Parallel Dream] Scenes=${d.evaluatedSceneCount} Score=${d.meanDaytimeScore} | P: ${d.personalityVersionBefore}->${d.personalityVersionAfter} (gate=${d.gatePassed}) | cost=$${d.metrics.costUsd}`,
          );
        },
      });
      await handle.tickNow();
      process.on("SIGINT", () => {
        handle.dispose();
        process.exit(0);
      });
      return;
    }

    const res = await dreamer.runDreamCycle(state, {
      routeSessionId: routeSessionId || undefined,
    });
    console.log(
      `[Dream] Agent=${agentId} | Scenes=${res.evaluatedSceneCount} Turns=${res.evaluatedTurnCount} MeanScore=${res.meanDaytimeScore} | P: ${res.personalityVersionBefore}->${res.personalityVersionAfter} (mutated=${res.personalityMutated}, gate=${res.gatePassed}) | cost=$${res.metrics.costUsd}`,
    );
    if (outPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(res, null, 2), "utf8");
    }
    return;
  }

  printUsage();
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
