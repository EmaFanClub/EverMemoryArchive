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
  washDatasetFromConfig,
  trainFromConfig,
  managePersonaFromConfig,
  loadEmaGlobalConfig,
  loadEmaAgentConfig,
  ensureSharedWorldServer,
  getEmaSandboxStatus,
  assertSandboxBinaryAllowed,
  buildLinuxBwrapWhitelistArgs,
  buildWindowsWslBwrapWhitelistArgs,
  buildMacosSeatbeltWhitelistProfile,
} from "../dist/index.js";
import { execFileSync } from "node:child_process";

function printUsage() {
  console.log(`EMA Command-Line Interface (RFC-0001 .. RFC-0007)

Unified Single-TOML Persona & Training Commands:
  ema.js wash --config <persona.toml> [--prompt "<what to wash>"]
    Wash script chapters & autonomy tracks from a single TOML config into a causal dataset

  ema.js train --config <persona.toml> [--prompt "<training focus>"] [--scenes <n>]
    Execute supervised causal window RSI training from the single TOML config & prompt

  ema.js persona [show|sync|init] --config <persona.toml> [--prompt "<directive>"]
    Inspect, initialize, or sync a persona's AGENTS.md & workbench from the single TOML config

World & Runtime Commands:
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

  if (command === "sandbox") {
    const sub = args[1] || "status";
    let configPath;
    let agentId;
    let targetBin;
    let targetPlatform;
    let workspaceRoot = "/home/rei/work/org/ema/assistant";
    let scratchpadDir;
    let distro = "penguin-sandbox";

    for (let i = 2; i < args.length; i++) {
      const a = args[i];
      if (a === "--config" && i + 1 < args.length) {
        configPath = args[++i];
      } else if (a === "--agent" && i + 1 < args.length) {
        agentId = args[++i];
      } else if (a === "--platform" && i + 1 < args.length) {
        targetPlatform = args[++i];
      } else if (a === "--workspace" && i + 1 < args.length) {
        workspaceRoot = args[++i];
      } else if (a === "--scratchpad" && i + 1 < args.length) {
        scratchpadDir = args[++i];
      } else if (a === "--distro" && i + 1 < args.length) {
        distro = args[++i];
      } else if (!a.startsWith("--") && !targetBin) {
        targetBin = a;
      }
    }

    const globalCfg = loadEmaGlobalConfig(configPath);
    const agentCfg = agentId
      ? loadEmaAgentConfig(agentId, { globalConfigPath: configPath })
      : null;

    if (sub === "status") {
      const status = getEmaSandboxStatus({
        configPath,
        agentId,
        platform: targetPlatform,
      });
      console.log(JSON.stringify(status, null, 2));
      process.exit(0);
    } else if (sub === "check-bin") {
      if (!targetBin) {
        console.error("Usage: ema.js sandbox check-bin <binName> [--agent <id>] [--config <path>]");
        process.exit(1);
      }
      assertSandboxBinaryAllowed(targetBin, globalCfg, agentCfg);
      console.log(JSON.stringify({ ok: true, bin: targetBin, allowed: true }, null, 2));
      process.exit(0);
    } else if (sub === "profile") {
      const plat = targetPlatform || process.platform;
      if (plat === "linux") {
        console.log(
          JSON.stringify(
            buildLinuxBwrapWhitelistArgs({
              workspaceRoot,
              scratchpadDir,
              globalCfg,
              agentCfg,
            }),
            null,
            2,
          ),
        );
      } else if (plat === "win32") {
        console.log(
          JSON.stringify(
            buildWindowsWslBwrapWhitelistArgs({
              workspaceRoot,
              scratchpadDir,
              distro,
              globalCfg,
              agentCfg,
            }),
            null,
            2,
          ),
        );
      } else if (plat === "darwin") {
        console.log(
          buildMacosSeatbeltWhitelistProfile({
            workspaceRoot,
            scratchpadDir,
            globalCfg,
            agentCfg,
          }),
        );
      } else {
        throw new Error(`[EMA Sandbox Panic] Unsupported platform '${plat}'`);
      }
      process.exit(0);
    } else {
      console.error(`Unknown 'sandbox' subcommand: ${sub}. Use 'status', 'check-bin', or 'profile'.`);
      process.exit(1);
    }
  }

  if (command === "world") {
    const sub = args[1];

    let configPath;
    let agentId;
    let explicitWorldUrl;
    let flagChannel;
    let flagMessage;
    let flagParent;
    let flagSender;
    let flagSenderName;
    let flagBody;
    const positional = [];

    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--config" && i + 1 < args.length) {
        configPath = args[++i];
      } else if ((args[i] === "--agent" || args[i] === "-a") && i + 1 < args.length) {
        agentId = args[++i];
      } else if ((args[i] === "--url" || args[i] === "--world-url") && i + 1 < args.length) {
        explicitWorldUrl = args[++i].replace(/\/$/, "");
      } else if ((args[i] === "--channel" || args[i] === "--channel-id") && i + 1 < args.length) {
        flagChannel = args[++i];
      } else if ((args[i] === "--message" || args[i] === "--text" || args[i] === "-m") && i + 1 < args.length) {
        flagMessage = args[++i];
      } else if ((args[i] === "--parent" || args[i] === "--reply-to") && i + 1 < args.length) {
        flagParent = args[++i];
      } else if (args[i] === "--sender" && i + 1 < args.length) {
        flagSender = args[++i];
      } else if (args[i] === "--sender-name" && i + 1 < args.length) {
        flagSenderName = args[++i];
      } else if ((args[i] === "--body" || args[i] === "-d") && i + 1 < args.length) {
        flagBody = args[++i];
      } else if (args[i].startsWith("--")) {
        throw new Error(`[EMA World CLI Panic] Unknown flag for 'ema.js world': ${args[i]}`);
      } else {
        positional.push(args[i]);
      }
    }

    if (sub === "serve") {
      const hub = await ensureSharedWorldServer({ configPath });
      console.log(`=== EMA Shared World HTTP Server ===`);
      console.log(`Listening:  ${hub.url}`);
      console.log(`World Data: ${hub.worldDataDir}`);
      console.log(`Web DB:     ${hub.webDbPath}`);
      console.log(`QQ DB:      ${hub.qqDbPath}`);
      for (const r of hub.listFormattedRoutes()) {
        console.log(`  - ${r.worldName} ${r.prefix}`);
      }
      const shutdown = () => {
        hub.dispose();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return;
    }

    const globalCfg = loadEmaGlobalConfig(configPath);
    const agentCfg = agentId ? loadEmaAgentConfig(agentId, globalCfg.appDataDir) : null;
    const worldHttpUrl =
      explicitWorldUrl || (agentCfg ? agentCfg.world.url : globalCfg.world.url);

    const requestWorldOverHttp = async (routePath, init = {}) => {
      const normalizedPath = routePath.startsWith("/") ? routePath : `/${routePath}`;
      const url = `${worldHttpUrl}${normalizedPath}`;
      const res = await fetch(url, init);
      if (res.status === 404) {
        const text = await res.text();
        throw new Error(`Route not found: ${normalizedPath}${text ? ` (${text})` : ""}`);
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Route error (${res.status}): ${text || normalizedPath}`);
      }
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        return await res.json();
      }
      return await res.text();
    };

    if (sub === "ls") {
      const data = await requestWorldOverHttp("/world/routes");
      if (!data || !Array.isArray(data.routes)) {
        throw new Error(`[EMA World Panic] Invalid response from /world/routes`);
      }
      for (const r of data.routes) {
        console.log(`${r.worldName} ${r.prefix}`);
      }
      process.exit(0);
    }

    if (sub === "get") {
      const targetPath = positional[0];
      if (!targetPath) {
        throw new Error(
          "Missing path argument for 'world get'. Example: ema.js world get /world/web/channels/web:chatroom:default/items",
        );
      }
      const result = await requestWorldOverHttp(targetPath, { method: "GET" });
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    if (sub === "post") {
      const targetPath = positional[0];
      if (!targetPath) {
        throw new Error(
          "Missing path argument for 'world post'. Example: ema.js world post /world/web/actions/message.post '{\"channelId\":\"web:chatroom:default\",\"message\":\"Hello\"}'",
        );
      }
      let payloadObj = {};
      const rawJsonArg = flagBody !== undefined ? flagBody : positional[1];
      if (rawJsonArg !== undefined) {
        payloadObj = JSON.parse(rawJsonArg);
      }
      if (flagChannel !== undefined) payloadObj.channelId = flagChannel;
      if (flagMessage !== undefined) payloadObj.message = flagMessage;
      if (flagParent !== undefined) payloadObj.parentItemId = flagParent;
      if (flagSender !== undefined) {
        payloadObj.sender = flagSender;
        payloadObj.actorId = `actor:${flagSender.replace(/^actor:/, "")}`;
      }
      if (flagSenderName !== undefined) {
        payloadObj.senderName = flagSenderName;
        payloadObj.actorName = flagSenderName;
      }
      if (agentCfg) {
        if (!payloadObj.sender) payloadObj.sender = agentCfg.agent.id;
        if (!payloadObj.senderName) payloadObj.senderName = agentCfg.agent.name;
        if (!payloadObj.actorId) payloadObj.actorId = `actor:${agentCfg.agent.id}`;
        if (!payloadObj.actorName) payloadObj.actorName = agentCfg.agent.name;
        if (!payloadObj.channelId && agentCfg.world.web.channelId) {
          payloadObj.channelId = agentCfg.world.web.channelId;
        }
      }

      const result = await requestWorldOverHttp(targetPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadObj),
      });
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

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
      let configPath;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--config" && i + 1 < args.length) configPath = args[++i];
      }
      const qqCfg = loadEmaGlobalConfig(configPath).world.qq;
      let gateway = qqCfg.gatewayUrl;
      let token = qqCfg.gatewayToken;
      let group = qqCfg.groups[0];
      let session = "619e98db";
      let agent = "aoi_rei";
      let pollInterval = 2000;
      let watchFor = "";
      let requireMention = true;
      let dbPath = qqCfg.dbPath;

      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--config") i++;
        else if (args[i] === "--gateway" || args[i] === "--url") gateway = args[++i];
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
      let configPath;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--config" && i + 1 < args.length) configPath = args[++i];
      }
      let qrPath = path.resolve(process.cwd(), ".qq-login-qrcode.png");
      let credentialPath = path.resolve(process.cwd(), "qq-credentials.json");
      let gatewayUrl = loadEmaGlobalConfig(configPath).world.qq.gatewayUrl;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--config") i++;
        else if (args[i] === "--qr-path") qrPath = path.resolve(args[++i]);
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

  if (command === "wash" || command === "dataset") {
    let configPath = "";
    let promptText = "";
    let outPath = "";
    const positional = [];

    for (let i = 1; i < args.length; i++) {
      if ((args[i] === "--config" || args[i] === "-c") && i + 1 < args.length) {
        configPath = args[++i];
      } else if ((args[i] === "--prompt" || args[i] === "-p") && i + 1 < args.length) {
        promptText = args[++i];
      } else if (args[i] === "--out" && i + 1 < args.length) {
        outPath = args[++i];
      } else if (!args[i].startsWith("-")) {
        positional.push(args[i]);
      }
    }

    if (!configPath && positional.length > 0) configPath = positional[0];
    if (!promptText && positional.length > 1) promptText = positional.slice(1).join(" ");

    if (!configPath) {
      console.error(
        'Error: Missing --config <persona.toml>. Example: ema.js wash --config personas/sakana-kawaii/persona.toml --prompt "清洗日常与自主意识剧本，对齐第一人称<OS>与一逗到底口语<Action>"',
      );
      process.exit(1);
    }

    const res = washDatasetFromConfig({
      configPath,
      prompt: promptText,
      outPath: outPath || undefined,
    });

    console.log(`=== EMA Dataset Washer (Single-TOML) ===`);
    console.log(`Config File:       ${res.configFile}`);
    console.log(`Persona ID:        ${res.personaId} (${res.targetCharacter} <-> ${res.protagonistCharacter})`);
    console.log(`Wash Prompt:       ${res.washPrompt || "(default causal alignment & golden exemplars)"}`);
    console.log(`Washed Scenes:     ${res.totalScenes}`);
    console.log(`Washed Turns:      ${res.totalTurns} (explicit <OS>: ${res.turnsWithExplicitOS})`);
    console.log(`Golden Exemplars:  ${res.goldenExemplarCount}`);
    console.log(`Washed Output:     ${res.washedDatasetPath}`);
    return;
  }

  if (command === "persona") {
    let configPath = "";
    let action;
    let promptText = "";
    let appDataDir;
    let noWorkbench = false;
    const positional = [];

    for (let i = 1; i < args.length; i++) {
      if ((args[i] === "--config" || args[i] === "-c") && i + 1 < args.length) {
        configPath = args[++i];
      } else if ((args[i] === "--prompt" || args[i] === "-p") && i + 1 < args.length) {
        promptText = args[++i];
      } else if (args[i] === "--app-data-dir" && i + 1 < args.length) {
        appDataDir = args[++i];
      } else if (args[i] === "--no-workbench") {
        noWorkbench = true;
      } else if (!args[i].startsWith("-")) {
        positional.push(args[i]);
      }
    }

    if (
      positional.length > 0 &&
      (positional[0] === "show" || positional[0] === "sync" || positional[0] === "init")
    ) {
      action = positional.shift();
    }
    if (!configPath && positional.length > 0) configPath = positional.shift();
    if (!promptText && positional.length > 0) promptText = positional.join(" ");

    if (!configPath) {
      console.error(
        'Error: Missing --config <persona.toml>. Example: ema.js persona --config personas/sakana-kawaii/persona.toml',
      );
      process.exit(1);
    }

    const res = managePersonaFromConfig({
      configPath,
      action,
      prompt: promptText || undefined,
      appDataDir,
      installWorkbench: !noWorkbench,
    });

    console.log(`=== EMA Persona Manager (${res.action.toUpperCase()}) ===`);
    console.log(`Config File:       ${res.configFile}`);
    console.log(`Persona ID:        ${res.personaId} (Agent: ${res.agentId})`);
    console.log(`Display Name:      ${res.displayName}`);
    console.log(`Traits / Rules:    ${res.traitCount} traits, ${res.invariantCount} hard invariants`);
    console.log(`Script Chapters:   ${res.chaptersCount} daily + ${res.autonomyChaptersCount} autonomy`);
    console.log(
      `Checkpoint:        ${res.checkpointExists ? `Yes (${res.checkpointVersion || "P_0_0"})` : "Not trained yet"}`,
    );
    console.log(`AGENTS.md Path:    ${res.agentsMdPath}`);
    if (res.syncedAgentPath) {
      console.log(`Synced Agent:      ${res.syncedAgentPath}`);
    }
    if (res.workbenchInstalled) {
      console.log(`Workbench:         companion_portal installed`);
    }
    return;
  }

  if (command === "train") {
    let configPath = "";
    let promptText = "";
    let scriptPath = "";
    let seedPath = "";
    let outPath = "./ema-persona-checkpoint.json";
    let agentId = "";
    let targetCharacter = "";
    let protagonistCharacter = "";
    let maxScenes;
    let studentModelId = "gemini-3.8-flash";
    let teacherModelId = "gemini-3.8-flash";
    let thinkingLevel = "medium";
    let noSync = false;
    let appDataDir;
    const positional = [];

    for (let i = 1; i < args.length; i++) {
      if ((args[i] === "--config" || args[i] === "-c") && i + 1 < args.length)
        configPath = args[++i];
      else if ((args[i] === "--prompt" || args[i] === "-p") && i + 1 < args.length)
        promptText = args[++i];
      else if (args[i] === "--script" && i + 1 < args.length) scriptPath = args[++i];
      else if (args[i] === "--seed" && i + 1 < args.length) seedPath = args[++i];
      else if (args[i] === "--out" && i + 1 < args.length) outPath = args[++i];
      else if (args[i] === "--agent-id" && i + 1 < args.length) agentId = args[++i];
      else if (args[i] === "--target" && i + 1 < args.length) targetCharacter = args[++i];
      else if (args[i] === "--protagonist" && i + 1 < args.length) protagonistCharacter = args[++i];
      else if (args[i] === "--scenes" && i + 1 < args.length) maxScenes = Number(args[++i]);
      else if (args[i] === "--student-model" && i + 1 < args.length) studentModelId = args[++i];
      else if (args[i] === "--teacher-model" && i + 1 < args.length) teacherModelId = args[++i];
      else if (args[i] === "--thinking" && i + 1 < args.length) thinkingLevel = args[++i];
      else if (args[i] === "--no-sync") noSync = true;
      else if (args[i] === "--app-data-dir" && i + 1 < args.length) appDataDir = args[++i];
      else if (!args[i].startsWith("-")) positional.push(args[i]);
    }

    if (!configPath && !scriptPath && positional.length > 0) {
      configPath = positional[0];
    }
    if (!promptText && positional.length > 1) {
      promptText = positional.slice(1).join(" ");
    }

    if (configPath) {
      console.log(`=== EMA Persona Trainer (Single-TOML) ===`);
      console.log(`Config File: ${path.resolve(configPath)}`);
      if (promptText) {
        console.log(`Prompt:      ${promptText}`);
      }
      const res = await trainFromConfig({
        configPath,
        prompt: promptText || undefined,
        maxScenes,
        syncAgent: noSync ? false : undefined,
        appDataDir,
        onSceneProgress: (r, idx, total) => {
          console.log(
            `[Train ${idx}/${total}] ${r.sceneId} (${r.title}) | ${r.initialMeanScore} -> ${r.finalMeanScore} | P=${r.personalityMutatedTo || r.personalityVersionUsed} | cost=$${r.metrics.costUsd}`,
          );
        },
      });
      console.log(`-----------------------------------------`);
      console.log(
        `Completed ${res.trainedSceneCount} scene(s) | Mean Score: ${res.initialMeanScore} -> ${res.finalMeanScore} | Final P: ${res.finalPersonalityVersion}`,
      );
      console.log(
        `Memory Policy: retained ${res.retainedMemoryCount} peer scene(s), pruned ${res.prunedMemoryCount} rehearsal scene(s)`,
      );
      console.log(`Checkpoint:    ${res.checkpointPath}`);
      console.log(`AGENTS.md:     ${res.agentsMdPath}`);
      if (res.syncedAgentPath) {
        console.log(`Synced Agent:  ${res.syncedAgentPath}`);
      }
      return;
    }

    if (!scriptPath) {
      console.error(
        'Error: --config <persona.toml> is required for `ema.js train`. Example: ema.js train --config personas/sakana-kawaii/persona.toml --prompt "强化一逗到底语感与零括号口语化动作"',
      );
      process.exit(1);
    }

    const effectiveMaxScenes = maxScenes ?? 10;

    const seed = seedPath ? loadExternalPersonaSeed(seedPath) : null;
    const ds = loadGalgameDataset(scriptPath, {
      targetCharacter: targetCharacter || seed?.targetCharacter,
      protagonistCharacter: protagonistCharacter || seed?.protagonistCharacter,
      speakerAliases: seed?.speakerAliases,
      sceneSpeakerOverrides: seed?.sceneSpeakerOverrides,
    });

    const selected = ds.scenes.slice(0, effectiveMaxScenes);
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
      archivePath = path.resolve(path.dirname(statePath), `${agentId}-memory-archive.sqlite`);
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
      archiveDbPath: archivePath,
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
      archivePath = path.resolve(path.dirname(statePath), `${agentId}-memory-archive.sqlite`);
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
      archiveDbPath: archivePath,
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
