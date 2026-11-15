import type {
  WorkbenchPackage,
  WorkbenchResponse,
  WorkbenchHost,
  WorkbenchRequest,
  WorkbenchRecord,
} from "@prismshadow/penguin-server/plugin";

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface NodeBuiltinAccess {
  process: {
    getBuiltinModule(id: "node:fs"): {
      existsSync(p: string): boolean;
      mkdirSync(p: string, opts?: { recursive?: boolean }): void;
    };
    getBuiltinModule(id: "node:path"): {
      dirname(p: string): string;
    };
    getBuiltinModule(id: "node:sqlite"): {
      DatabaseSync: new (path: string) => SqliteDatabase;
    };
  };
}

const nodeProcess = (globalThis as unknown as NodeBuiltinAccess).process;
const fs = nodeProcess.getBuiltinModule("node:fs");
const path = nodeProcess.getBuiltinModule("node:path");
const { DatabaseSync } = nodeProcess.getBuiltinModule("node:sqlite");

export interface EmaChannelItem {
  id: string;
  channelId: string;
  authorNodeId: string;
  name?: string;
  content: string;
  createdAtIso: string;
  createdAt: string;
  fetchedAtMs: number;
  fetchedAt: string;
  parentItemId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "aoi";
  text: string;
  at: string;
  channelId: string;
  authorNodeId: string;
  parentItemId?: string;
}

export interface ChatState {
  sessionId: string;
  channelId: string;
  status: "idle" | "running" | "failed";
  error: string | null;
  stopped?: boolean;
  lastUserItemId?: string;
  lastUserItemMs?: number;
  messages: ChatMessage[];
  items: EmaChannelItem[];
  updatedAt: string;
}

const WEB_WORLD_DB_PATH =
  "__EMA_WEB_WORLD_DB_PATH__";
const EMA_CLI_PATH = "__EMA_CLI_PATH__";

const DEFAULT_CHANNEL_ID = "web:chatroom:default";
const OWNER_NODE_ID = "web:person:owner";
const BOT_NODE_ID = "web:bot:aoi_rei";

const STOP_CODES: ReadonlySet<unknown> = new Set([
  "user_abort",
  "backoff_interrupted",
  "compaction_interrupted",
]);

