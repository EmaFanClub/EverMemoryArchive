/**
 * @prism-shadow/ema - Minimal Variant Specification & Runner
 *
 * Characteristics:
 * 1. Zero Personality: Purely functional, neutral system prompt.
 * 2. Zero Memory: EverMemoryArchive retrieval, indexing, and storage bypassed.
 * 3. Penguin Channel Input: Ingests normalized channel events / messages.
 * 4. Penguin Channel Output: Formats and dispatches completions back to the channel.
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
}

export const DEFAULT_MINIMAL_SYSTEM_PROMPT =
  "You are a minimal assistant prototype. Answer directly, factually, and concisely. " +
  "Do not adopt a persona or emotional tone. EverMemoryArchive memory storage and retrieval are disabled.";

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
 * Executes a minimal prototype turn with zero personality, zero memory,
 * penguin channel input, and penguin channel output.
 */
export async function executeMinimalTurn(
  message: MinimalChannelMessage,
  options: MinimalTurnOptions = {}
): Promise<MinimalTurnResult> {
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
  };
}
