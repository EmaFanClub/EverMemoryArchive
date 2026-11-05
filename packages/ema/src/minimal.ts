/**
 * @prism-shadow/ema - Minimal Variant Specification & Runner
 *
 * Characteristics:
 * 1. Zero Personality: Purely functional, neutral system prompt without persona or emotional tone.
 * 2. Zero Memory: EverMemoryArchive retrieval, indexing, and storage bypassed.
 *    (Harness session transcript accumulates turn continuity for user visibility;
 *    EMA cognitive storage, embeddings, vector search, and consolidation remain fully bypassed).
 * 3. Penguin Channel Input: Watch bridge ingesting messages into the persistent
 *    `ema_minimal` session. Polls the channel, filters for human senders (`user:*`),
 *    and deduplicates message IDs. Rejects `agent:*` and `system` senders to prevent reply loops.
 * 4. Penguin Channel Output: Formats and dispatches completions back to the channel
 *    on behalf of the operating employee agent (the session that runs the runner),
 *    never the server owner.
 *
 * Identity & Channel Dispatch Specification:
 * - Channel output is dispatched on behalf of the operating employee agent
 *   (the session that runs the runner), never the server owner.
 * - Never read or use /home/rei/.penguin/data/api-token for anything user-visible.
 * - The runner must refuse to dispatch without an explicit agent identity (PENGUIN_AGENT_ID).
 */

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
 *
 * Channel output must be dispatched on behalf of the operating employee agent
 * (the session that runs the runner), never the server owner.
 * Never read or use /home/rei/.penguin/data/api-token for anything user-visible.
 *
 * @throws {Error} if PENGUIN_AGENT_ID is unset or blank.
 */
export function assertAgentIdentity(
  env: Record<string, string | undefined> = process.env
): string {
  const agentId = env.PENGUIN_AGENT_ID?.trim();
  if (!agentId) {
    throw new Error(
      "refusing to dispatch without an agent identity; channel send would run as the server owner"
    );
  }
  return agentId;
}

/**
 * Normalizes raw channel JSON messages (from `penguin org channel tail --json`)
 * into standard MinimalChannelMessage instances.
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
 *
 * Rules:
 * 1. Sender must start with "user:" (humans only). Messages from "agent:" and "system"
 *    are rejected to prevent reply loops.
 * 2. Message ID must not be present in `seenIds` (deduplication).
 */
export function isEligibleChannelMessage(
  msg: { id?: string; sender?: string },
  seenIds: Set<string> | string[]
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
  channelId?: string
): MinimalChannelMessage[] {
  const seenSet = seenIds instanceof Set ? seenIds : new Set(seenIds);
  const eligible: MinimalChannelMessage[] = [];
  for (const raw of rawMessages) {
    if (isEligibleChannelMessage(raw, seenSet)) {
      eligible.push(
        normalizeChannelMessage({
          ...raw,
          channelId: channelId || raw.channelId || raw.channel,
        })
      );
    }
  }
  return eligible;
}

/**
 * Parses duration strings (e.g. "4h", "30m", "45s", "1000") into milliseconds.
 * Defaults to 4 hours (14,400,000 ms) if empty or invalid.
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
 * Executes a minimal prototype turn with zero personality, zero memory,
 * penguin channel input, and penguin channel output.
 *
 * Ensures that any channel dispatch path validates the calling agent identity.
 */
export async function executeMinimalTurn(
  message: MinimalChannelMessage,
  options: MinimalTurnOptions = {}
): Promise<MinimalTurnResult> {
  let dispatchedAgentId: string | undefined;

  // Validate agent identity if dispatching to a channel or explicitly required
  if (options.channelDispatcher || options.requireAgentIdentity) {
    dispatchedAgentId = assertAgentIdentity(options.env ?? process.env);
  }

  const systemPrompt = options.systemPrompt ?? DEFAULT_MINIMAL_SYSTEM_PROMPT;
  const prompt = message.text;

  // Invariant assertions: no memory, no personality
  const memoryAccessed = false as const;
  const personalityApplied = false as const;

  // LLM generation (or mock invoker for unit testing)
  let response = "";
  if (options.llmInvoker) {
    response = await options.llmInvoker(prompt, systemPrompt);
  } else {
    // Default placeholder response when no invoker provided
    response = `Received message from ${message.sender}: "${message.text}"`;
  }

  // Format channel output: mention sender if provided
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
