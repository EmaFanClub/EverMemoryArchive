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
  ConversationEntity,
  ConversationMessageEntity,
  ListShortTermMemoriesRequest,
} from "../db";
import { Logger } from "../shared/logger";
import { runActorBackgroundJob } from "../scheduler/jobs/actor.job";
import type {
  ActorScheduleItem,
  ActorScheduleListResult,
} from "../scheduler/actor_scheduler";
import { formatStickerDisplayText } from "../skills/sticker-skill/pack";
import { stickerIdToInlineData } from "../skills/sticker-skill/utils";
import { MEDIA_INLINE_LIMIT_BYTES } from "../channel/utils";
import {
  buildPromptFromBufferMessage,
  isActorChatInput,
  isActorKeepSilenceResponse,
} from "./utils";
import { parseReplyRef, resolveSession } from "../channel";
import type { Server } from "../server";
import type { InlineDataItem, InputContent } from "../llm/schema";
import { formatTimestamp, parseTimestamp } from "../shared/utils";
import { skillsPrompt } from "../skills";
import type { EmaReply } from "../tools/ema_reply_tool";
import { formatImageReplyMediaText } from "../tools/ema_reply_tool";
import { ActorWorkspaceService } from "../workspace/actor_workspace";

function isConversationActivityTarget(
  message: ConversationMessageEntity,
): boolean {
  return message.activityTarget !== false;
}

/**
 * Memory manager implementation backed by database interfaces.
 */
export class MemoryManager implements BufferStorage, ActorMemory {
  /** Number of buffer messages injected into chat prompts. */
  readonly bufferWindowSize = 30;
  /** Number of pending buffered messages required before triggering a conversation activity update. */
  readonly diaryUpdateEvery = 20;
  /** Number of pending activities required before triggering a memory rollup. */
  readonly activityRollupEvery = 7;
  /** Number of unprocessed day entries injected into chat prompts. */
  readonly dayWindowSize = 2;
  /** Number of unprocessed month entries injected into chat prompts. */
  readonly monthWindowSize = 2;
  /** Number of activity entries injected into chat prompts. */
  readonly activityWindowSize = 10;
  /** Conversation IDs currently running one conversation-to-activity update. */
  private readonly runningConversationActivities = new Set<number>();
  /** Actor IDs currently running one threshold-based activity-to-day rollup. */
  private readonly runningActivityToDayRollups = new Set<number>();
  private readonly logger: Logger = Logger.create({
    name: "MemoryManager",
    outputs: [
      { type: "console", level: "warn" },
      { type: "file", level: "debug" },
    ],
  });

  /**
   * Creates a new MemoryManager instance.
   * @param server - Server runtime used for database access and background coordination.
   */
  constructor(
    private readonly server: Server,
    private readonly workspace: ActorWorkspaceService = new ActorWorkspaceService(),
  ) {}

  private async getBasePromptValues(actorId: number): Promise<{
    rolePrompt: string;
    personalityMemory: string;
  }> {
    const [actor, personality] = await Promise.all([
      this.server.dbService.actorDB.getActor(actorId),
      this.server.dbService.personalityDB.getPersonality(actorId),
    ]);
    const role = actor?.roleId
      ? await this.server.dbService.roleDB.getRole(actor.roleId)
      : null;
    return {
      rolePrompt: role?.prompt ?? "None.",
      personalityMemory: personality?.memory ?? "None.",
    };
  }

