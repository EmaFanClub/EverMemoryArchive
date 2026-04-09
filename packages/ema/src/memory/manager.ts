import type {
  ActorMemory,
  BufferMessage,
  BufferStorage,
  BufferWriteMessage,
  LongTermMemory,
  LongTermMemoryRecord,
  ShortTermMemory,
  ShortTermMemoryRecord,
} from "./base";
import type {
  ActorDB,
  ConversationDB,
  ConversationMessageDB,
  ExternalIdentityBindingDB,
  LongTermMemoryDB,
  LongTermMemorySearcher,
  PersonalityDB,
  RoleDB,
  ShortTermMemoryDB,
  UserDB,
  UserOwnActorDB,
  ListShortTermMemoriesRequest,
} from "../db";
import { Logger } from "../logger";
import { runActorActivityTickJob } from "../scheduler/jobs/actor.job";
import { loadPromptTemplate } from "../prompt/loader";
import { formatStickerDisplayText } from "../skills/sticker-skill/pack";
import { stickerIdToInlineData } from "../skills/sticker-skill/utils";
import { buildPromptFromBufferMessage, isActorChatInput } from "./utils";
import { parseReplyRef, resolveSession } from "../channel";
import type { Server } from "../server";
import type { InlineDataItem } from "../schema";
import { formatTimestamp, parseTimestamp } from "../utils";
import { skillsPrompt } from "../skills";

/**
 * Memory manager implementation backed by database interfaces.
 */
export class MemoryManager implements BufferStorage, ActorMemory {
  /** Number of buffer messages injected into chat prompts. */
  readonly bufferWindowSize = 30;
  /** Number of resumed messages required before triggering an activity update. */
  readonly diaryUpdateEvery = 20;
  /** Number of unprocessed day entries injected into chat prompts. */
  readonly dayWindowSize = 2;
  /** Number of unprocessed month entries injected into chat prompts. */
  readonly monthWindowSize = 2;
  /** Number of unprocessed activity entries injected into chat prompts. */
  readonly activityWindowSize = 100;
  private readonly logger: Logger = Logger.create({
    name: "MemoryManager",
    level: "debug",
    transport: "console",
  });

  /**
   * Creates a new MemoryManager instance.
   * @param roleDB - Role persistence interface.
   * @param personalityDB - Personality persistence interface.
   * @param actorDB - Actor persistence interface.
   * @param userDB - User persistence interface.
   * @param userOwnActorDB - User-actor relation persistence interface.
   * @param externalIdentityBindingDB - External identity binding persistence interface.
   * @param conversationDB - Conversation persistence interface.
   * @param conversationMessageDB - Conversation message persistence interface.
   * @param shortTermMemoryDB - Short-term memory persistence interface.
   * @param longTermMemoryDB - Long-term memory persistence interface.
   * @param longTermMemorySearcher - Long-term memory search interface.
   * @param server - Optional server runtime used for direct activity-tick execution.
   */
  constructor(
    private readonly roleDB: RoleDB,
    private readonly personalityDB: PersonalityDB,
    private readonly actorDB: ActorDB,
    private readonly userDB: UserDB,
    private readonly userOwnActorDB: UserOwnActorDB,
    private readonly externalIdentityBindingDB: ExternalIdentityBindingDB,
    private readonly conversationDB: ConversationDB,
    private readonly conversationMessageDB: ConversationMessageDB,
    private readonly shortTermMemoryDB: ShortTermMemoryDB,
    private readonly longTermMemoryDB: LongTermMemoryDB,
    private readonly longTermMemorySearcher: LongTermMemorySearcher,
    private readonly server?: Server,
  ) {}

  private async getBasePromptValues(actorId: number): Promise<{
    rolePrompt: string;
    personalityMemory: string;
  }> {
    const [actor, personality] = await Promise.all([
      this.actorDB.getActor(actorId),
      this.personalityDB.getPersonality(actorId),
    ]);
    const role = actor?.roleId ? await this.roleDB.getRole(actor.roleId) : null;
    return {
      rolePrompt: role?.prompt ?? "None.",
      personalityMemory: personality?.memory ?? "None.",
    };
  }