const IDLE_CHECK_MS = 50;
const IDLE_CHECKS = 40;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function formatAgentRelativeTime(targetMs: number, referenceMs: number = Date.now()): string {
  const deltaSec = Math.max(0, Math.floor((referenceMs - targetMs) / 1000));
  if (deltaSec < 60) {
    return `just now (${deltaSec} seconds ago)`;
  }
  const minutes = Math.floor(deltaSec / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago (${deltaSec} seconds ago)`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours > 1 ? "s" : ""} ago (${deltaSec} seconds ago)`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago (${deltaSec} seconds ago)`;
}

function withDb<T>(fn: (db: SqliteDatabase) => T): T {
  const dir = path.dirname(WEB_WORLD_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(WEB_WORLD_DB_PATH);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS web_sessions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        client_metadata TEXT,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS web_events (
        id TEXT PRIMARY KEY,
        seq_id INTEGER NOT NULL,
        part_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        modality TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_web_events_part ON web_events(part_id, seq_id);

      CREATE TABLE IF NOT EXISTS seen_social_nodes (
        id TEXT PRIMARY KEY,
        world TEXT NOT NULL,
        node_kind TEXT NOT NULL,
        name TEXT NOT NULL,
        handle TEXT,
        avatar_url TEXT,
        metadata_json TEXT,
        fetched_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS seen_social_channels (
        id TEXT PRIMARY KEY,
        world TEXT NOT NULL,
        channel_kind TEXT NOT NULL,
        owner_node_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        linked_channels_json TEXT,
        metadata_json TEXT,
        fetched_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS seen_social_items (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        author_node_id TEXT NOT NULL,
        name TEXT,
        content TEXT NOT NULL,
        created_at_iso TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        fetched_at_ms INTEGER NOT NULL,
        parent_item_id TEXT,
        url TEXT,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_social_items_channel ON seen_social_items(channel_id, created_at_ms DESC);
    `);

    const nowMs = Date.now();
    const upsertNode = db.prepare(`
      INSERT INTO seen_social_nodes (id, world, node_kind, name, handle, avatar_url, metadata_json, fetched_at_ms)
      VALUES (?, 'web', ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        handle = excluded.handle,
        fetched_at_ms = excluded.fetched_at_ms
    `);
    upsertNode.run(
      OWNER_NODE_ID,
      "person",
      "Rei",
      "owner",
      JSON.stringify({ isOwner: true }),
      nowMs,
    );
    db.prepare(
      "DELETE FROM seen_social_nodes WHERE world = 'web' AND node_kind = 'bot' AND id != ?",
    ).run(BOT_NODE_ID);
    upsertNode.run(
      BOT_NODE_ID,
      "bot",
      "苍星怜",
      "aoi_rei",
      JSON.stringify({ isCompanion: true }),
      nowMs,
    );

    const upsertChannel = db.prepare(`
      INSERT INTO seen_social_channels (id, world, channel_kind, owner_node_id, name, description, linked_channels_json, metadata_json, fetched_at_ms)
      VALUES (?, 'web', 'chatroom', ?, '苍星怜的聊天室', 'Web companion chatroom channel (default)', '[]', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        fetched_at_ms = excluded.fetched_at_ms
    `);
    upsertChannel.run(
      DEFAULT_CHANNEL_ID,
      OWNER_NODE_ID,
      JSON.stringify({ sessionId: "default" }),
      nowMs,
    );

    const countRow = db
      .prepare("SELECT COUNT(*) as cnt FROM seen_social_items WHERE channel_id = ?")
      .get(DEFAULT_CHANNEL_ID) as { cnt?: number } | undefined;

    if (!countRow || Number(countRow.cnt ?? 0) === 0) {
      const initIso = new Date(nowMs).toISOString();
      db.prepare(
        `
        INSERT INTO seen_social_items (
          id, channel_id, author_node_id, name, content, created_at_iso, created_at_ms, fetched_at_ms, parent_item_id, url, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      `,
      ).run(
        `msg_init_${nowMs}`,
        DEFAULT_CHANNEL_ID,
        BOT_NODE_ID,
        "苍星怜",
        "你好呀，我是苍星怜。今天有什么想聊的，随时告诉我吧。",
        initIso,
        nowMs,
        nowMs,
      );
    }

    return fn(db);
  } finally {
    try {
      db.close();
    } catch {}
  }
}

