/**
 * @prism-shadow/ema - Minimal EMA Prototype Variant
 *
 * Characteristics & Invariants (RFC-0001):
 * 1. Zero Personality: Purely functional, neutral system prompt without persona or emotional tone.
 * 2. Zero Memory: EverMemoryArchive retrieval, indexing, and storage bypassed.
 *    (Harness session transcript accumulates turn continuity for user visibility;
 *    EMA cognitive storage, embeddings, vector search, and consolidation remain fully bypassed).
 * 3. World Abstraction: PenguinChannelWorld implements EmaWorld (@Interface) with multi-part support.
 * 4. Internal EmaRouter: World routes mounted under `/world/channel` (parts, messages).
 * 5. Transactional Input Batching: Inbound messages coalesced into <Input> XML payloads.
 * 6. Identity Guard: Verified operating agent identity before any channel dispatch.
 */

import {
  type EmaCtx,
  type EmaActor,
  type EmaActorConfig,
  type EmaInput,
  type Disposable,
  type EmaWorldRegistry,
} from "./interfaces.js";
import { SimpleEmaRouter } from "./router.js";
import {
  SimpleEmaInputBatcher,
  formatBatchToXml,
  escapeXml,
  type EmaBatcherOptions,
} from "./input-batcher.js";
import {
  PenguinChannelWorld,
  type PenguinChannelWorldOptions,
} from "./worlds/penguin-channel-world.js";
import { EmaActorRouter, type ActorSessionHost } from "./actor-router.js";

export { SimpleEmaRouter } from "./router.js";
export { SimpleEmaInputBatcher, formatBatchToXml, escapeXml } from "./input-batcher.js";
export {
  PenguinChannelWorld,
  type PenguinChannelWorldOptions,
} from "./worlds/penguin-channel-world.js";

export interface MinimalChannelMessage {
  id?: string;
  sender: string;
  channel: string;
  text: string;
  timestamp?: string;
}

export interface MinimalTurnOptions {
  systemPrompt?: string;
  channelDispatcher?: (channel: string, message: string) => Promise<void> | void;
  llmInvoker?: (prompt: string, systemPrompt: string) => Promise<string>;
  requireAgentIdentity?: boolean;
  env?: Record<string, string | undefined>;
}

export interface MinimalTurnResult {
  input: MinimalChannelMessage;
  systemPrompt: string;
  prompt: string;
  response: string;
  outputChannel: string;
  outputMessage: string;
  memoryAccessed: false;
  personalityApplied: false;
  dispatchedAgentId?: string;
}

export const DEFAULT_MINIMAL_SYSTEM_PROMPT =
  "You are a minimal assistant prototype. Answer directly, factually, and concisely. " +
  "Do not adopt a persona or emotional tone. EverMemoryArchive memory storage and retrieval are disabled.";

/**
 * Guard that verifies the calling agent's identity is present in the environment.
 * Refuses dispatch without PENGUIN_AGENT_ID.
 */
export function assertAgentIdentity(env: Record<string, string | undefined> = process.env): string {
  const agentId = env.PENGUIN_AGENT_ID?.trim();
  if (!agentId) {
    throw new Error(
      "refusing to dispatch without an agent identity; channel send would run as the server owner",
    );
  }
  return agentId;
}

/**
 * Normalizes raw channel JSON messages into standard MinimalChannelMessage instances.
 */
export function normalizeChannelMessage(raw: {
  id?: string;
  sender?: string;
  channelId?: string;
  channel?: string;
  text?: string;
  time?: string;
}): MinimalChannelMessage {
  return {
    id: raw.id,
    sender: raw.sender || "anonymous",
    channel: raw.channel || raw.channelId || "default_channel",
    text: (raw.text || "").trim(),
    timestamp: raw.time || new Date().toISOString(),
  };
}

/**
 * Evaluates whether an incoming channel message should be processed by the watch loop.
 */
export function isEligibleChannelMessage(
  msg: { id?: string; sender?: string },
  seenIds: Set<string> | string[],
): boolean {
  if (!msg.id) return false;
  const seenSet = seenIds instanceof Set ? seenIds : new Set(seenIds);
  if (seenSet.has(msg.id)) return false;
  if (!msg.sender || !msg.sender.startsWith("user:")) return false;
  return true;
}

/**
 * Filters a list of raw channel messages down to eligible, unseen human messages.
 */