  private async getConversationMemoryPromptValues(
    actorId: number,
    conversationId: number,
  ): Promise<{
    conversationDescription: string;
    bufferText: string;
    yearMemory: string;
    monthMemory: string;
    dayMemory: string;
    activityMemory: string;
    sessionType: "chat" | "group";
  }> {
    const [
      conversation,
      yearMemory,
      monthMemory,
      dayMemory,
      activityMemory,
      buffer,
    ] = await Promise.all([
      this.conversationDB.getConversation(conversationId),
      this.buildYearMemoryPrompt(actorId),
      this.buildMonthMemoryPrompt(actorId),
      this.buildDayMemoryPrompt(actorId),
      this.buildActivityMemoryPrompt(actorId),
      this.getBuffer(conversationId, this.bufferWindowSize),
    ]);
    if (!conversation) {
      throw new Error(`Conversation with ID ${conversationId} not found.`);
    }
    const sessionInfo = resolveSession(conversation.session);
    if (!sessionInfo) {
      throw new Error(`Invalid session on conversation ${conversationId}.`);
    }
    const ownerUid = await this.getOwnerUid(actorId, sessionInfo.channel);
    return {
      conversationDescription: conversation.description ?? "None.",
      bufferText:
        buffer.length === 0
          ? "None."
          : buffer
              .map((item) => buildPromptFromBufferMessage(item, ownerUid))
              .join("\n"),
      yearMemory,
      monthMemory,
      dayMemory,
      activityMemory,
      sessionType: sessionInfo.type,
    };
  }

  private async getDetachedMemoryPromptValues(actorId: number): Promise<{
    conversationDescription: string;
    bufferText: string;
    yearMemory: string;
    monthMemory: string;
    dayMemory: string;
    activityMemory: string;
  }> {
    const [yearMemory, monthMemory, dayMemory, activityMemory] =
      await Promise.all([
        this.buildYearMemoryPrompt(actorId),
        this.buildMonthMemoryPrompt(actorId),
        this.buildDayMemoryPrompt(actorId),
        this.buildActivityMemoryPrompt(actorId),
      ]);
    return {
      conversationDescription: "None.",
      bufferText: "None.",
      yearMemory,
      monthMemory,
      dayMemory,
      activityMemory,
    };
  }