function readChannelSnapshot(
  channelId: string = DEFAULT_CHANNEL_ID,
  referenceMs: number = Date.now(),
): {
  channel: Record<string, unknown>;
  items: EmaChannelItem[];
  messages: ChatMessage[];
} {
  return withDb((db) => {
    const chRow = db.prepare("SELECT * FROM seen_social_channels WHERE id = ?").get(channelId) as
      Record<string, unknown> | undefined;

    const channel = chRow
      ? {
          id: String(chRow.id),
          world: "web",
          channel_kind: String(chRow.channel_kind),
          ownerNodeId: chRow.owner_node_id ? String(chRow.owner_node_id) : OWNER_NODE_ID,
          name: String(chRow.name),
          description: chRow.description ? String(chRow.description) : undefined,
        }
      : {
          id: channelId,
          world: "web",
          channel_kind: "chatroom",
          ownerNodeId: OWNER_NODE_ID,
          name: "苍星怜的聊天室",
        };

    const rows = db
      .prepare(
        "SELECT * FROM seen_social_items WHERE channel_id = ? ORDER BY created_at_ms ASC, rowid ASC",
      )
      .all(channelId) as Array<Record<string, unknown>>;

    const items: EmaChannelItem[] = rows.map((row) => {
      const createdAtMs = Number(row.created_at_ms || referenceMs);
      const fetchedAtMs = Number(row.fetched_at_ms || referenceMs);
      const createdAtIso = String(row.created_at_iso || new Date(createdAtMs).toISOString());
      return {
        id: String(row.id),
        channelId: String(row.channel_id),
        authorNodeId: String(row.author_node_id),
        name: row.name ? String(row.name) : undefined,
        content: String(row.content),
        createdAtIso,
        createdAt: formatAgentRelativeTime(createdAtMs, referenceMs),
        fetchedAtMs,
        fetchedAt: formatAgentRelativeTime(fetchedAtMs, referenceMs),
        parentItemId: row.parent_item_id ? String(row.parent_item_id) : undefined,
      };
    });

    const messages: ChatMessage[] = items.map((item) => ({
      id: item.id,
      role: item.authorNodeId === OWNER_NODE_ID ? "user" : "aoi",
      text: item.content,
      at: item.createdAtIso,
      channelId: item.channelId,
      authorNodeId: item.authorNodeId,
      parentItemId: item.parentItemId,
    }));

    return { channel, items, messages };
  });
}

function appendChannelItem(item: {
  id: string;
  channelId?: string;
  authorNodeId: string;
  name: string;
  content: string;
  createdAtMs?: number;
  parentItemId?: string;
}): EmaChannelItem {
  const channelId = item.channelId || DEFAULT_CHANNEL_ID;
  const createdAtMs = item.createdAtMs ?? Date.now();
  const createdAtIso = new Date(createdAtMs).toISOString();

  withDb((db) => {
    db.prepare(
      `
      INSERT OR REPLACE INTO seen_social_items (
        id, channel_id, author_node_id, name, content, created_at_iso, created_at_ms, fetched_at_ms, parent_item_id, url, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `,
    ).run(
      item.id,
      channelId,
      item.authorNodeId,
      item.name,
      item.content,
      createdAtIso,
      createdAtMs,
      createdAtMs,
      item.parentItemId ?? null,
    );
  });

  return {
    id: item.id,
    channelId,
    authorNodeId: item.authorNodeId,
    name: item.name,
    content: item.content,
    createdAtIso,
    createdAt: formatAgentRelativeTime(createdAtMs, createdAtMs),
    fetchedAtMs: createdAtMs,
    fetchedAt: formatAgentRelativeTime(createdAtMs, createdAtMs),
    parentItemId: item.parentItemId,
  };
}

function resetChannelItems(channelId: string = DEFAULT_CHANNEL_ID): void {
  const nowMs = Date.now();
  const initIso = new Date(nowMs).toISOString();
  withDb((db) => {
    db.prepare("DELETE FROM seen_social_items WHERE channel_id = ?").run(channelId);
    db.prepare(
      `
      INSERT INTO seen_social_items (
        id, channel_id, author_node_id, name, content, created_at_iso, created_at_ms, fetched_at_ms, parent_item_id, url, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
    `,
    ).run(
      `msg_init_${nowMs}`,
      channelId,
      BOT_NODE_ID,
      "苍星怜",
      "你好呀，我是苍星怜。今天有什么想聊的，随时告诉我吧。",
      initIso,
      nowMs,
      nowMs,
    );
  });
}

function hasBotReplySince(minCreatedAtMs: number, channelId: string = DEFAULT_CHANNEL_ID): boolean {
  return withDb((db) => {
    const row = db
      .prepare(
        "SELECT id FROM seen_social_items WHERE channel_id = ? AND author_node_id != ? AND created_at_ms >= ? LIMIT 1",
      )
      .get(channelId, OWNER_NODE_ID, minCreatedAtMs) as { id?: string } | undefined;
    return Boolean(row && row.id);
  });
}

