/**
 * @prism-shadow/ema - Telegram Companion Watch Bridge & Long-Running Runner
 *
 * Connects TelegramWorld to a configured Penguin companion session.
 *
 * Key Invariants:
 * 1. Strict Chat & User Authorization (`TelegramAuthorizationManager`):
 *    - Requires explicit `allowedChatIds` / `chatId` or `ownerIds` (no hardcoded personal defaults).
 *    - Public archive channels (`forwardSourceChatIds`) are read/forward-source-only.
 * 2. Self-Reply Loop Prevention in Channels:
 *    - `TelegramWorld` tracks every outbound `message_id` sent by the bot
 *      and skips pre-existing backlog on initial startup (`skipInitialUpdates: true` by default).
 * 3. Untrusted Input Sanitization & Outbound Privacy Filtering:
 *    - Formats inbound messages with `formatTelegramInputXml` and enforces
 *      `checkTelegramContentFilter` on all outbound messages.
 * 4. Least-Privilege Execution:
 *    - `buildPenguinRunArgs` defaults to `--approve deny-all` unless explicitly overridden.
 *    - Owner status (`is_owner`) comes strictly from `TelegramWorld`'s verified `ownerIds` / `adminUsers`.
 */

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SimpleEmaRouter } from "../../router.js";
import { SimpleEmaInputBatcher } from "../../input-batcher.js";
import { TelegramWorld } from "./world.js";
import { normalizeTelegramChatId } from "./authorization.js";
import { formatTelegramInputXml } from "./filter.js";
import type { EmaCtx, EmaActor, EmaInput, EmaWorldRegistry } from "../../interfaces.js";
import type {
  TelegramCompanionRunnerOptions,
  TelegramCompanionRunnerInstance,
} from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_HTTP_BODY_BYTES = 1024 * 1024;

/**
 * Builds CLI arguments for `penguin run`.
 * IMPORTANT: When reusing an existing `--session`, `--workspace`, `--provider`, and
 * `--model-id` MUST NOT be passed (the server rejects overriding them on an existing session).
 */
export function buildPenguinRunArgs(params: {
  session?: string;
  agentId: string;
  provider?: string;
  modelId?: string;
  thinking?: string;
  workspace?: string;
  approveMode?: "allow-all" | "deny-all" | "read-only";
  promptText: string;
}): string[] {
  const args = ["run"];
  if (params.session) {
    args.push("--session", params.session, "--agent-id", params.agentId);
  } else {
    args.push("--agent-id", params.agentId);
    if (params.provider && params.modelId) {
      args.push("--provider", params.provider, "--model-id", params.modelId);
    }
    if (params.workspace) {
      args.push("--workspace", params.workspace);
    }
  }
  if (params.thinking) {
    args.push("--thinking", params.thinking);
  }
  args.push("--approve", params.approveMode || "deny-all", "--json", "-m", params.promptText);
  return args;
}

/**
 * Extracts assistant text from `penguin run --json` stdout (for logging/diagnostics).
 */
export function extractPenguinRunReply(stdout: string): string {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const parsed = JSON.parse(line) as { text?: string };
        if (typeof parsed.text === "string") {
          return parsed.text.trim();
        }
      } catch {
        // Fall through
      }
    }
  }
  return trimmed;
}

/**
 * Checks whether an inbound Telegram message should trigger a companion reply.
 * - In DMs (`dm:*`) and channels when `requireMentionInChannels` is false:
 *   always addressed to the companion.
 * - In multi-member groups (`group:*`, `thread:*`) when `requireMentionInGroups` is true:
 *   requires @botUsername, configured nickname mention, or reply to the bot.
 */