  private async getActorIdByConversation(
    conversationId: number,
  ): Promise<number> {
    const conversation =
      await this.conversationDB.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation with ID ${conversationId} not found.`);
    }
    return conversation.actorId;
  }

  /**
   * Builds the chat system prompt for normal conversations.
   * @param actorId - The actor identifier to read.
   * @param conversationId - Conversation identifier used for memory and recent history.
   * @returns The fully injected system prompt.
   */
  async buildSystemPromptForChat(
    actorId: number,
    conversationId: number,
  ): Promise<string> {
    const template = await loadPromptTemplate(
      "preamble.md",
      "system.md",
      "world.md",
      "you.md",
      "interaction-guidelines.md",
      "memory.md",
    );
    const [{ rolePrompt, personalityMemory }, memoryValues] = await Promise.all(
      [
        this.getBasePromptValues(actorId),
        this.getConversationMemoryPromptValues(actorId, conversationId),
      ],
    );
    const chatWorkflow = await loadPromptTemplate(
      memoryValues.sessionType === "group"
        ? "chat-workflow-group.md"
        : "chat-workflow-chat.md",
    );
    return template
      .replaceAll("{SKILLS_METADATA}", skillsPrompt)
      .replaceAll("{ROLE_PROMPT}", rolePrompt)
      .replaceAll("{PERSONALITY_MEMORY}", personalityMemory)
      .replaceAll("{CHAT_WORKFLOW}", chatWorkflow)
      .replaceAll(
        "{CONVERSATION_DESCRIPTION}",
        memoryValues.conversationDescription,
      )
      .replaceAll("{MEMORY_YEAR}", memoryValues.yearMemory)
      .replaceAll("{MEMORY_MONTH}", memoryValues.monthMemory)
      .replaceAll("{MEMORY_DAY}", memoryValues.dayMemory)
      .replaceAll("{MEMORY_ACTIVITY}", memoryValues.activityMemory)
      .replaceAll("{MEMORY_BUFFER}", memoryValues.bufferText);
  }

  /**
   * Builds the system prompt for activity updates. This includes memory and
   * recent conversation, but excludes interaction guidelines.
   * @param actorId - The actor identifier to read.
   * @param conversationId - Conversation identifier used for memory and recent history.
   * @returns The injected system prompt.
   */
  async buildSystemPromptForActivityUpdate(
    actorId: number,
    conversationId: number,
  ): Promise<string> {
    const template = await loadPromptTemplate(
      "preamble.md",
      "system.md",
      "world.md",
      "you.md",
      "memory.md",
    );
    const [{ rolePrompt, personalityMemory }, memoryValues] = await Promise.all(
      [
        this.getBasePromptValues(actorId),
        this.getConversationMemoryPromptValues(actorId, conversationId),
      ],
    );
    return template
      .replaceAll("{SKILLS_METADATA}", skillsPrompt)
      .replaceAll("{ROLE_PROMPT}", rolePrompt)
      .replaceAll("{PERSONALITY_MEMORY}", personalityMemory)
      .replaceAll(
        "{CONVERSATION_DESCRIPTION}",
        memoryValues.conversationDescription,
      )
      .replaceAll("{MEMORY_YEAR}", memoryValues.yearMemory)
      .replaceAll("{MEMORY_MONTH}", memoryValues.monthMemory)
      .replaceAll("{MEMORY_DAY}", memoryValues.dayMemory)
      .replaceAll("{MEMORY_ACTIVITY}", memoryValues.activityMemory)
      .replaceAll("{MEMORY_BUFFER}", memoryValues.bufferText);
  }

  /**
   * Builds the system prompt for heartbeat-triggered background activities.
   * This includes memory, but excludes interaction guidelines.
   * @param actorId - The actor identifier to read.
   * @returns The injected system prompt.
   */
  async buildSystemPromptForHeartbeatActivity(
    actorId: number,
  ): Promise<string> {
    const template = await loadPromptTemplate(
      "preamble.md",
      "system.md",
      "world.md",
      "you.md",
      "memory.md",
    );
    const [{ rolePrompt, personalityMemory }, memoryValues] = await Promise.all(
      [
        this.getBasePromptValues(actorId),
        this.getDetachedMemoryPromptValues(actorId),
      ],
    );
    return template
      .replaceAll("{SKILLS_METADATA}", skillsPrompt)
      .replaceAll("{ROLE_PROMPT}", rolePrompt)
      .replaceAll("{PERSONALITY_MEMORY}", personalityMemory)
      .replaceAll(
        "{CONVERSATION_DESCRIPTION}",
        memoryValues.conversationDescription,
      )
      .replaceAll("{MEMORY_YEAR}", memoryValues.yearMemory)
      .replaceAll("{MEMORY_MONTH}", memoryValues.monthMemory)
      .replaceAll("{MEMORY_DAY}", memoryValues.dayMemory)
      .replaceAll("{MEMORY_ACTIVITY}", memoryValues.activityMemory)
      .replaceAll("{MEMORY_BUFFER}", memoryValues.bufferText);
  }

  /**
   * Builds the background prompt used for memory maintenance.
   * @param actorId - The actor identifier to read.
   * @returns The injected system prompt without memory or recent conversation.
   */
  async buildSystemPromptForMemoryUpdate(actorId: number): Promise<string> {
    const template = await loadPromptTemplate(
      "preamble.md",
      "system.md",
      "world.md",
      "you.md",
    );
    const { rolePrompt, personalityMemory } =
      await this.getBasePromptValues(actorId);
    return template
      .replaceAll("{SKILLS_METADATA}", skillsPrompt)
      .replaceAll("{ROLE_PROMPT}", rolePrompt)
      .replaceAll("{PERSONALITY_MEMORY}", personalityMemory);
  }

  private async buildYearMemoryPrompt(actorId: number): Promise<string> {
    const records = await this.listShortTermMemories(actorId, {
      kind: "year",
      sort: "asc",
    });
    return this.formatFlatMemoryLines(records).join("\n");
  }

  private async buildMonthMemoryPrompt(actorId: number): Promise<string> {
    const records = await this.listShortTermMemories(actorId, {
      kind: "month",
      processed: false,
      sort: "desc",
      limit: this.monthWindowSize,
    });
    return this.formatFlatMemoryLines([...records].reverse()).join("\n");
  }

  private async buildDayMemoryPrompt(actorId: number): Promise<string> {
    const records = await this.listShortTermMemories(actorId, {
      kind: "day",
      processed: false,
      sort: "desc",
      limit: this.dayWindowSize,
    });
    return this.formatDayMemoryLines([...records].reverse()).join("\n");
  }

  private async buildActivityMemoryPrompt(actorId: number): Promise<string> {
    const records = await this.listShortTermMemories(actorId, {
      kind: "activity",
      processed: false,
      sort: "desc",
      limit: this.activityWindowSize,
    });
    return this.formatActivityLines([...records].reverse()).join("\n");
  }

  private formatFlatMemoryLines(records: ShortTermMemoryRecord[]): string[] {
    if (records.length === 0) {
      return ["- None."];
    }
    return records.map(
      (item) => `- ${item.date}：${this.toSingleLine(item.memory)}`,
    );
  }

  private formatDayMemoryLines(records: ShortTermMemoryRecord[]): string[] {
    if (records.length === 0) {
      return ["- None."];
    }
    return records.map((item) => {
      const weekday = this.formatChineseWeekday(item.date);
      return `- ${item.date}（${weekday}）：${this.toSingleLine(item.memory)}`;
    });
  }

  private formatActivityLines(records: ShortTermMemoryRecord[]): string[] {
    if (records.length === 0) {
      return ["- None."];
    }
    const grouped = new Map<string, ShortTermMemoryRecord[]>();
    for (const item of records) {
      const bucket = grouped.get(item.date) ?? [];
      bucket.push(item);
      grouped.set(item.date, bucket);
    }
    const lines: string[] = [];
    for (const [date, memories] of grouped) {
      lines.push(`- ${date}`);
      for (const item of memories) {
        const time =
          typeof item.createdAt === "number"
            ? formatTimestamp("HH:mm", item.createdAt)
            : typeof item.updatedAt === "number"
              ? formatTimestamp("HH:mm", item.updatedAt)
              : null;
        const memory = this.toSingleLine(item.memory);
        lines.push(time ? `  - [${time}] ${memory}` : `  - ${memory}`);
      }
      lines.push("");
    }
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines;
  }

  private toSingleLine(value: string): string {
    return value.replaceAll(/\s+/g, " ").trim() || "None.";
  }

  private formatChineseWeekday(date: string): string {
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
      new Date(parseTimestamp("YYYY-MM-DD", date)).getDay()
    ];
  }

  /**
   * Gets buffer messages.
   * @param conversationId - The conversation identifier to read.
   * @param count - The number of messages to return.
   * @returns The buffer messages.
   */
  async getBuffer(
    conversationId: number,
    count: number,
  ): Promise<BufferMessage[]> {
    const [conversation, messages] = await Promise.all([
      this.conversationDB.getConversation(conversationId),
      this.conversationMessageDB.listConversationMessages({
        conversationId,
        limit: count,
        resumed: true,
        sort: "desc",
      }),
    ]);
    if (!conversation) {
      throw new Error(`Conversation with ID ${conversationId} not found.`);
    }
    return [...messages].reverse().map((item) => {
      const message = item.message;
      if (message.kind === "user") {
        return {
          kind: "user" as const,
          speaker: {
            uid: message.uid,
            session: conversation.session,
            name: message.name,
          },
          msgId: item.msgId,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          contents: message.contents,
          time: item.createdAt ?? Date.now(),
        };
      }
      return {
        kind: "actor" as const,
        msgId: item.msgId,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        contents: message.contents,
        ...(message.think && message.think.length > 0
          ? { think: message.think }
          : {}),
        time: item.createdAt ?? Date.now(),
      };
    });
  }

  /**
   * Persists a chat message before it is added to the resumed buffer.
   * @param message - The runtime chat message to persist.
   */
  async persistChatMessage(message: BufferWriteMessage): Promise<void> {
    const conversationId = message.conversationId;
    const actorId = await this.getActorIdByConversation(conversationId);
    const payload = isActorChatInput(message)
      ? {
          kind: "user" as const,
          msgId: message.msgId,
          uid: message.speaker.uid,
          name: message.speaker.name,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          contents: message.inputs,
        }
      : {
          kind: "actor" as const,
          msgId: message.msgId,
          name: await this.getActorDisplayName(actorId),
          ...(() => {
            const replyTo = message.ema_reply.reply_to
              ? parseReplyRef(message.ema_reply.reply_to)
              : null;
            return replyTo ? { replyTo } : {};
          })(),
          contents:
            message.ema_reply.kind === "sticker"
              ? [
                  ...(message.ema_reply.mention_uids ?? []).map((uid) => ({
                    type: "text" as const,
                    text: `@(${uid})`,
                  })),
                  {
                    type: "text" as const,
                    text: await formatStickerDisplayText(
                      message.ema_reply.content,
                    ),
                  },
                  ...(await this.buildStickerInlineContents(
                    message.ema_reply.content,
                  )),
                ]
              : [
                  ...(message.ema_reply.mention_uids ?? []).map((uid) => ({
                    type: "text" as const,
                    text: `@(${uid})`,
                  })),
                  {
                    type: "text" as const,
                    text: message.ema_reply.content,
                  },
                ],
          think: message.ema_reply.think,
        };
    await this.conversationMessageDB.addConversationMessage({
      conversationId,
      actorId,
      channelMessageId: isActorChatInput(message)
        ? message.channelMessageId
        : `${message.conversationId}:${message.msgId}`,
      resumed: false,
      message: payload,
      createdAt: message.time,
      msgId: message.msgId,
    });
  }

  /**
   * Builds inline image contents for one sticker message stored in history.
   * @param stickerId - Stable sticker identifier emitted by the model.
   * @returns Inline image contents, or an empty list when the asset cannot be resolved.
   */
  private async buildStickerInlineContents(
    stickerId: string,
  ): Promise<InlineDataItem[]> {
    try {
      return [await stickerIdToInlineData(stickerId)];
    } catch (error) {
      this.logger.warn(
        `Failed to persist sticker inline data for '${stickerId}', storing text proxy only.`,
        error,
      );
      return [];
    }
  }

  /**
   * Adds a single persisted message into the resumed buffer and triggers activity updates when needed.
   * @param conversationId - The conversation identifier.
   * @param msgId - Actor-scoped message identifier.
   * @param triggerActivityTick - Whether this add should participate in online activity-tick triggering.
   * @param triggeredAt - Optional timestamp used when triggering activity-tick jobs.
   */
  async addToBuffer(
    conversationId: number,
    msgId: number,
    triggerActivityTick: boolean,
    triggeredAt?: number,
  ): Promise<void> {
    const updated =
      await this.conversationMessageDB.markConversationMessagesResumed(
        conversationId,
        [msgId],
      );
    if (updated === 0) {
      return;
    }

    const resumedCount =
      await this.conversationMessageDB.countConversationMessages(
        conversationId,
        true,
      );
    if (
      !triggerActivityTick ||
      resumedCount % this.diaryUpdateEvery !== 0 ||
      !this.server
    ) {
      return;
    }

    const actorId = await this.getActorIdByConversation(conversationId);
    void runActorActivityTickJob(this.server, {
      actorId,
      conversationId,
      triggeredAt: triggeredAt ?? Date.now(),
    }).catch((error) => {
      this.logger.error("Failed to run actor activity tick job:", error);
    });
  }

  /**
   * Searches the long-term memory for items matching the memory text.
   * @param actorId - The actor identifier to search.
   * @param memory - The memory text to match.
   * @param limit - Maximum number of memories to return.
   * @param index0 - Optional index0 filter.
   * @param index1 - Optional index1 filter.
   * @returns The search results.
   */
  async search(
    actorId: number,
    memory: string,
    limit: number,
    index0?: string,
    index1?: string,
  ): Promise<LongTermMemoryRecord[]> {
    const items = await this.longTermMemorySearcher.searchLongTermMemories({
      actorId,
      memory,
      limit,
      index0,
      index1,
    });
    return items.map((item) => {
      if (typeof item.id !== "number") {
        throw new Error("LongTermMemory record is missing id");
      }
      return {
        id: item.id,
        index0: item.index0,
        index1: item.index1,
        memory: item.memory,
        createdAt: item.createdAt ?? Date.now(),
        ...(item.messages ? { messages: item.messages } : {}),
      };
    });
  }

  /**
   * Lists short-term memories for the actor.
   * @param actorId - The actor identifier to query.
   * @param kind - Optional memory kind filter.
   * @param limit - Optional maximum number of memories to return.
   * @returns The short-term memories sorted by newest first.
   */
  async getShortTermMemory(
    actorId: number,
    kind?: ShortTermMemory["kind"],
    limit?: number,
  ): Promise<ShortTermMemoryRecord[]> {
    return this.listShortTermMemories(actorId, {
      ...(kind ? { kind } : {}),
      ...(limit !== undefined ? { limit } : {}),
      sort: "desc",
    });
  }

  /**
   * Lists short-term memories with additional filters.
   * @param actorId - The actor identifier to query.
   * @param req - Additional list filters.
   * @returns Matching short-term memory records.
   */
  async listShortTermMemories(
    actorId: number,
    req: Omit<ListShortTermMemoriesRequest, "actorId"> = {},
  ): Promise<ShortTermMemoryRecord[]> {
    const items = await this.shortTermMemoryDB.listShortTermMemories({
      actorId,
      ...req,
    });
    return items.map((item) => {
      if (typeof item.id !== "number") {
        throw new Error("ShortTermMemory record is missing id");
      }
      return {
        id: item.id,
        kind: item.kind,
        date: item.date,
        memory: item.memory,
        createdAt: item.createdAt ?? Date.now(),
        updatedAt: item.updatedAt,
        processedAt: item.processedAt,
      };
    });
  }

  /**
   * Appends a new short-term memory item to the actor.
   * @param actorId - The actor identifier to update.
   * @param item - The short-term memory item to add.
   */
  async appendShortTermMemory(
    actorId: number,
    item: ShortTermMemory,
  ): Promise<void> {
    const now = item.updatedAt ?? Date.now();
    await this.shortTermMemoryDB.appendShortTermMemory({
      actorId,
      kind: item.kind,
      date: item.date,
      memory: item.memory,
      createdAt: item.createdAt,
      updatedAt: now,
      processedAt: item.processedAt,
    });
  }

  /**
   * Inserts or updates a short-term memory item identified by kind and date.
   * @param actorId - The actor identifier to update.
   * @param item - The short-term memory item to write.
   */
  async upsertShortTermMemory(
    actorId: number,
    item: ShortTermMemory,
  ): Promise<void> {
    const existing = await this.listShortTermMemories(actorId, {
      kind: item.kind,
      date: item.date,
      limit: 1,
    });
    const now = item.updatedAt ?? Date.now();
    if (existing.length === 0) {
      await this.shortTermMemoryDB.appendShortTermMemory({
        actorId,
        kind: item.kind,
        date: item.date,
        memory: item.memory,
        createdAt: item.createdAt,
        updatedAt: now,
        processedAt: item.processedAt,
      });
      return;
    }
    await this.shortTermMemoryDB.upsertShortTermMemory({
      id: existing[0].id,
      actorId,
      kind: item.kind,
      date: item.date,
      memory: item.memory,
      createdAt: existing[0].createdAt,
      updatedAt: now,
      processedAt: item.processedAt,
    });
  }

  /**
   * Marks the specified short-term memory records as processed.
   * @param actorId - The actor identifier to update.
   * @param ids - Memory record identifiers to mark.
   * @param processedAt - Processing timestamp.
   */
  async markShortTermMemoryRecordsProcessed(
    actorId: number,
    ids: number[],
    processedAt: number,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const records = await this.listShortTermMemories(actorId, {
      ids,
    });
    await Promise.all(
      records.map((record) =>
        this.shortTermMemoryDB.upsertShortTermMemory({
          id: record.id,
          actorId,
          kind: record.kind,
          date: record.date,
          memory: record.memory,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt ?? processedAt,
          processedAt,
        }),
      ),
    );
  }

  /**
   * Gets the activity snapshot used by memory-update jobs.
   * @param actorId - The actor identifier to read.
   * @param triggeredAt - Trigger timestamp in milliseconds.
   * @returns Unprocessed activities up to the trigger date.
   */
  async getActivitySnapshot(
    actorId: number,
    triggeredAt: number,
  ): Promise<ShortTermMemoryRecord[]> {
    const triggerDate = formatTimestamp("YYYY-MM-DD", triggeredAt);
    const activities = await this.listShortTermMemories(actorId, {
      kind: "activity",
      processed: false,
      sort: "asc",
    });
    return activities.filter((item) => item.date <= triggerDate);
  }

  /**
   * Adds a long-term memory item to the actor.
   * @param actorId - The actor identifier to update.
   * @param item - The long-term memory item to add.
   */
  async addLongTermMemory(
    actorId: number,
    item: LongTermMemory,
  ): Promise<number> {
    return await this.longTermMemoryDB.appendLongTermMemory({
      actorId,
      ...item,
    });
  }

  /**
   * Updates role prompt markdown for the current actor.
   * @param actorId - The actor identifier to update.
   * @param prompt - Role prompt markdown text.
   * @returns The updated role identifier.
   */
  async upsertRolePrompt(actorId: number, prompt: string): Promise<number> {
    const actor = await this.actorDB.getActor(actorId);
    if (!actor) {
      throw new Error(`Actor with ID ${actorId} not found.`);
    }
    const role = await this.roleDB.getRole(actor.roleId);
    const roleName = role?.name ?? `Role ${actor.roleId}`;
    return this.roleDB.upsertRole({
      id: actor.roleId,
      name: roleName,
      prompt,
    });
  }

  /**
   * Updates personality memory markdown for the current actor.
   * @param actorId - The actor identifier to update.
   * @param memory - Personality memory markdown text.
   * @returns The updated personality identifier.
   */
  async upsertPersonalityMemory(
    actorId: number,
    memory: string,
  ): Promise<number> {
    return this.personalityDB.upsertPersonality({
      actorId,
      memory,
    });
  }

  /**
   * Resolves the owner UID of the actor for a specific channel.
   * @param actorId - The actor identifier.
   * @param channel - External channel name.
   * @returns Matching owner UID or null.
   */
  async getOwnerUid(actorId: number, channel: string): Promise<string | null> {
    const userId = await this.userOwnActorDB.getActorOwner(actorId);
    if (userId === null) {
      return null;
    }
    const bindings =
      await this.externalIdentityBindingDB.listExternalIdentityBindings({
        userId,
        channel,
      });
    return bindings[0]?.uid ?? null;
  }

  private async getActorDisplayName(actorId: number): Promise<string> {
    const actor = await this.actorDB.getActor(actorId);
    if (!actor) {
      return `Actor ${actorId}`;
    }
    const role = await this.roleDB.getRole(actor.roleId);
    return role?.name ?? `Actor ${actorId}`;
  }
}
