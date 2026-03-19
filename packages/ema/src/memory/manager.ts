import type {
  ActorMemory,
  ActorState,
  ActorStateStorage,
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
  ConversationMessageDB,
  ExternalIdentityBindingDB,
  LongTermMemoryDB,
  LongTermMemorySearcher,
  PersonalityDB,
  RoleDB,
  ShortTermMemoryDB,
  UserDB,
  UserOwnActorDB,
  ConversationDB,
} from "../db";
import type { AgendaScheduler } from "../scheduler";
import { EMA_DIALOGUE_TICK_PROMPT } from "./prompts";
import {
  buildPromptFromBufferMessage,
  isActorChatInput,
  isActorChatResponse,
} from "./utils";
import { parseReplyRef, resolveSession } from "../channel";

/**
 * Memory manager implementation backed by database interfaces.
 */
export class MemoryManager
  implements BufferStorage, ActorStateStorage, ActorMemory
{
  /** Number of buffer additions required before triggering diary update. */
  readonly bufferWindowSize = 30;
  readonly diaryUpdateEvery = 20;
  private readonly messageCounter = new Map<number, number>();
  private readonly shortTermUpdateLocks = new Map<number, Promise<void>>();
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
   * @param scheduler - Scheduler instance for background jobs.
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
    private readonly scheduler?: AgendaScheduler,
  ) {}

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
   * Gets the state of the actor.
   * @param actorId - The actor identifier to read.
   * @returns The state of the actor.
   */
  async getState(actorId: number, conversationId: number): Promise<ActorState> {
    const [memoryDay, memoryWeek, memoryMonth, memoryYear, buffer] =
      await Promise.all([
        this.getShortTermMemory(actorId, "day", 1),
        this.getShortTermMemory(actorId, "week", 1),
        this.getShortTermMemory(actorId, "month", 1),
        this.getShortTermMemory(actorId, "year", 1),
        this.getBuffer(conversationId, this.bufferWindowSize),
      ]);
    return {
      memoryDay: memoryDay[0] ?? { kind: "day", memory: "None." },
      memoryWeek: memoryWeek[0] ?? { kind: "week", memory: "None." },
      memoryMonth: memoryMonth[0] ?? { kind: "month", memory: "None." },
      memoryYear: memoryYear[0] ?? { kind: "year", memory: "None." },
      buffer,
    };
  }

  /**
   * Builds the system prompt by injecting role/personality markdown, short-term memory, and buffer history.
   *
   * The placeholders `{ROLE_PROMPT}`, `{PERSONALITY_MEMORY}`, `{MEMORY_YEAR}`,
   * `{MEMORY_MONTH}`, `{MEMORY_WEEK}`, `{MEMORY_DAY}`, and `{MEMORY_BUFFER}`
   * are replaced with the latest data. If a placeholder is missing, the
   * original template is returned unchanged for that field.
   *
   * @param actorId - The actor identifier to read short-term memories.
   * @param conversationId - The conversation identifier to read buffer messages.
   * @param systemPrompt - The system prompt template containing memory placeholders.
   * @param actorState - Optional preloaded actor state to avoid extra queries.
   * @returns The system prompt with memory injected.
   */
  async buildSystemPrompt(
    actorId: number,
    conversationId: number,
    systemPrompt: string,
    actorState?: ActorState,
  ): Promise<string> {
    const state = actorState ?? (await this.getState(actorId, conversationId));
    const [actor, personality, conversation] = await Promise.all([
      this.actorDB.getActor(actorId),
      this.personalityDB.getPersonality(actorId),
      this.conversationDB.getConversation(conversationId),
    ]);
    const role = actor?.roleId ? await this.roleDB.getRole(actor.roleId) : null;
    const rolePrompt = role?.prompt ?? "None.";
    const personalityMemory = personality?.memory ?? "None.";
    const conversationDescription = conversation?.description ?? "None.";
    const sessionInfo = conversation
      ? resolveSession(conversation.session)
      : null;
    const ownerUid = sessionInfo
      ? await this.getOwnerUid(actorId, sessionInfo.channel)
      : null;
    const bufferText =
      state.buffer.length === 0
        ? "None."
        : state.buffer
            .map((item) => buildPromptFromBufferMessage(item, ownerUid))
            .join("\n");
    return systemPrompt
      .replaceAll("{ROLE_PROMPT}", rolePrompt)
      .replaceAll("{PERSONALITY_MEMORY}", personalityMemory)
      .replaceAll("{CONVERSATION_DESCRIPTION}", conversationDescription)
      .replaceAll("{MEMORY_YEAR}", state.memoryYear.memory)
      .replaceAll("{MEMORY_MONTH}", state.memoryMonth.memory)
      .replaceAll("{MEMORY_WEEK}", state.memoryWeek.memory)
      .replaceAll("{MEMORY_DAY}", state.memoryDay.memory)
      .replaceAll("{MEMORY_BUFFER}", bufferText);
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
   * Adds a buffer message without scheduling background memory updates.
   * @param message - The buffer message to add.
   * @returns The total number of persisted conversation messages after insertion.
   */
  async addBufferWithoutScheduling(
    message: BufferWriteMessage,
  ): Promise<number> {
    const { nextCount } = await this.persistBufferWriteMessage(message);
    return nextCount;
  }

  /**
   * Adds a buffer message and schedules online memory updates when needed.
   * @param message - The buffer message to add.
   */
  async addBuffer(message: BufferWriteMessage): Promise<void> {
    const { actorId, nextCount, conversationId } =
      await this.persistBufferWriteMessage(message);
    if (nextCount % this.diaryUpdateEvery === 0) {
      if (!this.scheduler) {
        return;
      }
      // Schedule an immediate background task to organize memory.
      const actorState = await this.getState(actorId, conversationId);
      await this.scheduler.schedule({
        name: "actor_background",
        runAt: Date.now() + 1000,
        data: {
          actorId,
          conversationId,
          actorState,
          prompt: EMA_DIALOGUE_TICK_PROMPT,
          updateMemoryKinds: ["day"],
        },
      });
    }
  }

  /**
   * Persists a single buffer-write message and updates local message counters.
   * @param message - The runtime message to add.
   * @returns The resolved actor scope and updated message count.
   */
  private async persistBufferWriteMessage(
    message: BufferWriteMessage,
  ): Promise<{ actorId: number; conversationId: number; nextCount: number }> {
    const conversationId = message.conversationId;
    const actorId = await this.getActorIdByConversation(conversationId);
    const current =
      this.messageCounter.get(conversationId) ??
      (await this.conversationMessageDB.countConversationMessages(
        conversationId,
      ));
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
          contents: [
            ...(message.ema_reply.mention_uids ?? []).map((uid) => ({
              type: "text" as const,
              text: `@(${uid})`,
            })),
            {
              type: "text" as const,
              text: message.ema_reply.contents,
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
      resumed: isActorChatResponse(message),
      message: payload,
      createdAt: message.time,
      msgId: message.msgId,
    });
    const nextCount = Math.max(current, message.msgId);
    this.messageCounter.set(conversationId, nextCount);
    return {
      actorId,
      conversationId,
      nextCount,
    };
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
      };
    });
  }

  /**
   * Lists short term memories for the actor.
   * @param actorId - The actor identifier to query.
   * @param kind - Optional memory kind filter.
   * @param limit - Optional maximum number of memories to return.
   * @returns The short term memories sorted by newest first.
   */
  async getShortTermMemory(
    actorId: number,
    kind?: ShortTermMemory["kind"],
    limit?: number,
  ): Promise<ShortTermMemoryRecord[]> {
    const items = await this.shortTermMemoryDB.listShortTermMemories({
      actorId,
      kind,
      sort: "desc",
      limit,
    });
    return items.map((item) => {
      if (typeof item.id !== "number") {
        throw new Error("ShortTermMemory record is missing id");
      }
      return {
        id: item.id,
        kind: item.kind,
        memory: item.memory,
        createdAt: item.createdAt ?? Date.now(),
      };
    });
  }

  /**
   * Adds a short-term memory item to the actor.
   * @param actorId - The actor identifier to update.
   * @param item - The short-term memory item to add.
   */
  async addShortTermMemory(
    actorId: number,
    item: ShortTermMemory,
  ): Promise<void> {
    await this.shortTermMemoryDB.appendShortTermMemory({
      actorId,
      ...item,
    });
  }

  /**
   * Upserts the latest short-term memory bucket of the same kind.
   * @param actorId - The actor identifier to update.
   * @param item - The short-term memory item to write.
   */
  async upsertLatestShortTermMemory(
    actorId: number,
    item: ShortTermMemory,
  ): Promise<void> {
    await this.withShortTermUpdateLock(actorId, async () => {
      const latest = await this.getShortTermMemory(actorId, item.kind, 1);
      const now = Date.now();
      if (latest.length === 0) {
        await this.shortTermMemoryDB.appendShortTermMemory({
          actorId,
          kind: item.kind,
          memory: item.memory,
          messages: item.messages,
          updatedAt: now,
        });
      } else {
        await this.shortTermMemoryDB.upsertShortTermMemory({
          id: latest[0].id,
          actorId,
          kind: item.kind,
          memory: item.memory,
          messages: item.messages,
          createdAt: latest[0].createdAt,
          updatedAt: now,
        });
      }

      await this.rolloverAfterShortTermUpdate(actorId, item.kind);
    });
  }

  /**
   * Rolls over the lower-level short-term memory bucket after update.
   * @param actorId - The actor identifier to update.
   * @param kind - Updated short-term memory kind.
   */
  private async rolloverAfterShortTermUpdate(
    actorId: number,
    kind: ShortTermMemory["kind"],
  ): Promise<void> {
    let targetKind: ShortTermMemory["kind"] | null = null;
    switch (kind) {
      case "week":
        targetKind = "day";
        break;
      case "month":
        targetKind = "week";
        break;
      case "year":
        targetKind = "month";
        break;
      default:
        targetKind = null;
    }
    if (!targetKind) {
      return;
    }
    const latest = await this.getShortTermMemory(actorId, targetKind, 1);
    if (
      latest.length > 0 &&
      this.isEmptyShortTermMemoryText(latest[0].memory)
    ) {
      return;
    }
    await this.shortTermMemoryDB.appendShortTermMemory({
      actorId,
      kind: targetKind,
      memory: "None.",
      updatedAt: Date.now(),
    });
  }

  /**
   * Checks whether the memory text is considered empty.
   * @param memory - Memory text to inspect.
   * @returns True if empty.
   */
  private isEmptyShortTermMemoryText(memory: string): boolean {
    const normalized = memory.trim();
    return normalized.length === 0 || normalized === "None.";
  }

  /**
   * Serializes short-term memory updates for the same actor.
   * @param actorId - The actor identifier.
   * @param fn - Update logic to execute under lock.
   * @returns The callback result.
   */
  private async withShortTermUpdateLock<T>(
    actorId: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.shortTermUpdateLocks.get(actorId) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => current);
    this.shortTermUpdateLocks.set(actorId, chain);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.shortTermUpdateLocks.get(actorId) === chain) {
        this.shortTermUpdateLocks.delete(actorId);
      }
    }
  }

  /**
   * Adds a long-term memory item to the actor.
   * @param actorId - The actor identifier to update.
   * @param item - The long-term memory item to add.
   */
  async addLongTermMemory(
    actorId: number,
    item: LongTermMemory,
  ): Promise<void> {
    await this.longTermMemoryDB.appendLongTermMemory({
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