export function filterNewUserMessages(
  rawMessages: Array<{
    id?: string;
    sender?: string;
    text?: string;
    time?: string;
    channel?: string;
    channelId?: string;
  }>,
  seenIds: Set<string> | string[],
  channelId?: string,
): MinimalChannelMessage[] {
  const seenSet = seenIds instanceof Set ? seenIds : new Set(seenIds);
  const eligible: MinimalChannelMessage[] = [];
  for (const raw of rawMessages) {
    if (isEligibleChannelMessage(raw, seenSet)) {
      eligible.push(
        normalizeChannelMessage({
          ...raw,
          channelId: channelId || raw.channelId || raw.channel,
        }),
      );
    }
  }
  return eligible;
}

/**
 * Parses duration strings (e.g. "12h", "4h", "30m", "45s") into milliseconds.
 */
export function parseWatchDuration(raw?: string | number): number {
  if (typeof raw === "number" && !isNaN(raw)) return Math.max(0, raw);
  if (!raw || typeof raw !== "string") return 4 * 60 * 60 * 1000;
  const str = raw.trim();
  const match = str.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i);
  if (!match) return 4 * 60 * 60 * 1000;
  const num = parseFloat(match[1]);
  const unit = (match[2] || "ms").toLowerCase();
  switch (unit) {
    case "ms":
      return Math.round(num);
    case "s":
      return Math.round(num * 1000);
    case "m":
      return Math.round(num * 60 * 1000);
    case "h":
      return Math.round(num * 60 * 60 * 1000);
    case "d":
      return Math.round(num * 24 * 60 * 60 * 1000);
    default:
      return Math.round(num);
  }
}

/**
 * Executes a minimal prototype turn with zero personality, zero memory.
 */
export async function executeMinimalTurn(
  message: MinimalChannelMessage,
  options: MinimalTurnOptions = {},
): Promise<MinimalTurnResult> {
  let dispatchedAgentId: string | undefined;

  if (options.channelDispatcher || options.requireAgentIdentity) {
    dispatchedAgentId = assertAgentIdentity(options.env ?? process.env);
  }

  const systemPrompt = options.systemPrompt ?? DEFAULT_MINIMAL_SYSTEM_PROMPT;
  const prompt = message.text;

  const memoryAccessed = false as const;
  const personalityApplied = false as const;

  let response = "";
  if (options.llmInvoker) {
    response = await options.llmInvoker(prompt, systemPrompt);
  } else {
    response = `Received message from ${message.sender}: "${message.text}"`;
  }

  const mention = message.sender && !message.sender.startsWith("@") ? `@${message.sender} ` : "";
  const outputMessage = `${mention}${response}`.trim();
  const outputChannel = message.channel;

  if (options.channelDispatcher) {
    await options.channelDispatcher(outputChannel, outputMessage);
  }

  return {
    input: message,
    systemPrompt,
    prompt,
    response,
    outputChannel,
    outputMessage,
    memoryAccessed,
    personalityApplied,
    dispatchedAgentId,
  };
}

export interface MinimalPrototypeOptions {
  channels?: string[];
  pollInterval?: number;
  stateFile?: string;
  actor?: Partial<EmaActor> | EmaActorConfig;
  sessionHost?: ActorSessionHost;
  systemPrompt?: string;
  batcherOptions?: EmaBatcherOptions;
  channelFetcher?: PenguinChannelWorldOptions["channelFetcher"];
  channelSender?: PenguinChannelWorldOptions["channelSender"];
  llmInvoker?: (xmlPayload: string, systemPrompt: string) => Promise<string>;
  env?: Record<string, string | undefined>;
}

export interface MinimalPrototypeInstance {
  ctx: EmaCtx;
  router: SimpleEmaRouter;
  inputBatcher: SimpleEmaInputBatcher;
  world: PenguinChannelWorld;
  actor: EmaActor;
  dispose: () => void;
}

/**
 * Creates and boots the Minimal Prototype instance with PenguinChannelWorld,
 * SimpleEmaRouter, and SimpleEmaInputBatcher per RFC-0001.
 */
