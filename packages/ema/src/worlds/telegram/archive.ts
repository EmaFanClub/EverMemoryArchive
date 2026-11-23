/**
 * @prism-shadow/ema - Public Telegram Channel Archiver & BotIndex Merger
 *
 * Crawls Telegram's public web preview (`https://t.me/s/<channel>` and `?before=<id>`),
 * enriches messages with optional `published.jsonl` ledger metadata,
 * persists archive JSONL, and merges deduplicated entries into `BotIndex/Telegram`.
 */

import fs from "node:fs";
import path from "node:path";
import type { TelegramBotIndexEntry } from "./types.js";
import { toShanghaiTimeParts } from "./ops-log.js";
import { TelegramBotIndexStore } from "./bot-index.js";

export interface TelegramChannelConfigMeta {
  chatId: number | string;
  title: string;
  alias: string;
}

export interface TelegramArchivedWebMessage {
  msg_id: number;
  channel: string;
  date?: string;
  text: string;
  photos?: string[];
  views?: string;
  reply_to_msg_id?: number;
  artwork_id?: number;
  title?: string;
  author?: string;
  author_id?: number;
  tags?: string[];
  page_count?: number;
  r18?: boolean;
}

export interface PublishedLedgerEntry {
  msg_id: number;
  artwork_id?: number;
  title?: string;
  author?: string;
  author_id?: number;
  tags?: string[];
  page_count?: number;
  r18?: boolean;
}

const VALID_TELEGRAM_CHANNEL_USERNAME_RE = /^[a-zA-Z0-9_]{3,64}$/;

export function normalizeAndValidateChannelUsername(rawChannel: string): string {
  const cleanChannel = String(rawChannel || "")
    .replace(/^@/, "")
    .trim();
  if (!VALID_TELEGRAM_CHANNEL_USERNAME_RE.test(cleanChannel)) {
    throw new Error(
      `[TelegramArchive] Invalid Telegram public channel username '${rawChannel}': expected 3-64 alphanumeric/underscore characters`,
    );
  }
  return cleanChannel;
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : _m;
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : _m;
    });
}

function stripHtmlTagsWithNewlines(htmlFragment: string): string {
  const withLineBreaks = htmlFragment.replace(/<br\s*\/?>/gi, "\n");
  const withoutTags = withLineBreaks.replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(withoutTags).trim();
}

/**
 * Parses a Telegram `https://t.me/s/<channel>` HTML page into structured message objects.
 */
export function parseTelegramWebPreviewHtml(
  html: string,
  channelUsername: string,
): TelegramArchivedWebMessage[] {
  const cleanChannel = normalizeAndValidateChannelUsername(channelUsername);
  const blocks = String(html || "").split('<div class="tgme_widget_message_wrap');
  const messages: TelegramArchivedWebMessage[] = [];
  const escapedChannel = cleanChannel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const postRe = new RegExp(`data-post="${escapedChannel}\\/(\\d+)"`, "i");
  const replyRe = new RegExp(
    `class="tgme_widget_message_reply"[\\s\\S]*?href="[^"]*\\/${escapedChannel}\\/(\\d+)"`,
    "i",
  );

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const postMatch = postRe.exec(block);
    if (!postMatch) continue;

    const msgId = parseInt(postMatch[1], 10);
    if (!Number.isInteger(msgId) || msgId <= 0) continue;

    const timeMatch = /<time[^>]*datetime="([^"]+)"/.exec(block);
    const dateIso = timeMatch ? timeMatch[1] : undefined;

    // Extract message text div
    let text = "";
    const textStartMatch = /<div class="tgme_widget_message_text[^"]*"[^>]*>/.exec(block);
    if (textStartMatch && textStartMatch.index !== undefined) {
      const contentStart = textStartMatch.index + textStartMatch[0].length;
      // Walk nested <div>...</div> to find matching closing </div>
      let depth = 1;
      let pos = contentStart;
      const divTagRe = /<\/?div\b[^>]*>/gi;
      divTagRe.lastIndex = contentStart;
      let tagMatch: RegExpExecArray | null;
      while ((tagMatch = divTagRe.exec(block)) !== null) {
        if (tagMatch[0].startsWith("</")) {
          depth--;
          if (depth === 0) {
            pos = tagMatch.index;
            break;
          }
        } else {
          depth++;
        }
      }
      text = stripHtmlTagsWithNewlines(block.slice(contentStart, pos));
    }

    // Extract photo background URLs
    const photos: string[] = [];
    const photoRe =
      /tgme_widget_message_photo_wrap[\s\S]*?background-image:url\('([^']+)'\)/gi;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = photoRe.exec(block)) !== null) {
      photos.push(pMatch[1]);
    }

    // Extract views
    const viewsMatch = /<span class="tgme_widget_message_views">([^<]+)<\/span>/i.exec(block);
    const views = viewsMatch ? viewsMatch[1].trim() : undefined;

    // Extract reply_to_msg_id
    const replyMatch = replyRe.exec(block);
    const replyToMsgId = replyMatch ? parseInt(replyMatch[1], 10) : undefined;

    messages.push({
      msg_id: msgId,
      channel: cleanChannel,
      ...(dateIso ? { date: dateIso } : {}),
      text,
      ...(photos.length > 0 ? { photos } : {}),
      ...(views ? { views } : {}),
      ...(replyToMsgId ? { reply_to_msg_id: replyToMsgId } : {}),
    });
  }

  return messages;
}