  private async getConversationMemoryPromptValues(
    actorId: number,
    conversationId: number,
    activityRecords?: ShortTermMemoryRecord[],
    bufferMessages?: BufferMessage[],
  ): Promise<{
    conversationsText: string;
    currentConversationText: string;
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
      conversationsText,
    ] = await Promise.all([
      this.server.dbService.conversationDB.getConversation(conversationId),
      this.buildYearMemoryPrompt(actorId),
      this.buildMonthMemoryPrompt(actorId),
      this.buildDayMemoryPrompt(actorId),
      this.buildActivityMemoryPrompt(actorId, activityRecords),
      bufferMessages
        ? Promise.resolve(bufferMessages)
        : this.getBuffer(conversationId, this.bufferWindowSize),
      this.buildConversationsPrompt(actorId),
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
      conversationsText,
      currentConversationText: this.formatConversationTitle(conversation),
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

  private async getDetachedMemoryPromptValues(
    actorId: number,
    activityRecords?: ShortTermMemoryRecord[],
  ): Promise<{
    conversationsText: string;
    currentConversationText: string;
    bufferText: string;
    yearMemory: string;
    monthMemory: string;
    dayMemory: string;
    activityMemory: string;
  }> {
    const [
      yearMemory,
      monthMemory,
      dayMemory,
      activityMemory,
      conversationsText,
    ] = await Promise.all([
      this.buildYearMemoryPrompt(actorId),
      this.buildMonthMemoryPrompt(actorId),
      this.buildDayMemoryPrompt(actorId),
      this.buildActivityMemoryPrompt(actorId, activityRecords),
      this.buildConversationsPrompt(actorId),
    ]);
    return {
      conversationsText,
      currentConversationText: "None.",
      bufferText: "None.",
      yearMemory,
      monthMemory,
      dayMemory,
      activityMemory,
    };
  }

  private async getBackgroundMemoryPromptValues(
    actorId: number,
    options?: {
      conversationId?: number;
      activityRecords?: ShortTermMemoryRecord[];
      bufferMessages?: BufferMessage[];
    },
  ): Promise<{
    conversationsText: string;
    currentConversationText: string;
    bufferText: string;
    yearMemory: string;
    monthMemory: string;
    dayMemory: string;
    activityMemory: string;
  }> {
    if (typeof options?.conversationId === "number") {
      return this.getConversationMemoryPromptValues(
        actorId,
        options.conversationId,
        options.activityRecords,
        options.bufferMessages,
      );
    }
    return this.getDetachedMemoryPromptValues(
      actorId,
      options?.activityRecords,
    );
  }

  private async buildConversationsPrompt(actorId: number): Promise<string> {
    const conversations =
      await this.server.dbService.conversationDB.listConversations({
        actorId,
      });
    const lines: string[] = [];
    for (const conversation of conversations.sort(
      (left, right) => (left.id ?? 0) - (right.id ?? 0),
    )) {
      lines.push(
        `- ${this.formatConversationTitle(conversation)}｜主动联系：${conversation.allowProactive === true ? "允许" : "禁止"}`,
      );
      const description = conversation.description?.trim();
      if (description) {
        lines.push(`  ${description}`);
      }
    }
    return lines.length > 0 ? lines.join("\n") : "None.";
  }

  private formatConversationTitle(
    conversation: Pick<ConversationEntity, "name" | "session">,
  ): string {
    const sessionInfo = resolveSession(conversation.session);
    const typeText =
      sessionInfo?.type === "group"
        ? "群聊"
        : sessionInfo?.type === "chat"
          ? "私聊"
          : "未知";
    return `${conversation.name}｜${typeText}｜session：${conversation.session}`;
  }

  private async buildSchedulePrompt(actorId: number): Promise<string> {
    const empty: ActorScheduleListResult = {
      overdue: [],
      upcoming: [],
      recurring: [],
      focused: [],
    };
    if (!this.server.scheduler) {
      return this.formatScheduleListForPrompt(empty, new Map());
    }
    const listed = await this.server.getActorScheduler(actorId).list();
    const conversations = await this.buildScheduleConversationMap(listed);
    return this.formatScheduleListForPrompt(listed, conversations);
  }

  private async buildScheduleConversationMap(
    listed: ActorScheduleListResult,
  ): Promise<Map<number, Pick<ConversationEntity, "name" | "session">>> {
    const conversationIds = new Set<number>();
    for (const item of [
      ...listed.overdue,
      ...listed.upcoming,
      ...listed.recurring,
      ...listed.focused,
    ]) {
      if (
        (item.task === "chat" || item.task === "focus") &&
        typeof item.conversationId === "number"
      ) {
        conversationIds.add(item.conversationId);
      }
    }

    const entries = await Promise.all(
      [...conversationIds].map(async (conversationId) => {
        const conversation =
          await this.server.dbService.conversationDB.getConversation(
            conversationId,
          );
        return [conversationId, conversation] as const;
      }),
    );

    const conversations = new Map<
      number,
      Pick<ConversationEntity, "name" | "session">
    >();
    for (const [conversationId, conversation] of entries) {
      if (conversation) {
        conversations.set(conversationId, conversation);
      }
    }
    return conversations;
  }

  private formatScheduleListForPrompt(
    listed: ActorScheduleListResult,
    conversations: Map<number, Pick<ConversationEntity, "name" | "session">>,
  ): string {
    return [
      "## 过时日程",
      "",
      this.formatScheduleGroup(listed.overdue, conversations),
      "",
      "## 未来日程",
      "",
      this.formatScheduleGroup(listed.upcoming, conversations),
      "",
      "## 周期日程",
      "",
      this.formatScheduleGroup(listed.recurring, conversations),
      "",
      "## 关注会话",
      "",
      this.formatScheduleGroup(listed.focused, conversations),
    ].join("\n");
  }

  private formatScheduleGroup(
    items: ActorScheduleItem[],
    conversations: Map<number, Pick<ConversationEntity, "name" | "session">>,
  ): string {
    if (items.length === 0) {
      return "None.";
    }
    return items
      .map((item) => this.formatScheduleLine(item, conversations))
      .join("\n");
  }

  private formatScheduleLine(
    item: ActorScheduleItem,
    conversations: Map<number, Pick<ConversationEntity, "name" | "session">>,
  ): string {
    const timeText =
      item.type === "once" ? item.runAt : `下次 ${item.nextRunAt ?? "未知"}`;
    if (item.task === "chat" || item.task === "focus") {
      const segments = [
        `id=${item.id}`,
        timeText,
        item.task,
        this.formatScheduleConversationTarget(
          item.conversationId,
          conversations,
        ),
      ];
      if (item.type === "every") {
        segments.push(`周期：${this.formatScheduleInterval(item.interval)}`);
      }
      if (item.task === "focus") {
        return `- ${segments.join("｜")}`;
      }
      segments.push(this.formatScheduleSummary(item));
      return `- ${segments.join("｜")}`;
    }
    if (item.task === "activity") {
      const segments = [`id=${item.id}`, timeText, item.task];
      if (item.type === "every") {
        segments.push(`周期：${this.formatScheduleInterval(item.interval)}`);
      }
      segments.push(this.formatScheduleSummary(item));
      return `- ${segments.join("｜")}`;
    }
    const segments = [`id=${item.id}`, timeText, item.task];
    if (item.type === "every") {
      segments.push(`周期：${this.formatScheduleInterval(item.interval)}`);
    }
    return `- ${segments.join("｜")}`;
  }

  private formatScheduleConversationTarget(
    conversationId: number | null,
    conversations: Map<number, Pick<ConversationEntity, "name" | "session">>,
  ): string {
    if (typeof conversationId !== "number") {
      return "session=未知";
    }
    const conversation = conversations.get(conversationId);
    if (!conversation) {
      return "session=未知";
    }
    return `session=${conversation.session}`;
  }

  private formatScheduleInterval(interval: string | number): string {
    if (typeof interval !== "number") {
      return interval;
    }
    if (interval > 0 && interval % 60_000 === 0) {
      return `${interval / 60_000}min`;
    }
    return `${interval}ms`;
  }

  private formatScheduleSummary(item: ActorScheduleItem): string {
    const summary = item.summary?.trim();
    if (summary) {
      return this.toSingleLine(summary);
    }
    const prompt = this.toSingleLine(item.prompt);
    if (prompt === "None.") {
      return "无摘要";
    }
    return prompt.length > 60 ? `${prompt.slice(0, 60)}...` : prompt;
  }

  private async getActorIdByConversation(
    conversationId: number,
  ): Promise<number> {
    const conversation =
      await this.server.dbService.conversationDB.getConversation(
        conversationId,
      );
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
    const [{ rolePrompt, personalityMemory }, memoryValues, scheduleText] =
      await Promise.all([
        this.getBasePromptValues(actorId),
        this.getConversationMemoryPromptValues(actorId, conversationId),
        this.buildSchedulePrompt(actorId),
      ]);
    return await this.server.promptStore.loadSystemPrompt("foreground", {
      ...this.buildSystemPromptVariables(
        rolePrompt,
        personalityMemory,
        memoryValues,
        scheduleText,
      ),
      SESSION_TYPE: memoryValues.sessionType,
    });
  }

  /**
   * Builds the system prompt for background tasks. This includes memory, but
   * excludes interaction guidelines.
   * @param actorId - The actor identifier to read.
   * @param options - Optional background prompt inputs.
   * @returns The injected system prompt for background execution.
   */
  async buildSystemPromptForBackground(
    actorId: number,
    options?: {
      conversationId?: number;
      activityRecords?: ShortTermMemoryRecord[];
      bufferMessages?: BufferMessage[];
    },
  ): Promise<string> {
    const [{ rolePrompt, personalityMemory }, memoryValues, scheduleText] =
      await Promise.all([
        this.getBasePromptValues(actorId),
        this.getBackgroundMemoryPromptValues(actorId, options),
        this.buildSchedulePrompt(actorId),
      ]);
    return await this.server.promptStore.loadSystemPrompt(
      "background",
      this.buildSystemPromptVariables(
        rolePrompt,
        personalityMemory,
        memoryValues,
        scheduleText,
      ),
    );
  }

  private buildSystemPromptVariables(
    rolePrompt: string,
    personalityMemory: string,
    memoryValues: {
      conversationsText: string;
      currentConversationText: string;
      bufferText: string;
      yearMemory: string;
      monthMemory: string;
      dayMemory: string;
      activityMemory: string;
    },
    scheduleText: string,
  ) {
    return {
      SKILLS_METADATA: skillsPrompt,
      ROLE_PROMPT: rolePrompt,
      PERSONALITY_MEMORY: personalityMemory,
      CONVERSATIONS: memoryValues.conversationsText,
      CURRENT_CONVERSATION: memoryValues.currentConversationText,
      MEMORY_YEAR: memoryValues.yearMemory,
      MEMORY_MONTH: memoryValues.monthMemory,
      MEMORY_DAY: memoryValues.dayMemory,
      MEMORY_ACTIVITY: memoryValues.activityMemory,
      SCHEDULES: scheduleText,
      CONVERSATION_WINDOW: memoryValues.bufferText,
    };
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

  private async buildActivityMemoryPrompt(
    actorId: number,
    records?: ShortTermMemoryRecord[],
  ): Promise<string> {
    const items =
      records ?? (await this.getActivityWindow(actorId, Date.now()));
    return this.formatActivityLines(items).join("\n");
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
    const messages = await this.getBufferedConversationWindowEntities(
      conversationId,
      Date.now(),
      count,
    );
    return this.mapConversationEntitiesToBufferMessages(
      conversationId,
      messages,
    );
  }

  /**
   * Gets one frozen buffered-message window for a conversation.
   * @param conversationId - The conversation identifier to read.
   * @param triggeredAt - Trigger timestamp used as the upper bound.
   * @param count - The number of buffered messages to return.
   * @returns Buffered messages and their actor-scoped msgIds ordered from oldest to newest.
   */
  async getBufferedConversationWindowSnapshot(
    conversationId: number,
    triggeredAt: number,
    count: number = this.bufferWindowSize,
  ): Promise<{
    messages: BufferMessage[];
    msgIds: number[];
    activityTargetMsgIds: number[];
  }> {
    const records = await this.getBufferedConversationWindowEntities(
      conversationId,
      triggeredAt,
      count,
    );
    return {
      messages: await this.mapConversationEntitiesToBufferMessages(
        conversationId,
        records,
      ),
      msgIds: records.map((item) => item.msgId),
      activityTargetMsgIds: records
        .filter(isConversationActivityTarget)
        .map((item) => item.msgId),
    };
  }

  /**
   * Gets the pending-state summary for the current buffered conversation window.
   * @param conversationId - The conversation identifier to read.
   * @param triggeredAt - Trigger timestamp used as the upper bound.
   * @returns Pending count plus the newest pending actor-scoped msgId.
   */
  async getPendingConversationWindowState(
    conversationId: number,
    triggeredAt: number,
    count: number = this.bufferWindowSize,
  ): Promise<{ count: number; lastPendingId: number | null }> {
    const records = await this.getBufferedConversationWindowEntities(
      conversationId,
      triggeredAt,
      count,
    );
    const pendingRecords = records.filter(
      (item) =>
        isConversationActivityTarget(item) &&
        typeof item.activityProcessedAt !== "number",
    );
    return {
      count: pendingRecords.length,
      lastPendingId: pendingRecords[pendingRecords.length - 1]?.msgId ?? null,
    };
  }

  /**
   * Marks buffered conversation messages as consumed by one conversation-activity update.
   * @param conversationId - The conversation identifier to update.
   * @param msgIds - Actor-scoped msgIds inside the buffered snapshot.
   * @param processedAt - Processing timestamp.
   * @returns Number of messages successfully marked as processed.
   */
  async markConversationMessagesActivityProcessed(
    conversationId: number,
    msgIds: number[],
    processedAt: number,
  ): Promise<number> {
    return await this.server.dbService.conversationMessageDB.markConversationMessagesActivityProcessed(
      conversationId,
      msgIds,
      processedAt,
    );
  }

  private async getBufferedConversationWindowEntities(
    conversationId: number,
    triggeredAt: number,
    count: number,
  ): Promise<ConversationMessageEntity[]> {
    const messages =
      await this.server.dbService.conversationMessageDB.listConversationMessages(
        {
          conversationId,
          limit: count,
          buffered: true,
          createdBefore: triggeredAt,
          sort: "desc",
        },
      );
    return [...messages].reverse();
  }

  private async mapConversationEntitiesToBufferMessages(
    conversationId: number,
    messages: ConversationMessageEntity[],
  ): Promise<BufferMessage[]> {
    const conversation =
      await this.server.dbService.conversationDB.getConversation(
        conversationId,
      );
    if (!conversation) {
      throw new Error(`Conversation with ID ${conversationId} not found.`);
    }
    return messages.map((item) => {
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
        ...(message.keep_silence ? { keep_silence: true as const } : {}),
        time: item.createdAt ?? Date.now(),
      };
    });
  }

  /**
   * Persists a chat message before it is added to the buffered recent-history window.
   * @param message - The runtime chat message to persist.
   */
  async persistChatMessage(message: BufferWriteMessage): Promise<void> {
    const conversationId = message.conversationId;
    const actorId = await this.getActorIdByConversation(conversationId);
    let payload;
    let channelMessageId: string | undefined;
    if (isActorChatInput(message)) {
      payload = {
        kind: "user" as const,
        msgId: message.msgId,
        uid: message.speaker.uid,
        name: message.speaker.name,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        contents: message.inputs,
      };
      channelMessageId = message.channelMessageId;
    } else if (isActorKeepSilenceResponse(message)) {
      payload = {
        kind: "actor" as const,
        msgId: message.msgId,
        name: await this.getActorDisplayName(actorId),
        contents: [],
        think: message.think,
        keep_silence: true as const,
      };
    } else {
      payload = {
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
            ? await this.buildStickerReplyContents(message.ema_reply)
            : message.ema_reply.kind === "image"
              ? await this.buildImageReplyContents(actorId, message.ema_reply)
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
        ...(message.ema_reply.think ? { think: message.ema_reply.think } : {}),
      };
      channelMessageId = `${message.conversationId}:${message.msgId}`;
    }
    await this.server.dbService.conversationMessageDB.addConversationMessage({
      conversationId,
      actorId,
      ...(channelMessageId ? { channelMessageId } : {}),
      buffered: false,
      message: payload,
      createdAt: message.time,
      msgId: message.msgId,
    });
  }

  private async buildImageReplyContents(
    actorId: number,
    reply: EmaReply,
  ): Promise<InputContent[]> {
    const mentionContents = (reply.mention_uids ?? []).map((uid) => ({
      type: "text" as const,
      text: `@(${uid})`,
    }));
    try {
      const image = await this.workspace.readImageDataFile(
        actorId,
        reply.content,
        {
          maxBytes: MEDIA_INLINE_LIMIT_BYTES,
        },
      );
      return [
        ...mentionContents,
        {
          type: "inline_data" as const,
          mimeType: image.mimeType,
          data: image.data.toString("base64"),
          text: formatImageReplyMediaText(reply),
        },
      ];
    } catch (error) {
      this.logger.warn(
        `Failed to persist workspace image inline data for '${reply.content}', storing text proxy only.`,
        error,
      );
    }
    return [
      ...mentionContents,
      {
        type: "text" as const,
        text: formatImageReplyMediaText(reply),
      },
    ];
  }

  private async buildStickerReplyContents(
    reply: EmaReply,
  ): Promise<InputContent[]> {
    const mentionContents = (reply.mention_uids ?? []).map((uid) => ({
      type: "text" as const,
      text: `@(${uid})`,
    }));
    const stickerText = await formatStickerDisplayText(reply.content);
    const inlineContents = await this.buildStickerInlineContents(
      reply.content,
      stickerText,
    );
    return inlineContents.length > 0
      ? [...mentionContents, ...inlineContents]
      : [...mentionContents, { type: "text", text: stickerText }];
  }

  /**
   * Builds inline image contents for one sticker message stored in history.
   * @param stickerId - Stable sticker identifier emitted by the model.
   * @param stickerText - Text description used when this media is collapsed.
   * @returns Inline image contents, or an empty list when the asset cannot be resolved.
   */
  private async buildStickerInlineContents(
    stickerId: string,
    stickerText: string,
  ): Promise<InlineDataItem[]> {
    try {
      return [
        { ...(await stickerIdToInlineData(stickerId)), text: stickerText },
      ];
    } catch (error) {
      this.logger.warn(
        `Failed to persist sticker inline data for '${stickerId}', storing text proxy only.`,
        error,
      );
      return [];
    }
  }

  /**
   * Adds a single persisted message into the buffered recent-history window and triggers activity updates when needed.
   * @param conversationId - The conversation identifier.
   * @param msgId - Actor-scoped message identifier.
   * @param triggerActivityTick - Whether this add should participate in online conversation-activity triggering.
   * @param triggeredAt - Optional timestamp used when triggering conversation-activity jobs.
   */
  async addToBuffer(
    conversationId: number,
    msgId: number,
    triggerActivityTick: boolean,
    triggeredAt?: number,
  ): Promise<void> {
    const updated =
      await this.server.dbService.conversationMessageDB.markConversationMessagesBuffered(
        conversationId,
        [msgId],
        triggerActivityTick,
      );
    if (updated === 0) {
      return;
    }
    if (!triggerActivityTick) {
      return;
    }

    const effectiveTriggeredAt = triggeredAt ?? Date.now();
    const pendingCount = (
      await this.getPendingConversationWindowState(
        conversationId,
        effectiveTriggeredAt,
      )
    ).count;
    if (pendingCount < this.diaryUpdateEvery) {
      return;
    }

    const actorId = await this.getActorIdByConversation(conversationId);
    void runActorBackgroundJob(
      this.server,
      {
        actorId,
        conversationId,
        task: "conversation_rollup",
        prompt: await this.server.promptStore.loadTaskPrompt(
          "conversation-rollup",
        ),
      },
      effectiveTriggeredAt,
    ).catch((error) => {
      this.logger.error(
        "Failed to run actor conversation activity job:",
        error,
      );
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
    const items =
      await this.server.dbService.longTermMemoryDB.searchLongTermMemories({
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
    const items =
      await this.server.dbService.shortTermMemoryDB.listShortTermMemories({
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
        dayDate: item.dayDate,
        memory: item.memory,
        createdAt: item.createdAt ?? item.updatedAt ?? Date.now(),
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
    await this.server.dbService.shortTermMemoryDB.appendShortTermMemory({
      actorId,
      kind: item.kind,
      date: item.date,
      dayDate: item.dayDate,
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
      await this.server.dbService.shortTermMemoryDB.appendShortTermMemory({
        actorId,
        kind: item.kind,
        date: item.date,
        dayDate: item.dayDate,
        memory: item.memory,
        createdAt: item.createdAt,
        updatedAt: now,
        processedAt: item.processedAt,
      });
      return;
    }
    await this.server.dbService.shortTermMemoryDB.upsertShortTermMemory({
      id: existing[0].id,
      actorId,
      kind: item.kind,
      date: item.date,
      dayDate: item.dayDate ?? existing[0].dayDate,
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
   * @returns Number of memory records successfully marked as processed.
   */
  async markShortTermMemoryRecordsProcessed(
    actorId: number,
    ids: number[],
    processedAt: number,
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const records = await this.listShortTermMemories(actorId, {
      ids,
    });
    await Promise.all(
      records.map((record) =>
        this.server.dbService.shortTermMemoryDB.upsertShortTermMemory({
          id: record.id,
          actorId,
          kind: record.kind,
          date: record.date,
          dayDate: record.dayDate,
          memory: record.memory,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt ?? processedAt,
          processedAt,
        }),
      ),
    );
    return records.length;
  }

  /**
   * Tries to enter one running conversation-activity update for the conversation.
   * @param conversationId - The conversation identifier to guard.
   * @returns True when the caller acquired the running slot, false otherwise.
   */
  tryEnterConversationActivity(conversationId: number): boolean {
    if (this.runningConversationActivities.has(conversationId)) {
      return false;
    }
    this.runningConversationActivities.add(conversationId);
    return true;
  }

  /**
   * Leaves one running conversation-activity update for the conversation.
   * @param conversationId - The conversation identifier to release.
   */
  leaveConversationActivity(conversationId: number): void {
    this.runningConversationActivities.delete(conversationId);
  }

  /**
   * Tries to enter one running threshold activity-to-day rollup for the actor.
   * @param actorId - The actor identifier to guard.
   * @returns True when the caller acquired the running slot, false otherwise.
   */
  tryEnterActivityToDayRollup(actorId: number): boolean {
    if (this.runningActivityToDayRollups.has(actorId)) {
      return false;
    }
    this.runningActivityToDayRollups.add(actorId);
    return true;
  }

  /**
   * Leaves one running threshold activity-to-day rollup for the actor.
   * @param actorId - The actor identifier to release.
   */
  leaveActivityToDayRollup(actorId: number): void {
    this.runningActivityToDayRollups.delete(actorId);
  }

  /**
   * Gets the activity window used by prompts and rollups.
   * @param actorId - The actor identifier to read.
   * @param triggeredAt - Trigger timestamp in milliseconds.
   * @param limit - Maximum number of activity records to return.
   * @returns Activity records ordered from oldest to newest.
   */
  async getActivityWindow(
    actorId: number,
    triggeredAt: number,
    limit: number = this.activityWindowSize,
  ): Promise<ShortTermMemoryRecord[]> {
    const activities = await this.listShortTermMemories(actorId, {
      kind: "activity",
      createdBefore: triggeredAt,
      sort: "desc",
      limit,
    });
    return [...activities].reverse();
  }

  /**
   * Gets the pending-state summary for the current activity window.
   * @param actorId - The actor identifier to read.
   * @param triggeredAt - Trigger timestamp in milliseconds.
   * @returns Pending count plus the newest pending activity record id.
   */
  async getPendingActivityWindowState(
    actorId: number,
    triggeredAt: number,
  ): Promise<{ count: number; lastPendingId: number | null }> {
    const records = await this.getActivityWindow(actorId, triggeredAt);
    const pendingRecords = records.filter(
      (item) => typeof item.processedAt !== "number",
    );
    return {
      count: pendingRecords.length,
      lastPendingId: pendingRecords[pendingRecords.length - 1]?.id ?? null,
    };
  }

  /**
   * Returns whether any unprocessed activity belongs to a logical day before
   * the target awake day.
   * @param actorId - The actor identifier to read.
   * @param dayDate - Target awake day in YYYY-MM-DD format.
   */
  async hasUnprocessedActivityBeforeDay(
    actorId: number,
    dayDate: string,
  ): Promise<boolean> {
    const records = await this.listShortTermMemories(actorId, {
      kind: "activity",
      processed: false,
      sort: "desc",
    });
    return records.some((record) => (record.dayDate ?? record.date) < dayDate);
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
    return await this.server.dbService.longTermMemoryDB.appendLongTermMemory({
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
    const actor = await this.server.dbService.actorDB.getActor(actorId);
    if (!actor) {
      throw new Error(`Actor with ID ${actorId} not found.`);
    }
    const role = await this.server.dbService.roleDB.getRole(actor.roleId);
    const roleName = role?.name ?? `Role ${actor.roleId}`;
    return this.server.dbService.roleDB.upsertRole({
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
    return this.server.dbService.personalityDB.upsertPersonality({
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
    const userId =
      await this.server.dbService.userOwnActorDB.getActorOwner(actorId);
    if (userId === null) {
      return null;
    }
    const bindings =
      await this.server.dbService.externalIdentityBindingDB.listExternalIdentityBindings(
        {
          userId,
          channel,
        },
      );
    if (bindings[0]?.uid) {
      return bindings[0].uid;
    }
    return channel === "web" ? String(userId) : null;
  }

  private async getActorDisplayName(actorId: number): Promise<string> {
    const actor = await this.server.dbService.actorDB.getActor(actorId);
    if (!actor) {
      return `Actor ${actorId}`;
    }
    const role = await this.server.dbService.roleDB.getRole(actor.roleId);
    return role?.name ?? `Actor ${actorId}`;
  }
}
