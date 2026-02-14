import type {
  ActorMemory,
  ActorState,
  ActorStateStorage,
  BufferMessage,
  BufferStorage,
  LongTermMemory,
  LongTermMemoryRecord,
  ShortTermMemory,
  ShortTermMemoryRecord,
} from "./base";
import type { ActorScope } from "../actor";
import type {
  ActorDB,
  ConversationMessageDB,
  LongTermMemoryDB,
  LongTermMemorySearcher,
  RoleDB,
  ShortTermMemoryDB,
  UserDB,
  UserOwnActorDB,
  ConversationDB,
} from "../db";
import type { AgendaScheduler } from "../scheduler";
import { bufferMessageToPrompt } from "./utils";

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
  /**
   * Creates a new MemoryManager instance.
   * @param roleDB - Role persistence interface.
   * @param actorDB - Actor persistence interface.
   * @param userDB - User persistence interface.
   * @param userOwnActorDB - User-actor relation persistence interface.
   * @param conversationDB - Conversation persistence interface.
   * @param conversationMessageDB - Conversation message persistence interface.
   * @param shortTermMemoryDB - Short-term memory persistence interface.
   * @param longTermMemoryDB - Long-term memory persistence interface.
   * @param longTermMemorySearcher - Long-term memory search interface.
   * @param scheduler - Scheduler instance for background jobs.
   */
  constructor(
    private readonly roleDB: RoleDB,
    private readonly actorDB: ActorDB,
    private readonly userDB: UserDB,
    private readonly userOwnActorDB: UserOwnActorDB,
    private readonly conversationDB: ConversationDB,
    private readonly conversationMessageDB: ConversationMessageDB,
    private readonly shortTermMemoryDB: ShortTermMemoryDB,
    private readonly longTermMemoryDB: LongTermMemoryDB,
    private readonly longTermMemorySearcher: LongTermMemorySearcher,
    private readonly scheduler?: AgendaScheduler,
  ) {}

  /**
   * Resolves the actor scope for a conversation.
   * @param conversationId - The conversation identifier to resolve.
   * @returns The actor scope if the conversation exists, otherwise null.
   */
  async getActorScope(conversationId: number): Promise<ActorScope> {
    const conversation =
      await this.conversationDB.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation with ID ${conversationId} not found.`);
    }
    return {
      actorId: conversation.actorId,
      userId: conversation.userId,
      conversationId,
    };
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
   * Builds the system prompt by injecting short-term memory and buffer history.
   *
   * The placeholders `{MEMORY_YEAR}`, `{MEMORY_MONTH}`, `{MEMORY_WEEK}`,
   * `{MEMORY_DAY}`, and `{MEMORY_BUFFER}` are replaced with the latest
   * short-term memories and formatted buffer lines. If a placeholder is
   * missing, the original template is returned unchanged for that field.
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
    const bufferText =
      state.buffer.length === 0
        ? "None."
        : state.buffer.map((item) => bufferMessageToPrompt(item)).join("\n");
    return systemPrompt
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
    const messages = await this.conversationMessageDB.listConversationMessages({
      conversationId,
      limit: count,
      sort: "desc",
    });
    const buffer = await Promise.all<BufferMessage>(
      [...messages].reverse().map(async (item) => {
        const message = item.message;
        if (message.kind === "user") {
          return {
            kind: "user" as const,
            role_id: message.userId,
            msg_id: item.id,
            contents: message.contents,
            time: item.createdAt ?? Date.now(),
          };
        }
        return {
          kind: "actor" as const,
          role_id: message.actorId,
          msg_id: item.id,
          contents: message.contents,
          time: item.createdAt ?? Date.now(),
        };
      }),
    );
    return buffer;
  }

  /**
   * Adds a buffer message.
   * @param conversationId - The conversation identifier to write.
   * @param message - The buffer message to add.
   */
  async addBuffer(
    conversationId: number,
    message: BufferMessage,
  ): Promise<void> {
    const current =
      this.messageCounter.get(conversationId) ??
      (await this.conversationMessageDB.countConversationMessages(
        conversationId,
      ));
    const payload =
      message.kind === "user"
        ? { kind: "user" as const, userId: message.role_id }
        : { kind: "actor" as const, actorId: message.role_id };
    const msgId = await this.conversationMessageDB.addConversationMessage({
      conversationId,
      message: {
        ...payload,
        contents: message.contents,
      },
      createdAt: message.time,
    });
    message.msg_id = msgId;
    this.messageCounter.set(conversationId, current + 1);
    if ((current + 1) % this.diaryUpdateEvery === 0) {
      if (!this.scheduler) {
        return;
      }
      // Schedule an immediate background task to organize memory.
      const actorScope = await this.getActorScope(conversationId);
      const actorState = await this.getState(
        actorScope.actorId,
        conversationId,
      );
      const prompt = [
        "<task>",
        "根据近期对话(Recent Conversation)中的内容和日记(Day)的内容更新日记。",
        "</task>",
        "",
        "<instructions>",
        "1) 调用 get_skill 读取技能说明，并严格按其要求执行。",
        "2) 基于当前已有的短期记忆和对话历史，生成更新后的日记内容。",
        "3) 在更新完后，可以调用 get_skill 查看技能 update-long-term-memory-skill 来决定是否需要将部分内容存入长期记忆。",
        "4) 这是一个后台任务，更新完后不要产生任何额外的回复和输出。",
        "</instructions>",
        "",
        "<constraints>",
        "- 只允许更新日记部分。",
        "- 禁止修改 Year / Month / Week。",
        "- 不得编造不存在于短期记忆或近期对话中的事实。",
        "</constraints>",
      ].join("\n");
      await this.scheduler.schedule({
        name: "actor_background",
        runAt: Date.now() + 1000,
        data: {
          actorScope,
          actorState,
          prompt: prompt,
        },
      });
    }
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
}
