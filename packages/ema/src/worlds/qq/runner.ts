/**
 * @prism-shadow/ema - QQ Companion Watch Bridge & Long-Running Runner
 *
 * Implements:
 * 1. Long-running QQ companion bridge connecting QQWorld to a persistent Penguin session.
 * 2. Inbound mention filtering (requireMentionInGroups): only responds when @mentioned or replied to.
 * 3. Group message synchronization & gap perception running in the background.
 * 4. Automatic turn dispatch: formats inbound batch into prompt, invokes LLM session, cleans response.
 * 5. Outbound reply dispatch quoting the triggering message and addressing the sender.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SimpleEmaRouter } from "../../router.js";
import { SimpleEmaInputBatcher, formatBatchToXml } from "../../input-batcher.js";
import { assertAgentIdentity } from "../../minimal.js";
import { QQWorld } from "./world.js";
import type { EmaCtx, EmaActor, EmaInput, EmaWorldRegistry } from "../../interfaces.js";
import type { QQWorldOptions } from "./types.js";

/**
 * Cleans raw stdout from `penguin run` to extract only the clean assistant reply text,
 * stripping headers, thinking blocks, and stats footers.
 */
export function cleanLlmReplyText(raw: string): string {
  let text = String(raw || "").trim();

  // Strip leading PenguinHarness header
  text = text.replace(/^PenguinHarness\s+run[^\n]*\n(?:[A-Za-z0-9_-]+:[^\n]*\n)*/i, "").trim();

  // Strip trailing stats block ([stats] context ...)
  text = text.replace(/\n\[stats\][^\n]*$/i, "").trim();

  // If there's a leading thinking section starting with **
  if (text.startsWith("**")) {
    const tripleNewlineIndex = text.indexOf("\n\n\n");
    if (tripleNewlineIndex !== -1) {
      text = text.slice(tripleNewlineIndex).trim();
    } else {
      const paragraphs = text.split(/\n{2,}/);
      while (
        paragraphs.length > 1 &&
        (paragraphs[0].trim().startsWith("**") ||
          /^(?:I'm|I am|The user|Analyzing|Checking|Reviewing|Thinking|Looking|Let me)/i.test(
            paragraphs[0].trim(),
          ))
      ) {
        paragraphs.shift();
      }
      text = paragraphs.join("\n\n").trim();
    }
  }

  // If the model emitted <OS>...</OS> and/or <Action>...</Action> blocks, extract only <Action>
  const actionMatch = text.match(/<Action>([\s\S]*?)<\/Action>/i);
  if (actionMatch) {
    text = actionMatch[1].trim();
  } else {
    text = text.replace(/<OS>[\s\S]*?<\/OS>/gi, "").replace(/<\/?Action>/gi, "").trim();
  }

  return text.trim();
}

export interface QQCompanionRunnerOptions {
  gatewayUrl?: string;
  gatewayToken?: string;
  groupId?: string;
  session?: string;
  agentId?: string;
  requireMentionInGroups?: boolean;
  pollIntervalMs?: number;
  watchFor?: string;
  dbPath?: string;
  selfId?: string;
  nicknames?: string[];
  systemPrompt?: string;
  llmInvoker?: (prompt: string, batch: ReadonlyArray<EmaInput>) => Promise<string>;
  env?: Record<string, string | undefined>;
}

export interface QQCompanionRunnerInstance {
  ctx: EmaCtx;
  router: SimpleEmaRouter;
  inputBatcher: SimpleEmaInputBatcher;
  world: QQWorld;
  actor: EmaActor;
  dispose: () => void;
}

/**
 * Boots a long-running QQ Companion runner instance.
 */
