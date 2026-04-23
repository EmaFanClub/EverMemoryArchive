/** Supported chat LLM providers. */
export type LLMProvider = "openai" | "google";

/** Supported embedding providers. */
export type EmbeddingProvider = "openai" | "google";

/** Runtime system configuration loaded from config.toml. */
export interface SystemConfig {
  readonly mode: "dev" | "prod";
  readonly dataRoot: string;
  readonly logsDir: string;
  readonly httpsProxy: string;
  readonly dev: SystemDevConfig;
}

/** Development-only runtime switches. */
export interface SystemDevConfig {
  readonly restoreDefaultSnapshot: boolean;
  readonly requireDevSeed: boolean;
}

/** MongoDB configuration. */
export interface MongoConfig {
  readonly kind: "memory" | "remote";
  readonly uri: string;
  readonly dbName: string;
}

/** Agent runtime configuration loaded from config.toml. */
export interface AgentConfig {
  readonly workspaceDir: string;
}

/** OpenAI-compatible chat LLM configuration. */
export interface OpenAILLMConfig {
  readonly mode: "chat" | "responses";
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

/** Google chat LLM configuration. */
export interface GoogleLLMConfig {
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly useVertexAi: boolean;
  readonly project: string;
  readonly location: string;
}

/** Complete chat LLM configuration used at runtime. */
export interface LLMConfig {
  readonly provider: LLMProvider;
  readonly openai: OpenAILLMConfig;
  readonly google: GoogleLLMConfig;
}

/** OpenAI embedding configuration. */
export interface OpenAIEmbeddingConfig {
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

/** Google embedding configuration. */
export interface GoogleEmbeddingConfig {
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly useVertexAi: boolean;
  readonly project: string;
  readonly location: string;
}

/** Complete embedding configuration used at runtime. */
export interface EmbeddingConfig {
  readonly provider: EmbeddingProvider;
  readonly openai: OpenAIEmbeddingConfig;
  readonly google: GoogleEmbeddingConfig;
}

/** Actor-scoped web search configuration. */
export interface WebSearchConfig {
  readonly enabled: boolean;
  readonly tavilyApiKey: string;
}

/** Actor-scoped channel configuration. */
export interface ChannelConfig {
  readonly qq: QQChannelConfig;
}

/** QQ channel configuration. */
export interface QQChannelConfig {
  readonly enabled: boolean;
  readonly wsUrl: string;
  readonly accessToken: string;
}

/** Supported identity binding channels in dev seed data. */
export type DevSeedChannel = "web" | "qq";

/** Supported conversation kinds in dev seed data. */
export type DevSeedConversationType = "chat" | "group";

/** Dev seed user entry. */
export interface DevSeedUser {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly description: string;
  readonly avatar: string;
}

/** Dev seed role entry. */
export interface DevSeedRole {
  readonly id: number;
  readonly name: string;
  readonly prompt: string;
}

/** Dev seed actor entry. */
export interface DevSeedActor {
  readonly id: number;
  readonly roleId: number;
  readonly llmConfig?: LLMConfig;
  readonly webSearchConfig?: WebSearchConfig;
  readonly channelConfig?: ChannelConfig;
}

/** Dev seed ownership relation. */
export interface DevSeedUserOwnActor {
  readonly userId: number;
  readonly actorId: number;
}

/** Dev seed external identity binding. */
export interface DevSeedIdentityBinding {
  readonly userId: number;
  readonly channel: DevSeedChannel;
  readonly uid: string;
}

/** Dev seed conversation entry. */
export interface DevSeedConversation {
  readonly actorId: number;
  readonly channel: DevSeedChannel;
  readonly type: DevSeedConversationType;
  readonly uid: string;
  readonly name: string;
  readonly description: string;
  readonly allowProactive: boolean;
}

/** Development bootstrap seed loaded from config/dev.seed.json. */
export interface DevSeedConfig {
  readonly users: readonly DevSeedUser[];
  readonly roles: readonly DevSeedRole[];
  readonly actors: readonly DevSeedActor[];
  readonly userOwnActors: readonly DevSeedUserOwnActor[];
  readonly identityBindings: readonly DevSeedIdentityBinding[];
  readonly conversations: readonly DevSeedConversation[];
}

/** Hardcoded maximum number of agent loop steps. */
export const DEFAULT_AGENT_MAX_STEPS = 50;

/** Hardcoded token limit for agent context management. */
export const DEFAULT_AGENT_TOKEN_LIMIT = 80000;

/** Default OpenAI base URL. */
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Default Google Generative AI base URL. */
export const DEFAULT_GOOGLE_BASE_URL =
  "https://generativelanguage.googleapis.com";

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  mode: "dev",
  dataRoot: ".data",
  logsDir: "logs",
  httpsProxy: "",
  dev: {
    restoreDefaultSnapshot: true,
    requireDevSeed: true,
  },
};

export const DEFAULT_MONGO_CONFIG: MongoConfig = {
  kind: "memory",
  uri: "mongodb://localhost:27017",
  dbName: "ema",
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  workspaceDir: "workspace",
};

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: "google",
  openai: {
    mode: "responses",
    model: "gpt-5.4",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    apiKey: "",
  },
  google: {
    model: "gemini-3.1-pro-preview",
    baseUrl: DEFAULT_GOOGLE_BASE_URL,
    apiKey: "",
    useVertexAi: false,
    project: "",
    location: "",
  },
};

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "google",
  openai: {
    model: "text-embedding-3-large",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    apiKey: "",
  },
  google: {
    model: "gemini-embedding-001",
    baseUrl: DEFAULT_GOOGLE_BASE_URL,
    apiKey: "",
    useVertexAi: false,
    project: "",
    location: "",
  },
};

export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
  enabled: false,
  tavilyApiKey: "",
};

export const DEFAULT_CHANNEL_CONFIG: ChannelConfig = {
  qq: {
    enabled: false,
    wsUrl: "ws://127.0.0.1:3001",
    accessToken: "",
  },
};

export const DEFAULT_DEV_SEED: DevSeedConfig = {
  users: [
    {
      id: 1,
      name: "alice",
      email: "alice@example.com",
      description: "",
      avatar: "",
    },
  ],
  roles: [
    {
      id: 1,
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
    },
  ],
  actors: [
    {
      id: 1,
      roleId: 1,
    },
  ],
  userOwnActors: [
    {
      userId: 1,
      actorId: 1,
    },
  ],
  identityBindings: [
    {
      userId: 1,
      channel: "web",
      uid: "1",
    },
  ],
  conversations: [
    {
      actorId: 1,
      channel: "web",
      type: "chat",
      uid: "1",
      name: "Default",
      description: "这是你和你的拥有者之间在网页端私聊的对话。",
      allowProactive: false,
    },
  ],
};

/** Returns a detached copy of a JSON-like config object. */
export function cloneConfig<T>(value: T): T {
  return structuredClone(value);
}