export function isTelegramMessageAddressedToCompanion(
  input: EmaInput,
  options: {
    botId?: string;
    botUsername?: string;
    nicknames?: string[];
    requireMentionInGroups?: boolean;
    requireMentionInChannels?: boolean;
  },
): boolean {
  if (input.partId.startsWith("dm:")) {
    return true;
  }
  if (input.partId.startsWith("channel:")) {
    if (!options.requireMentionInChannels) {
      return true;
    }
  } else if (!options.requireMentionInGroups) {
    return true;
  }

  const meta = (input.metadata || {}) as Record<string, unknown>;
  if (options.botId && meta.replyToFromId && String(meta.replyToFromId) === String(options.botId)) {
    return true;
  }
  if (
    options.botUsername &&
    typeof meta.replyToFromUsername === "string" &&
    meta.replyToFromUsername.toLowerCase() === options.botUsername.toLowerCase()
  ) {
    return true;
  }

  const text = input.content || "";
  if (
    options.botUsername &&
    text.toLowerCase().includes(`@${options.botUsername.toLowerCase()}`)
  ) {
    return true;
  }
  for (const nick of options.nicknames ?? []) {
    if (nick && text.toLowerCase().includes(nick.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Boots a long-running Telegram Companion runner instance.
 */
export function createTelegramCompanionRunner(
  options: TelegramCompanionRunnerOptions = {},
): TelegramCompanionRunnerInstance {
  const env = options.env ?? process.env;
  const botToken = options.botToken || env.TELEGRAM_API_KEY;
  if (!botToken && !options.llmInvoker) {
    throw new Error(
      "[Telegram Runner] Missing Telegram bot token (pass options.botToken or set TELEGRAM_API_KEY)",
    );
  }

  const agentId = String(options.agentId || "").trim();
  if (!agentId) {
    throw new Error("[Telegram Runner] Missing required options.agentId");
  }

  const rawAllowedChats = [
    ...(options.allowedChatIds ?? []),
    ...(options.chatId !== undefined ? [options.chatId] : []),
  ];
  const allowedChatIds = Array.from(
    new Set(rawAllowedChats.map(normalizeTelegramChatId).filter(Boolean)),
  );
  const ownerIds = options.ownerIds ?? [];
  if (allowedChatIds.length === 0 && ownerIds.length === 0) {
    throw new Error(
      "[Telegram Runner] Missing authorization scope: provide options.chatId, options.allowedChatIds, or options.ownerIds",
    );
  }

  const primaryChatId =
    options.chatId !== undefined
      ? normalizeTelegramChatId(options.chatId)
      : allowedChatIds[0];
  const writeChatIds = Array.from(
    new Set((options.writeChatIds ?? allowedChatIds).map(normalizeTelegramChatId).filter(Boolean)),
  );
  const forwardSourceChatIds = (options.forwardSourceChatIds ?? [])
    .map(normalizeTelegramChatId)
    .filter(Boolean);

  const session = options.session;
  const provider = options.provider || "penguin-go";
  const modelId = options.modelId || "gemini-4-hydrogen";
  const thinking = options.thinking || "max";
  const workspace = options.workspace;
  const actorName = options.actorName || agentId;

  const botUsername = options.botUsername?.replace(/^@/, "");
  const botId =
    options.botId !== undefined
      ? String(options.botId)
      : botToken
        ? botToken.replace(/^[^0-9]*/, "").split(":")[0]
        : undefined;
  const nicknames = Array.from(
    new Set([...(options.nicknames ?? []), ...(botUsername ? [botUsername] : [])].filter(Boolean)),
  );
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const requireMentionInGroups = options.requireMentionInGroups ?? true;
  const requireMentionInChannels = options.requireMentionInChannels ?? false;
  const skipInitialUpdates = options.skipInitialUpdates ?? true;
  const dbPath =
    options.dbPath ||
    (process.env.NODE_ENV === "test" || process.env.VITEST
      ? ":memory:"
      : path.join(os.tmpdir(), `ema-telegram-${agentId}.sqlite`));
  const botIndexDir = options.botIndexDir;
  const opsLogDir = options.opsLogDir;
  const execTimeoutMs = options.execTimeoutMs ?? 120_000;

  const router = new SimpleEmaRouter();
  const inputBatcher = new SimpleEmaInputBatcher({
    dbPath,
    debounceMs: 500,
    maxWaitMs: 2000,
  });

  const worldsMap = new Map<string, TelegramWorld>();
  const registry: EmaWorldRegistry = {
    register: (name, world) => {
      worldsMap.set(name, world as TelegramWorld);
      return {
        dispose: () => {
          worldsMap.delete(name);
        },
      };
    },
    get: (name) => worldsMap.get(name),
    list: () => [...worldsMap.entries()].map(([name, world]) => ({ name, world })),
  };

  const ctx: EmaCtx = {
    router,
    inputBatcher,
    registry,
  };

  const world = new TelegramWorld({
    botToken,
    botId,
    botUsername,
    ownerIds,
    pollInterval: pollIntervalMs,
    skipInitialUpdates,
    dbPath,
    botIndexDir,
    opsLogDir,
    opsLogFolderName: options.opsLogFolderName,
    allowedMediaDirs: options.allowedMediaDirs,
    webhookSecret: options.webhookSecret,
    defaultChatId: primaryChatId,
    chatAliases: options.chatAliases,
    authorization: {
      enabled: true,
      allowedChatIds,
      writeChatIds,
      forwardSourceChatIds,
      adminUsers: ownerIds,
    },
    fetchImpl: options.fetchImpl,
    env: { ...env, PENGUIN_AGENT_ID: agentId },
  });

  const worldHandle = world.start(ctx);

  // Mount `/world/routes` and optional HTTP World API server
  const routesHandle = router.serve(
    "/world/routes",
    () => ({
      routes: router
        .listRoutes()
        .filter((r) => r.prefix !== "/world/routes")
        .map((r) => ({
          worldName: r.prefix.startsWith("/world/telegram") ? "TelegramWorld" : "UnknownWorld",
          prefix: r.prefix,
          description: r.description,
        })),
    }),
    "Lists active world routes",
  );

  let httpServer: http.Server | null = null;
  let worldUrl: string | undefined;
  if (options.serveHttp) {
    const worldHost = options.worldHost || "127.0.0.1";
    const worldPort = options.worldPort ?? 17480;
    worldUrl = `http://${worldHost}:${worldPort}`;
    httpServer = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", worldUrl);
        const method = req.method || "GET";
        let bodyBuf: Buffer | undefined;
        if (method === "POST" || method === "PUT" || method === "PATCH") {
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          for await (const chunk of req) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += buf.length;
            if (totalBytes > MAX_HTTP_BODY_BYTES) {
              res.statusCode = 413;
              res.setHeader("content-type", "text/plain; charset=utf-8");
              res.end("Payload Too Large");
              return;
            }
            chunks.push(buf);
          }
          bodyBuf = Buffer.concat(chunks);
        }
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string") headers.set(k, v);
          else if (Array.isArray(v)) headers.set(k, v.join(", "));
        }
        const webReq = new Request(reqUrl.toString(), {
          method,
          headers,
          body: bodyBuf && bodyBuf.length > 0 ? new Uint8Array(bodyBuf) : undefined,
        });
        const webRes = await router.app.fetch(webReq);
        res.statusCode = webRes.status;
        webRes.headers.forEach((val, key) => {
          res.setHeader(key, val);
        });
        const arrayBuf = await webRes.arrayBuffer();
        res.end(Buffer.from(arrayBuf));
      } catch (err: any) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(err?.message || String(err));
      }
    });
    httpServer.on("error", (err) => {
      console.error(`[Telegram Runner] World HTTP server error on ${worldHost}:${worldPort}:`, err);
    });
    httpServer.listen(worldPort, worldHost, () => {
      console.log(`[Telegram Runner] World HTTP API listening at ${worldUrl}/world/telegram/*`);
    });
  }

  const actor: EmaActor = {
    id: `actor-telegram-${agentId}`,
    name: actorName,
    session: session || `tg-${agentId}`,
    agentId,
  };

  let turnChain = Promise.resolve();
  let disposed = false;
  const activeAbortControllers = new Set<AbortController>();

  const batchSubscription = inputBatcher.onBatch((batch) => {
    if (batch.length === 0 || disposed) return;

    const addressed = batch.filter((item) =>
      isTelegramMessageAddressedToCompanion(item, {
        botId,
        botUsername,
        nicknames,
        requireMentionInGroups,
        requireMentionInChannels,
      }),
    );
    if (addressed.length === 0) return;

    turnChain = turnChain
      .then(async () => {
        if (disposed) return;
        const primary = addressed[addressed.length - 1];
        const targetPartId = primary.partId;
        const meta = (primary.metadata || {}) as Record<string, any>;
        const chatId = meta.chatId ?? normalizeTelegramChatId(targetPartId);
        const chatTitle = meta.chatTitle || String(chatId);
        const chatType = meta.chatType || (targetPartId.startsWith("channel:") ? "channel" : "group");
        const senderUid = primary.sender.id.replace(/^user:/, "");
        const senderName = primary.sender.name || senderUid;

        console.log(
          `\n[Telegram Runner] Inbound batch of ${addressed.length} message(s) in ${chatTitle} (${chatId}) from ${senderName}:`,
        );
        for (const item of addressed) {
          console.log(`  - [${item.id}] ${item.content}`);
        }

        // Send typing indicator in the background
        if (world.client) {
          world.client.sendChatAction(chatId, "typing").catch(() => {});
        }

        const promptText = formatTelegramInputXml({
          chatId,
          chatType,
          partId: targetPartId,
          chatTitle,
          messages: addressed.map((item) => {
            const itemMeta = (item.metadata || {}) as Record<string, any>;
            const itemIsOwner = Boolean(item.sender.isOwner);
            const itemSenderId = item.sender.id.replace(/^user:/, "");
            return {
              senderId: itemSenderId,
              senderName: item.sender.name || itemSenderId,
              isOwner: itemIsOwner,
              messageId: itemMeta.messageId,
              text: item.content,
            };
          }),
        });

        if (options.llmInvoker) {
          await options.llmInvoker(promptText, addressed);
        } else {
          console.log(
            `[Telegram Runner -> Session ${session || "(new)"} (${agentId} / ${provider}:${modelId} / thinking:${thinking})]: Delivering <telegram_input> event...`,
          );
          const ac = new AbortController();
          activeAbortControllers.add(ac);
          try {
            const runArgs = buildPenguinRunArgs({
              session,
              agentId,
              provider,
              modelId,
              thinking,
              workspace,
              approveMode: options.approveMode ?? "deny-all",
              promptText,
            });
            const childEnv: Record<string, string | undefined> = {
              ...env,
              PENGUIN_AGENT_ID: agentId,
            };
            delete childEnv.PENGUIN_SESSION_ID;
            const { stdout } = await execFileAsync("penguin", runArgs, {
              encoding: "utf8",
              env: childEnv,
              maxBuffer: 16 * 1024 * 1024,
              timeout: execTimeoutMs,
              signal: ac.signal,
            });
            const replyText = extractPenguinRunReply(stdout);
            if (replyText) {
              console.log(`[Telegram Runner] Agent turn finished (${agentId}): ${replyText}`);
            }
          } catch (err: any) {
            const stderr = err?.stderr ? String(err.stderr).trim() : "";
            console.error(
              `[Telegram Runner] Failed to invoke companion turn via penguin run:`,
              stderr || err.message || err,
            );
            return;
          } finally {
            activeAbortControllers.delete(ac);
          }
        }
      })
      .catch((err) => {
        console.error(`[Telegram Runner] Error processing turn chain:`, err);
      });
  });

  return {
    ctx,
    world,
    actor,
    worldUrl,
    dispose: () => {
      disposed = true;
      for (const ac of activeAbortControllers) {
        ac.abort();
      }
      activeAbortControllers.clear();
      batchSubscription.dispose();
      routesHandle.dispose();
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
      worldHandle.dispose();
      world.dispose();
      inputBatcher.dispose();
    },
  };
}