export function createQQCompanionRunner(
  options: QQCompanionRunnerOptions = {},
): QQCompanionRunnerInstance {
  const env = options.env ?? process.env;
  const agentId = options.agentId || env.PENGUIN_AGENT_ID || "aoi_rei";
  const session = options.session || "619e98db";
  const groupId = String(options.groupId || "1044916258").replace(/^group:/, "");
  const gatewayUrl =
    options.gatewayUrl ||
    env.SNOWLUMA_GATEWAY_URL ||
    env.ONEBOT_GATEWAY_URL ||
    "http://localhost:13000";
  const gatewayToken =
    options.gatewayToken ||
    env.SNOWLUMA_TOKEN ||
    env.ONEBOT_TOKEN;
  const selfId = options.selfId || "1835387598";
  const nicknames = options.nicknames || ["小纸夜", "Ema", "怜", "Aoi Rei"];
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const requireMentionInGroups = options.requireMentionInGroups ?? true;
  const dbPath =
    options.dbPath ||
    process.env.EMA_QQ_DB_PATH ||
    (fs.existsSync("/home/rei/work/aoi-rei")
      ? "/home/rei/work/aoi-rei/data/qq-world.sqlite"
      : path.resolve(process.cwd(), "data", "qq-world.sqlite"));

  const router = new SimpleEmaRouter();
  const inputBatcher = new SimpleEmaInputBatcher({
    dbPath,
    debounceMs: 500,
    maxWaitMs: 2000,
  });

  const worldsMap = new Map<string, QQWorld>();
  const registry: EmaWorldRegistry = {
    register: (name, world) => {
      worldsMap.set(name, world as QQWorld);
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

  const worldOptions: QQWorldOptions = {
    gatewayUrl,
    gatewayToken,
    allowedGroups: [groupId],
    selfId,
    nicknames,
    requireMentionInGroups,
    autoSync: true,
    syncIntervalMs: pollIntervalMs,
    dbPath,
    env: { ...env, PENGUIN_AGENT_ID: agentId },
  };

  const world = new QQWorld(worldOptions);
  const worldHandle = world.start(ctx);

  const actor: EmaActor = {
    id: `actor-qq-${agentId}`,
    name: "Ema Companion",
    session,
    agentId,
  };

  // FIFO turn chain preventing overlapping turn collisions
  let turnChain = Promise.resolve();

  const batchSubscription = inputBatcher.onBatch((batch) => {
    if (batch.length === 0) return;

    turnChain = turnChain
      .then(async () => {
        const primary = batch[0];
        const senderUid = primary.sender.id.replace(/^user:qq:/, "");
        const senderName = primary.sender.name || senderUid;

        console.log(
          `\n[QQ Runner] Inbound batch of ${batch.length} message(s) from group ${groupId} by ${senderName}:`,
        );
        for (const item of batch) {
          console.log(`  - [${item.id}] ${item.content}`);
        }

        // Format prompt for LLM companion session
        const promptLines = [
          `[来自 QQ 群 "Ema 同好会" (${groupId}) 中 @你的消息]:`,
          `发送人: ${senderName} (QQ: ${senderUid})`,
          `消息内容: ${primary.content}`,
        ];
        if (batch.length > 1) {
          promptLines.push(`连续消息:`);
          for (let i = 1; i < batch.length; i++) {
            promptLines.push(`  - ${batch[i].content}`);
          }
        }
        promptLines.push(
          `\n请以伴侣身份按 <OS>...</OS> 与 <Action>...</Action> 格式回复群友（系统会自动提取 <Action> 发送至群聊，无需输出其他前缀或系统状态）：`,
        );

        const promptText = promptLines.join("\n");
        let replyText = "";

        if (options.llmInvoker) {
          replyText = await options.llmInvoker(promptText, batch);
        } else {
          console.log(`[QQ Runner -> Session ${session}]: Invoking companion turn...`);
          try {
            const stdout = execFileSync(
              "penguin",
              ["run", "--session", session, "-m", promptText, "--approve", "deny-all"],
              { encoding: "utf8", env },
            );
            replyText = cleanLlmReplyText(stdout);
          } catch (err: any) {
            console.error(`[QQ Runner] Failed to invoke LLM turn via penguin run:`, err.message || err);
            replyText = "抱歉呀，我刚刚开了一下小差，能请你再说一次吗？";
          }
        }

        if (!replyText) {
          console.log(`[QQ Runner] Empty reply generated; skipping dispatch.`);
          return;
        }

        console.log(`[QQ Runner -> QQ Group ${groupId}]: Dispatched reply:`);
        console.log(`  ${replyText}`);

        world.interact(ctx, actor, `group:${groupId}`, {
          text: replyText,
          replyTo: primary.id,
          at: [senderUid],
        });
      })
      .catch((err) => {
        console.error(`[QQ Runner] Error processing turn chain:`, err);
      });
  });

  return {
    ctx,
    router,
    inputBatcher,
    world,
    actor,
    dispose: () => {
      batchSubscription.dispose();
      worldHandle.dispose();
      world.dispose();
      inputBatcher.dispose();
    },
  };
}