export function createMinimalPrototype(
  options: MinimalPrototypeOptions = {},
): MinimalPrototypeInstance {
  const env = options.env ?? process.env;
  const router = new SimpleEmaRouter();
  const dbPath = options.stateFile ?? "/tmp/ema-minimal-workspace/ema-state.sqlite";
  const sqlitePath = dbPath.endsWith(".json") ? `${dbPath.replace(/\.json$/, "")}.sqlite` : dbPath;

  const inputBatcher = new SimpleEmaInputBatcher({
    dbPath: sqlitePath,
    ...options.batcherOptions,
  });

  const worldsMap = new Map<string, PenguinChannelWorld>();
  const registry: EmaWorldRegistry = {
    register: (name, world) => {
      worldsMap.set(name, world as PenguinChannelWorld);
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

  const channelWorld = new PenguinChannelWorld({
    channels: options.channels ?? ["ch_ema_minimal_test"],
    pollInterval: options.pollInterval ?? 5000,
    stateFile: options.stateFile,
    channelFetcher: options.channelFetcher,
    channelSender: options.channelSender,
    env,
  });

  registry.register("channel", channelWorld);

  const actorConfig: EmaActorConfig = options.actor ?? {
    id: "actor-ema-minimal",
    name: "Ema Minimal",
    kind: "single-session",
    sessionId: "session-2026-11-05-10-19-24-d6815237",
    agentId: env.PENGUIN_AGENT_ID || "emafanclub_ema_dev",
  };

  const actorRouter = new EmaActorRouter();
  const actorKind = actorConfig.kind || "single-session";
  const defaultSession =
    actorKind === "multiple-agent"
      ? (actorConfig as any).routerSessionId || ""
      : (actorConfig as any).sessionId || (actorConfig as any).session || "session-2026-11-05-10-19-24-d6815237";

  let actor: EmaActor = {
    id: actorConfig.id || "actor-ema-minimal",
    name: actorConfig.name || "Ema Minimal",
    kind: actorKind,
    agentId: actorConfig.agentId || (env.PENGUIN_AGENT_ID || "emafanclub_ema_dev"),
    session: defaultSession,
    ...(actorKind === "multiple-agent"
      ? {
          routerSessionId: (actorConfig as any).routerSessionId,
          routerAgentId: (actorConfig as any).routerAgentId,
          routerInitPrompt: (actorConfig as any).routerInitPrompt,
          isInitialized: (actorConfig as any).isInitialized,
          agents: (actorConfig as any).agents,
        }
      : {
          sessionId: (actorConfig as any).sessionId || defaultSession,
        }),
  } as EmaActor;

  const systemPrompt = options.systemPrompt ?? DEFAULT_MINIMAL_SYSTEM_PROMPT;

  // Sequential turn chain guaranteeing session turns are processed FIFO without overlapping collisions
  let turnChain = Promise.resolve();

  // Subscribe to coalesced input batches
  const batchSubscription = inputBatcher.onBatch((batch) => {
    if (batch.length === 0) return;

    turnChain = turnChain
      .then(async () => {
        // Resolve or lazily provision router session on receiving batch for multiple-agent actor
        if (options.sessionHost) {
          const resolution = await actorRouter.resolveActorSession(actorConfig, options.sessionHost, {
            defaultAgentId: env.PENGUIN_AGENT_ID || "emafanclub_ema_dev",
          });
          actor = resolution.actor;
        }

        const xmlPayload = formatBatchToXml(batch);
        const primary = batch[0];
        const targetChannel = primary.partId;

        let response = "";
        if (options.llmInvoker) {
          response = await options.llmInvoker(xmlPayload, systemPrompt);
        } else if (options.sessionHost) {
          const sessionToUse = actor.session;
          await options.sessionHost.run(sessionToUse, [{ text: xmlPayload }]);
          response = `Dispatched batch to actor session ${sessionToUse}.`;
        } else {
          response = `Acknowledged input batch of ${batch.length} message(s).`;
        }

        const mention =
          primary.sender.name && !primary.sender.name.startsWith("@")
            ? `@${primary.sender.name} `
            : "";
        const formattedReply = `${mention}${response}`.trim();

        channelWorld.interact(ctx, actor, targetChannel, "reply", formattedReply);
      })
      .catch((err) => {
        console.error("[MinimalPrototype] Turn execution error:", err);
      });
  });

  const worldHandle = channelWorld.start(ctx);

  return {
    ctx,
    router,
    inputBatcher,
    world: channelWorld,
    actor,
    dispose: () => {
      batchSubscription.dispose();
      worldHandle.dispose();
      inputBatcher.dispose();
    },
  };
}