/**
 * Loads a `published.jsonl` ledger and indexes entries by `msg_id`.
 */
export function loadPublishedLedgerByMsgId(
  ledgerPath?: string,
): Map<number, PublishedLedgerEntry> {
  const byMsgId = new Map<number, PublishedLedgerEntry>();
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return byMsgId;

  const lines = fs.readFileSync(ledgerPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as Record<string, unknown>;
      const msgIds = Array.isArray(rec.message_ids) ? rec.message_ids : [];
      if (msgIds.length > 0 && typeof msgIds[0] === "number") {
        byMsgId.set(msgIds[0], {
          msg_id: msgIds[0],
          artwork_id: typeof rec.artwork_id === "number" ? rec.artwork_id : undefined,
          title: typeof rec.title === "string" ? rec.title : undefined,
          author: typeof rec.author === "string" ? rec.author : undefined,
          author_id: typeof rec.author_id === "number" ? rec.author_id : undefined,
          tags: Array.isArray(rec.tags) ? (rec.tags as string[]) : undefined,
          page_count: typeof rec.page_count === "number" ? rec.page_count : undefined,
          r18: typeof rec.r18 === "boolean" ? rec.r18 : undefined,
        });
      }
    } catch {
      // Skip invalid JSON line
    }
  }
  return byMsgId;
}

/**
 * Merges archived channel messages into `TelegramBotIndexStore` with deduplication by `msg_id`.
 */
export function mergeChannelArchiveToBotIndex(params: {
  channel: string;
  messages: TelegramArchivedWebMessage[];
  botIndexStore: TelegramBotIndexStore;
  chatId?: number | string;
  chatTitle?: string;
  alias?: string;
  channelMeta?: Record<string, TelegramChannelConfigMeta>;
}): { addedCount: number; totalCount: number; alias: string } {
  const cleanChannel = normalizeAndValidateChannelUsername(params.channel);
  const known = params.channelMeta?.[cleanChannel];
  const chatId = params.chatId ?? known?.chatId ?? `@${cleanChannel}`;
  const chatTitle = params.chatTitle ?? known?.title ?? cleanChannel;
  const alias = params.alias ?? known?.alias ?? cleanChannel;

  const channelDir = path.join(params.botIndexStore.telegramRoot, alias);

  // Collect existing msg_ids across all daily files to prevent duplicates
  const existingMsgIds = new Set<number>();
  if (fs.existsSync(channelDir)) {
    for (const yearEntry of fs.readdirSync(channelDir, { withFileTypes: true })) {
      if (!yearEntry.isDirectory() || !/^\d{4}$/.test(yearEntry.name)) continue;
      const yearPath = path.join(channelDir, yearEntry.name);
      for (const file of fs.readdirSync(yearPath)) {
        if (!file.endsWith(".jsonl")) continue;
        const lines = fs.readFileSync(path.join(yearPath, file), "utf8").split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as { msg_id?: number };
            if (typeof parsed.msg_id === "number") {
              existingMsgIds.add(parsed.msg_id);
            }
          } catch {
            // Ignore malformed line
          }
        }
      }
    }
  }

  const sorted = [...params.messages].sort((a, b) => a.msg_id - b.msg_id);
  let addedCount = 0;

  for (const msg of sorted) {
    if (existingMsgIds.has(msg.msg_id)) continue;

    let tsMs = Date.now();
    if (msg.date) {
      const parsedMs = Date.parse(msg.date);
      if (Number.isFinite(parsedMs)) tsMs = parsedMs;
    }
    const { iso } = toShanghaiTimeParts(tsMs);

    const entry: TelegramBotIndexEntry = {
      v: 1,
      ts: iso,
      msg_id: msg.msg_id,
      chat_id: chatId,
      chat_title: chatTitle,
      chat_type: "channel",
      dir: "out",
      from_username: cleanChannel,
      from_name: chatTitle,
      text: msg.text || "",
      ...(msg.photos && msg.photos.length > 0 ? { media: "photo" } : {}),
      ...(msg.views ? { views: msg.views } : {}),
      ...(msg.reply_to_msg_id ? { reply_to_msg_id: msg.reply_to_msg_id } : {}),
      ...(msg.artwork_id !== undefined ? { artwork_id: msg.artwork_id } : {}),
      ...(msg.title ? { artwork_title: msg.title } : {}),
      ...(msg.author ? { author: msg.author } : {}),
      ...(msg.author_id !== undefined ? { author_id: msg.author_id } : {}),
      ...(msg.tags ? { tags: msg.tags } : {}),
      ...(msg.page_count !== undefined ? { page_count: msg.page_count } : {}),
      ...(msg.r18 !== undefined ? { r18: msg.r18 } : {}),
    };

    params.botIndexStore.appendEntry(entry, alias);
    existingMsgIds.add(msg.msg_id);
    addedCount++;
  }

  return {
    addedCount,
    totalCount: existingMsgIds.size,
    alias,
  };
}