interface PersistedMeta {
  sessionId: string;
  channelId: string;
  status: "idle" | "running" | "failed";
  error: string | null;
  stopped?: boolean;
  lastUserItemId?: string;
  lastUserItemMs?: number;
  updatedAt: string;
}

function normalizeMeta(raw: unknown): PersistedMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;
  if (typeof doc.sessionId !== "string" || !doc.sessionId) return null;
  const nowIso = new Date().toISOString();
  const status = doc.status === "running" || doc.status === "failed" ? doc.status : "idle";
  return {
    sessionId: doc.sessionId,
    channelId:
      typeof doc.channelId === "string" && doc.channelId ? doc.channelId : DEFAULT_CHANNEL_ID,
    status,
    error: typeof doc.error === "string" ? doc.error : null,
    ...(doc.stopped === true ? { stopped: true } : {}),
    ...(typeof doc.lastUserItemId === "string" ? { lastUserItemId: doc.lastUserItemId } : {}),
    ...(typeof doc.lastUserItemMs === "number" ? { lastUserItemMs: doc.lastUserItemMs } : {}),
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : nowIso,
  };
}

function buildChatState(meta: PersistedMeta): ChatState {
  const snapshot = readChannelSnapshot(meta.channelId);
  return {
    sessionId: meta.sessionId,
    channelId: meta.channelId,
    status: meta.status,
    error: meta.error,
    ...(meta.stopped ? { stopped: true } : {}),
    ...(meta.lastUserItemId ? { lastUserItemId: meta.lastUserItemId } : {}),
    ...(meta.lastUserItemMs ? { lastUserItemMs: meta.lastUserItemMs } : {}),
    messages: snapshot.messages,
    items: snapshot.items,
    updatedAt: meta.updatedAt,
  };
}

