import {
  createBootstrapConfig,
  DEFAULT_CHANNEL_CONFIG,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_LLM_CONFIG,
  DEFAULT_WEB_SEARCH_CONFIG,
  GlobalConfig,
  type GlobalConfigRecord,
} from "../../config/index";
import { buildSession } from "../../channel";
import type { DBService } from "../../db";
import { MemFs } from "../../shared/fs";

export function createTestGlobalConfigRecord(
  overrides: Partial<GlobalConfigRecord> = {},
): GlobalConfigRecord {
  const now = Date.now();
  return {
    id: "global",
    version: 1,
    system: {
      httpsProxy: "",
    },
    defaultLlm: DEFAULT_LLM_CONFIG,
    defaultEmbedding: DEFAULT_EMBEDDING_CONFIG,
    defaultWebSearch: DEFAULT_WEB_SEARCH_CONFIG,
    defaultChannel: DEFAULT_CHANNEL_CONFIG,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Loads bootstrap and database-backed GlobalConfig into a test process. */
export async function loadTestGlobalConfig(
  fs: MemFs = new MemFs(),
): Promise<MemFs> {
  GlobalConfig.resetForTests();
  const bootstrap = createBootstrapConfig({ mode: "dev", mongoKind: "memory" });
  await GlobalConfig.load(fs, { bootstrap });
  GlobalConfig.applyRecord(createTestGlobalConfigRecord());
  return fs;
}

/** Creates a minimal actor-owned web conversation fixture for runtime tests. */
export async function createTestActorFixture(dbService: DBService) {
  await dbService.userDB.upsertUser({
    id: 1,
    name: "alice",
    description: "",
    avatar: "",
  });
  await dbService.roleDB.upsertRole({
    id: 1,
    name: "苍星怜",
    prompt: "测试角色设定。",
  });
  await dbService.actorDB.upsertActor({
    id: 1,
    roleId: 1,
    enabled: true,
  });
  await dbService.userOwnActorDB.addActorToUser({
    userId: 1,
    actorId: 1,
  });
  await dbService.externalIdentityBindingDB.upsertExternalIdentityBinding({
    userId: 1,
    channel: "web",
    uid: "1",
  });
  return await dbService.createConversation(
    1,
    buildSession("web", "chat", "1"),
    "和alice的网页聊天",
    "",
    true,
  );
}
