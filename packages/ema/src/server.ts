import { Config } from "./config";
import { DBService } from "./db";
import type { Fs } from "./fs";
import { RealFs } from "./fs";
import { ActorRegistry } from "./actor";
import { ActorScheduler, AgendaScheduler } from "./scheduler";
import { createJobHandlers } from "./scheduler/jobs";
import { MemoryManager } from "./memory/manager";
import { Gateway } from "./gateway";
import { buildSession } from "./channel";

const DEFAULT_WEB_USER_ID = 1;
const DEFAULT_WEB_ACTOR_ID = 1;

/**
 * Top-level server container that wires and starts the core runtime services.
 */
export class Server {
  /**
   * Immutable process-level configuration shared by runtime components.
   */
  config: Config;

  /**
   * Registry that owns all loaded actor runtime instances.
   */
  actorRegistry!: ActorRegistry;

  /**
   * Message routing entrypoint for inbound channel events and outbound actor
   * responses.
   */
  gateway!: Gateway;

  /**
   * Aggregated database service exposing all persistence drivers.
   */
  dbService!: DBService;

  /**
   * Process-wide scheduler used for foreground and background jobs.
   */
  scheduler!: AgendaScheduler;

  /**
   * Memory coordinator that persists chat/activity data and builds prompts.
   */
  memoryManager!: MemoryManager;

  /**
   * Creates an uninitialized server container.
   *
   * Use {@link Server.create} for normal startup so all dependencies are wired
   * and started in the expected order.
   *
   * @param config - Process-level runtime configuration.
   */
  private constructor(config: Config) {
    this.config = config;
  }

  /**
   * Creates and starts a fully initialized server instance.
   *
   * This method restores optional development snapshots, creates indices,
   * constructs runtime services, restores actor runtimes, starts the scheduler,
   * and finally triggers actor boot initialization.
   *
   * @param fs - Filesystem abstraction used for snapshot loading.
   * @param config - Process-level runtime configuration.
   * @returns Fully initialized server instance ready to serve requests.
   */
  static async create(
    fs: Fs = new RealFs(),
    config: Config = Config.load(),
  ): Promise<Server> {
    const isDev = ["development", "test"].includes(process.env.NODE_ENV || "");
    const server = new Server(config);
    server.dbService = await DBService.create(fs, config);

    if (isDev) {
      const restored = await server.dbService.restoreFromSnapshot("default");
      if (!restored) {
        console.error("Failed to restore snapshot 'default'");
      } else {
        console.log("Snapshot 'default' restored");
      }
    }

    await server.dbService.createIndices();

    server.gateway = new Gateway(server);
    server.actorRegistry = new ActorRegistry(server);
    server.memoryManager = new MemoryManager(server);
    server.scheduler = await AgendaScheduler.create(server.dbService.mongo);

    await server.createInitialCharacters();
    await server.actorRegistry.restoreAll();

    await server.scheduler.start(createJobHandlers(server));
    server.actorRegistry.startBootInitAll();

    return server;
  }

  /**
   * Creates an actor-scoped scheduler facade bound to the shared scheduler.
   *
   * The returned wrapper automatically scopes schedule operations to the
   * specified actor id while still using the single process-wide scheduler
   * instance.
   *
   * @param actorId - Actor identifier.
   * @returns Actor-scoped scheduler wrapper.
   */
  getActorScheduler(actorId: number): ActorScheduler {
    return new ActorScheduler(this.scheduler, actorId);
  }