export default {
  modules: {
    Workbench: {
      create({ use }) {
        const host: WorkbenchHost = use.host;

        let pending: Promise<unknown> = Promise.resolve();
        const locked = <T>(fn: () => Promise<T>): Promise<T> => {
          const result = pending.then(fn);
          pending = result.catch(() => undefined);
          return result;
        };

        const following = new Map<string, () => void>();
        const stopped = new Set<string>();

        const unfollow = (sessionId: string) => {
          following.get(sessionId)?.();
          following.delete(sessionId);
        };

        const isSessionIdle = (sessionId: string): boolean => {
          try {
            return host.sessionStatus(sessionId) === "idle";
          } catch {
            return true;
          }
        };

        const ensureMeta = async (): Promise<PersistedMeta> => {
          // Ensure SQLite DB and default channel exist
          readChannelSnapshot(DEFAULT_CHANNEL_ID);

          const existing = normalizeMeta(host.getState());
          if (existing) return structuredClone(existing);

          const { sessionId } = await host.createSession();
          const nowIso = new Date().toISOString();
          const fresh: PersistedMeta = {
            sessionId,
            channelId: DEFAULT_CHANNEL_ID,
            status: "idle",
            error: null,
            updatedAt: nowIso,
          };
          await host.setState(fresh);
          return structuredClone(fresh);
        };

        const reconcile = async (meta: PersistedMeta): Promise<boolean> => {
          if (meta.status !== "running") return false;
          try {
            const result = await host.sessionResult(meta.sessionId);
            if (result.status === "running") return false;

            const nowMs = Date.now();
            const nowIso = new Date(nowMs).toISOString();
            meta.updatedAt = nowIso;

            if (result.status === "completed") {
              meta.status = "idle";
              meta.error = null;
              delete meta.stopped;

              // Check whether the session already posted its reply to the RFC-0002 channel via message.post
              const minMs = meta.lastUserItemMs ?? 0;
              const alreadyPostedToChannel = hasBotReplySince(minMs, meta.channelId);

              if (!alreadyPostedToChannel) {
                const replyText = (result.text || "").trim();
                if (replyText) {
                  appendChannelItem({
                    id: `web_out_fallback_${nowMs}`,
                    channelId: meta.channelId,
                    authorNodeId: BOT_NODE_ID,
                    name: "苍星怜",
                    content: replyText,
                    createdAtMs: nowMs,
                    parentItemId: meta.lastUserItemId,
                  });
                }
              }
            } else {
              if (stopped.has(meta.sessionId)) {
                meta.status = "idle";
                meta.stopped = true;
                meta.error = null;
              } else {
                meta.status = "failed";
                meta.error = result.error || "回复生成失败，请稍后重试。";
              }
            }
          } catch (e) {
            meta.status = "failed";
            meta.error = e instanceof Error ? e.message : String(e);
            meta.updatedAt = new Date().toISOString();
          }

          stopped.delete(meta.sessionId);
          unfollow(meta.sessionId);
          return true;
        };

        const settle = async (sessionId: string) => {
          for (let i = 0; i < IDLE_CHECKS && !isSessionIdle(sessionId); i++) {
            await sleep(IDLE_CHECK_MS);
          }
          await locked(async () => {
            const meta = normalizeMeta(host.getState());
            if (!meta || meta.sessionId !== sessionId || meta.status !== "running") {
              unfollow(sessionId);
              return;
            }
            if (await reconcile(meta)) {
              await host.setState(meta);
            }
          });
        };

        const follow = (sessionId: string) => {
          if (following.has(sessionId)) return;
          try {
            const stop = host.subscribe(sessionId, (record: WorkbenchRecord) => {
              if (record.origin?.length) return;
              const p = record.payload || {};
              if (p.type === "abort" && STOP_CODES.has(p.error_code)) {
                stopped.add(sessionId);
              }
              if (p.type !== "task_end") return;
              settle(sessionId).catch((err) =>
                host.log(`Failed to settle session ${sessionId}: ${String(err)}`),
              );
            });
            following.set(sessionId, stop);
          } catch {
            // Session outside project or unavailable; GET /chat will reconcile
          }
        };

        // Re-subscribe if workbench reloaded while a turn was running
        const initial = normalizeMeta(host.getState());
        if (initial && initial.status === "running") {
          follow(initial.sessionId);
        }

        return {
          api: {
            main: {
              async handle(req: WorkbenchRequest): Promise<WorkbenchResponse> {
                return locked(async () => {
                  const meta = await ensureMeta();

                  // 1. GET /chat (or /status, /): Return current chat state backed by RFC-0002 channel items
                  if (
                    req.method === "GET" &&
                    (req.path === "/chat" ||
                      req.path === "/status" ||
                      req.path === "" ||
                      req.path === "/")
                  ) {
                    if (meta.status === "running") {
                      if (await reconcile(meta)) {
                        await host.setState(meta);
                      } else {
                        follow(meta.sessionId);
                      }
                    }
                    return { body: buildChatState(meta) };
                  }

                  // 2. RFC-0002 GET /channels & GET /channels/:id & GET /channels/:id/items
                  if (req.method === "GET" && req.path === "/channels") {
                    const snap = readChannelSnapshot(DEFAULT_CHANNEL_ID);
                    return { body: { channels: [snap.channel] } };
                  }

                  if (req.method === "GET" && req.path === `/channels/${DEFAULT_CHANNEL_ID}`) {
                    const snap = readChannelSnapshot(DEFAULT_CHANNEL_ID);
                    return { body: snap.channel };
                  }

                  if (
                    req.method === "GET" &&
                    (req.path === `/channels/${DEFAULT_CHANNEL_ID}/items` ||
                      req.path === "/channels/items")
                  ) {
                    const nowMs = Date.now();
                    const snap = readChannelSnapshot(DEFAULT_CHANNEL_ID, nowMs);
                    return {
                      body: {
                        context: {
                          time: new Date(nowMs).toISOString(),
                          timestampMs: nowMs,
                          timezone: "UTC",
                        },
                        channel: snap.channel,
                        items: snap.items,
                      },
                    };
                  }

                  // 3. RFC-0002 GET /actions & POST /actions/message.post
                  if (req.method === "GET" && req.path === "/actions") {
                    return {
                      body: {
                        actions: [
                          {
                            name: "message.post",
                            description: "Posts a message to the Web chatroom channel",
                            parameters: {
                              channelId: {
                                type: "string",
                                required: false,
                                default: DEFAULT_CHANNEL_ID,
                                description: "Target chatroom channel ID",
                              },
                              message: {
                                type: "string",
                                required: true,
                                description: "Message text content to post to the channel",
                              },
                              parentItemId: {
                                type: "string",
                                required: false,
                                description: "Optional message ID being replied to",
                              },
                            },
                          },
                        ],
                      },
                    };
                  }

                  if (req.method === "POST" && req.path === "/actions/message.post") {
                    const body = (req.body || {}) as {
                      channelId?: unknown;
                      message?: unknown;
                      text?: unknown;
                      parentItemId?: unknown;
                    };
                    const msgText =
                      typeof body.message === "string"
                        ? body.message.trim()
                        : typeof body.text === "string"
                          ? body.text.trim()
                          : "";
                    if (!msgText) {
                      return {
                        status: 400,
                        body: { error: "Missing required parameter 'message'" },
                      };
                    }
                    const nowMs = Date.now();
                    const item = appendChannelItem({
                      id: `web_out_${nowMs}`,
                      channelId: DEFAULT_CHANNEL_ID,
                      authorNodeId: BOT_NODE_ID,
                      name: "苍星怜",
                      content: msgText,
                      createdAtMs: nowMs,
                      parentItemId:
                        typeof body.parentItemId === "string" ? body.parentItemId : undefined,
                    });
                    return {
                      body: {
                        success: true,
                        action: "message.post",
                        channelId: DEFAULT_CHANNEL_ID,
                        message: msgText,
                        item,
                      },
                    };
                  }

                  // 4. POST /chat (or POST /channels/web:chatroom:default/items):
                  //    Post user message into RFC-0002 chatroom channel & trigger session to read channel and post reply
                  if (
                    req.method === "POST" &&
                    (req.path === "/chat" || req.path === `/channels/${DEFAULT_CHANNEL_ID}/items`)
                  ) {
                    const body = (req.body || {}) as {
                      text?: unknown;
                      content?: unknown;
                      message?: unknown;
                    };
                    const rawText =
                      typeof body.text === "string"
                        ? body.text
                        : typeof body.content === "string"
                          ? body.content
                          : typeof body.message === "string"
                            ? body.message
                            : "";
                    const text = rawText.trim();

                    if (!text) {
                      return { status: 400, body: { error: "消息内容不能为空。" } };
                    }
                    if (text.length > 20000) {
                      return { status: 400, body: { error: "单条消息请控制在 20,000 字以内。" } };
                    }

                    if (meta.status === "running") {
                      await reconcile(meta);
                    }

                    const nowMs = Date.now();
                    const nowIso = new Date(nowMs).toISOString();
                    const msgId = `msg_${nowMs}`;

                    // Index user message into RFC-0002 chatroom channel (`seen_social_items`)
                    appendChannelItem({
                      id: msgId,
                      channelId: DEFAULT_CHANNEL_ID,
                      authorNodeId: OWNER_NODE_ID,
                      name: "Rei",
                      content: text,
                      createdAtMs: nowMs,
                    });

                    meta.status = "running";
                    meta.error = null;
                    meta.lastUserItemId = msgId;
                    meta.lastUserItemMs = nowMs;
                    delete meta.stopped;
                    stopped.delete(meta.sessionId);
                    meta.updatedAt = nowIso;

                    await host.setState(meta);

                    // Subscribe before host.run so no fast turn is missed
                    follow(meta.sessionId);

                    // Notify session of new channel activity per RFC-0001 / RFC-0002
                    // Session must read the channel and post its reply back to the channel
                    const channelEventPrompt =
                      `<Input>\n` +
                      `  <World>web</World>\n` +
                      `  <Channel>${DEFAULT_CHANNEL_ID}</Channel>\n` +
                      `  <Event type="channel_item_created" itemId="${msgId}" authorNodeId="${OWNER_NODE_ID}" timestamp="${nowMs}" />\n` +
                      `</Input>\n\n` +
                      `[RFC-0002 Channel Event]: 聊天室频道 \`${DEFAULT_CHANNEL_ID}\` 收到了一条新消息（ID: \`${msgId}\`）。\n` +
                      `请按 RFC-0002 协议依次执行：\n` +
                      `1. 读取频道消息：\n` +
                      `   \`node ${EMA_CLI_PATH} world get /world/web/channels/${DEFAULT_CHANNEL_ID}/items\`\n` +
                      `2. 潜变量 <OS> 推演与原著《chapters.toml》语感对齐（在思考中完成）：\n` +
                      `   对照 AGENTS.md 第 7 节的原著真句锚点，严格遵守原著语感三铁律：① 零括号动作旁白（严禁在开头或句中加「（微微仰起头…）」等舞台动作圆括号，必须把所有动作与触感如「来，把头稍微低下一点点靠在我尾巴上好不好」「摸摸头，不累了哦」100% 融进第一人称口语台词自然说出）；② 一逗到底与隔轮颜文字呼吸感（用 3～5 个逗号「，」连成一气呵成的温柔长句，整段话只用 1 个句号「。」收尾；仅在初遇或被摸头撒娇时点缀 1 个颜文字，若你上一条历史回复已带颜文字，本轮必须 100% 不带颜文字）；③ 单轮单意象跨轮流转（自然流露自称「鱼鱼」、把代码 Bug 唤作「那只坏虫子/小虫子」，但每轮只选 1 个核心意象——若上一条回复已提过「铁饭盆/粥」或「尾巴」，本轮严禁重复提及铁饭盆或尾巴，切换为「摸摸头/抓坏虫子/记忆贝壳」等原著细节）。\n` +
                      `3. 发送回复到频道：\n` +
                      `   \`node ${EMA_CLI_PATH} world post /world/web/actions/message.post --channel ${DEFAULT_CHANNEL_ID} --parent ${msgId} --message "<你的回复>"\`\n` +
                      `4. 发送成功后，直接输出你刚才发送的那句回复内容结束回合。`;

                    try {
                      await host.run(meta.sessionId, [{ text: channelEventPrompt }]);
                    } catch (err) {
                      unfollow(meta.sessionId);
                      meta.status = "failed";
                      meta.error = err instanceof Error ? err.message : String(err);
                      meta.updatedAt = new Date().toISOString();
                      await host.setState(meta);
                      return {
                        status: 500,
                        body: { error: meta.error, state: buildChatState(meta) },
                      };
                    }

                    return { body: buildChatState(meta) };
                  }

                  // 5. POST /reset: Clear chatroom channel items and start a fresh session
                  if (req.method === "POST" && req.path === "/reset") {
                    unfollow(meta.sessionId);
                    stopped.delete(meta.sessionId);

                    resetChannelItems(DEFAULT_CHANNEL_ID);

                    const { sessionId } = await host.createSession();
                    const nowIso = new Date().toISOString();
                    const fresh: PersistedMeta = {
                      sessionId,
                      channelId: DEFAULT_CHANNEL_ID,
                      status: "idle",
                      error: null,
                      updatedAt: nowIso,
                    };
                    await host.setState(fresh);
                    return { body: buildChatState(fresh) };
                  }

                  return { status: 404, body: { error: `No such route: ${req.path}` } };
                });
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