export interface CrawlTelegramChannelOptions {
  channel: string;
  maxPages?: number;
  stopAtMsgId?: number;
  ledgerPath?: string;
  archiveOutDir?: string;
  botIndexStore?: TelegramBotIndexStore;
  chatId?: number | string;
  chatTitle?: string;
  alias?: string;
  channelMeta?: Record<string, TelegramChannelConfigMeta>;
  fetchImpl?: typeof fetch;
}

/**
 * Crawls a public Telegram channel's web preview (`https://t.me/s/<channel>`),
 * enriches with optional `published.jsonl` ledger, saves archive files if `archiveOutDir`
 * is provided, and merges into `botIndexStore` if provided.
 */
export async function crawlTelegramPublicChannel(
  options: CrawlTelegramChannelOptions,
): Promise<{
  channel: string;
  fetchedCount: number;
  mergedCount: number;
  minMsgId: number;
  maxMsgId: number;
  messages: TelegramArchivedWebMessage[];
}> {
  const cleanChannel = normalizeAndValidateChannelUsername(options.channel);
  const maxPagesRaw = options.maxPages ?? 10;
  if (!Number.isInteger(maxPagesRaw) || maxPagesRaw < 1 || maxPagesRaw > 50) {
    throw new Error(`[TelegramArchive] Invalid maxPages '${maxPagesRaw}': must be an integer 1..50`);
  }
  const maxPages = maxPagesRaw;
  const fetchFn = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const ledgerByMsgId = loadPublishedLedgerByMsgId(options.ledgerPath);

  const byId = new Map<number, TelegramArchivedWebMessage>();
  let beforeId: number | undefined;

  for (let page = 0; page < maxPages; page++) {
    const url =
      beforeId !== undefined
        ? `https://t.me/s/${cleanChannel}?before=${beforeId}`
        : `https://t.me/s/${cleanChannel}`;
    const res = await fetchFn(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
    }
    const html = await res.text();
    const parsed = parseTelegramWebPreviewHtml(html, cleanChannel);
    if (parsed.length === 0) break;

    for (const msg of parsed) {
      const ledger = ledgerByMsgId.get(msg.msg_id);
      if (ledger) {
        if (ledger.artwork_id !== undefined) msg.artwork_id = ledger.artwork_id;
        if (ledger.title) msg.title = ledger.title;
        if (ledger.author) msg.author = ledger.author;
        if (ledger.author_id !== undefined) msg.author_id = ledger.author_id;
        if (ledger.tags) msg.tags = ledger.tags;
        if (ledger.page_count !== undefined) msg.page_count = ledger.page_count;
        if (ledger.r18 !== undefined) msg.r18 = ledger.r18;
      }
      byId.set(msg.msg_id, msg);
    }

    const minIdInBatch = Math.min(...parsed.map((m) => m.msg_id));
    if (
      minIdInBatch <= 1 ||
      (options.stopAtMsgId !== undefined && minIdInBatch <= options.stopAtMsgId)
    ) {
      break;
    }
    beforeId = minIdInBatch;
  }

  const messages = Array.from(byId.values()).sort((a, b) => a.msg_id - b.msg_id);
  const minMsgId = messages.length > 0 ? messages[0].msg_id : 0;
  const maxMsgId = messages.length > 0 ? messages[messages.length - 1].msg_id : 0;

  if (options.archiveOutDir) {
    const outDir = path.join(path.resolve(options.archiveOutDir), cleanChannel);
    fs.mkdirSync(outDir, { recursive: true });
    const msgPath = path.join(outDir, "messages.jsonl");
    const lines = messages.map((m) => JSON.stringify(m)).join("\n") + (messages.length ? "\n" : "");
    fs.writeFileSync(msgPath, lines, "utf8");
    fs.writeFileSync(
      path.join(outDir, "state.json"),
      JSON.stringify(
        {
          channel: cleanChannel,
          last_msg_id: maxMsgId,
          total_messages: messages.length,
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  let mergedCount = 0;
  if (options.botIndexStore) {
    const mergeRes = mergeChannelArchiveToBotIndex({
      channel: cleanChannel,
      messages,
      botIndexStore: options.botIndexStore,
      chatId: options.chatId,
      chatTitle: options.chatTitle,
      alias: options.alias,
      channelMeta: options.channelMeta,
    });
    mergedCount = mergeRes.addedCount;
  }

  return {
    channel: cleanChannel,
    fetchedCount: messages.length,
    mergedCount,
    minMsgId,
    maxMsgId,
    messages,
  };
}