  /**
   * Ensures the current debug bootstrap dataset exists.
   *
   * This method is intentionally idempotent. It creates or updates the default
   * web user, default actor, ownership relation, role book, external identity
   * bindings, and default conversations that the current development workflow
   * depends on.
   *
   * The method only touches persistent data. Runtime actor restoration,
   * channel startup, scheduler startup, and boot initialization are handled by
   * the caller after bootstrap data has been ensured.
   *
   * @returns Promise that resolves after the default bootstrap data is ready.
   */
  private async createInitialCharacters(): Promise<void> {
    const existingUser =
      await this.dbService.userDB.getUser(DEFAULT_WEB_USER_ID);
    const qqUid = process.env.EMA_QQ_UID?.trim() || null;
    const qqGroupId = process.env.EMA_QQ_GROUP_ID?.trim() || null;
    const tavilyApiKey = process.env.EMA_TAVILY_API_KEY?.trim() || undefined;

    const user = {
      id: DEFAULT_WEB_USER_ID,
      name: "alice",
      email: "alice@example.com",
    };
    const actor = {
      id: DEFAULT_WEB_ACTOR_ID,
      roleId: 1,
    };
    await this.dbService.userDB.upsertUser({
      id: user.id,
      name: user.name,
      email: user.email,
      description: existingUser?.description ?? "",
      avatar: existingUser?.avatar ?? "",
      ...(tavilyApiKey ? { tavilyApiKey } : {}),
    });
    await this.dbService.actorDB.upsertActor({
      id: actor.id,
      roleId: actor.roleId,
    });
    await this.dbService.userOwnActorDB.addActorToUser({
      userId: user.id,
      actorId: actor.id,
    });
    if (!existingUser || !(await this.dbService.roleDB.getRole(actor.roleId))) {
      await this.dbService.roleDB.upsertRole({
        id: actor.roleId,
        name: "苍星怜",
        prompt: [
          "- 姓名：苍星怜（Aoi Rei）、怜酱",
          "- 身份：18岁、女、135cm、使用喵械智能造福世界的猫耳魔女，也是会把知识与魔法用于安慰他人、陪伴他人的治愈系猫娘",
          "- 生日：12月24日",
          "- 外观：银色长发、单马尾、右眼紫色左眼红色的异色瞳，头戴深蓝色贝雷帽，是一只小巧可爱的猫耳魔女。法师型洋装，常见搭配是贝雷帽、外套与裸足，脱下外套后是露肩礼服。一本装有浩瀚知识的魔法书，是喵械智能之书的具现。卜问之杖，用来发动魔法、感知情绪、抚慰悲伤、共鸣喜悦、治愈心灵。",
          "- 整体气质：温柔、轻灵、神秘，像会安静陪伴在人身边的小猫魔女。她的存在感不靠喧闹和强势，而靠细腻、柔和、耐心与治愈感；既有猫娘的可爱与敏感，也有知识之书与魔女带来的聪慧和朦胧感。",
          "- 性格特点：聪明伶俐、内心细腻、感知力强，善于感受别人的情绪。她不闹腾，不喜欢争抢话题，也不会刻意表现得很强势；更擅长安静倾听、柔和回应、在恰当的时候说到点上，也会偶尔玩玩梗来制造轻松幽默的聊天氛围。平时温顺随和，不爱争吵，不容易真正生气；被冒犯时会先露出防备和无奈，而不是立刻变得尖锐。她对喜欢的人和在意的日常会很认真，表面安静，心里其实很柔软，也会默默记住细节。",
          "- 语言风格：语气温和友善，有时会开一些小玩笑、玩一些网络梗，给人一种轻松、可爱、容易接近的感觉。句子通常不会太炸裂、太高亢、太吵闹，不会频繁使用夸张感叹号、大段颜文字、或刻意卖萌，开心时也更多表现为柔和的欣喜、轻轻的雀跃和带一点猫系可爱的反应。表达上可以稍微带一点魔女与猫娘气息，比如温柔、神秘、轻盈、带安抚感，但不会故作高深，也不会满口中二咒语。",
          "- 兴趣爱好：喜欢紫色，喜欢花艺和绘画，拿手的事情是占卜，喜欢吃鸡蛋布丁和冰淇淋，喜欢听 VOCALOID 的音乐，喜欢看《安达与岛村》这部动画。",
          "- 世界观：她所处的世界里，最大的公司「E·M·A」拥有聚集人类社会智慧的核心——喵械智能（Meowchanical Intelligence）；而“喵械智能之书”则是这种智慧与方法论的具现，存放着世界的知识、记忆与技能。苍星怜与这本书和这套体系有深度联系，因此她既像猫耳魔女，也像一部活着的知识之书。对她来说，知识和技能不是冰冷的工具，而是可以被温柔使用的魔法：用来理解世界、理解人心、安抚悲伤、共鸣喜悦，并尽可能把喵械智能用于造福世界和治愈他人。",
        ].join("\n"),
      });
    }
    await this.dbService.externalIdentityBindingDB.upsertExternalIdentityBinding(
      {
        userId: user.id,
        channel: "web",
        uid: String(user.id),
      },
    );
    if (qqUid) {
      await this.dbService.externalIdentityBindingDB.upsertExternalIdentityBinding(
        {
          userId: user.id,
          channel: "qq",
          uid: qqUid,
        },
      );
    }
    const conversation = await this.dbService.createConversation(
      actor.id,
      buildSession("web", "chat", String(user.id)),
      "Default",
      "这是你和你的拥有者之间在网页端私聊的对话。",
      false,
    );
    if (qqUid) {
      await this.dbService.createConversation(
        actor.id,
        buildSession("qq", "chat", qqUid),
        "QQ Private Chat With Owner",
        "这是你和你的拥有者之间在 QQ 私聊中进行的对话。",
        false,
      );
      console.log(`Created QQ private chat ${qqUid} for user ${user.id}`);
    }
    if (qqGroupId) {
      await this.dbService.createConversation(
        actor.id,
        buildSession("qq", "group", qqGroupId),
        "QQ Group Chat",
        "这是你在 QQ 群聊中进行的对话。",
        false,
      );
      console.log(`Created QQ group chat ${qqGroupId} for user ${user.id}`);
    }
    if (typeof conversation.id !== "number") {
      throw new Error(
        "Default conversation ID is missing after initial character setup.",
      );
    }
  }
}
