import { afterEach, describe, expect, test, vi } from "vitest";

import type { ActorEntity } from "../../db";
import { createBootstrapConfig, GlobalConfig } from "../../config";
import { createTestGlobalConfigRecord } from "../../config/tests/helpers";
import { ThinkingLevel } from "../../llm";
import { MemFs } from "../../shared/fs";
import { SettingsController } from "../settings_controller";

type PersistedActor = ActorEntity & { id: number };

const validLlmConfig = {
  model: "gpt-5.5",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  thinkingLevel: ThinkingLevel.MEDIUM,
} as const;

const validEmbeddingConfig = {
  model: "gemini-embedding-2",
  baseUrl: "https://generativelanguage.googleapis.com",
  apiKey: "gemini-key",
} as const;

function createFixture() {
  const actors = new Map<number, PersistedActor>([
    [1, { id: 1, roleId: 1, enabled: false }],
  ]);
  let globalConfig = createTestGlobalConfigRecord();
  const actorDB = {
    getActor: vi.fn(async (actorId: number) => actors.get(actorId) ?? null),
    upsertActor: vi.fn(async (actor: PersistedActor) => {
      actors.set(actor.id, { ...actor });
      return actor.id;
    }),
    clearActorLlmConfig: vi.fn(async (actorId: number) => {
      const actor = actors.get(actorId);
      if (!actor) {
        return false;
      }
      const { llmConfig: _llmConfig, ...nextActor } = actor;
      actors.set(actorId, nextActor);
      return true;
    }),
  };
  const globalConfigDB = {
    getGlobalConfig: vi.fn(async () => globalConfig),
    upsertGlobalConfig: vi.fn(async (record: typeof globalConfig) => {
      globalConfig = { ...record };
    }),
  };
  const longTermMemoryDB = {
    getVectorIndexStatus: vi.fn(() => ({
      state: "ready",
      activeFingerprint: "active",
      activeProvider: "google",
      activeModel: "gemini-embedding-001",
    })),
  };
  const publishUpdated = vi.fn(async () => {});
  const server = {
    dbService: { actorDB, globalConfigDB, longTermMemoryDB },
    controller: {
      actor: {
        publishUpdated,
      },
    },
  };
  return {
    controller: new SettingsController(server as never),
    actors,
    actorDB,
    getGlobalConfig: () => globalConfig,
    globalConfigDB,
    longTermMemoryDB,
    publishUpdated,
  };
}

describe("SettingsController", () => {
  afterEach(() => {
    GlobalConfig.resetForTests();
  });

  test("lists AgentHub LLM model options for API clients", () => {
    const fixture = createFixture();

    expect(fixture.controller.listLlmModels()).toContainEqual({
      model: "gemini-3.1-pro-preview",
      provider: "google",
      defaultBaseUrl: "https://generativelanguage.googleapis.com",
      capabilities: {
        thinkingLevels: [
          ThinkingLevel.LOW,
          ThinkingLevel.MEDIUM,
          ThinkingLevel.HIGH,
        ],
        tools: true,
        images: true,
      },
      requestDefaults: {
        thinkingLevel: ThinkingLevel.MEDIUM,
      },
    });
  });

  test("lists AgentHub embedding model options for API clients", () => {
    const fixture = createFixture();

    expect(fixture.controller.listEmbeddingModels()).toContainEqual({
      model: "gemini-embedding-2",
      provider: "google",
      defaultBaseUrl: "https://generativelanguage.googleapis.com",
      capabilities: {
        dimensions: [768, 1536, 3072],
      },
      requestDefaults: {
        dimensions: 3072,
      },
    });
  });

  test("saves actor LLM config without probing the provider", async () => {
    const fixture = createFixture();
    const probe = vi
      .spyOn(fixture.controller, "probeLlmConfig")
      .mockRejectedValue(new Error("probe should not run"));

    await expect(
      fixture.controller.saveLlmConfig(1, validLlmConfig),
    ).resolves.toEqual(validLlmConfig);

    expect(probe).not.toHaveBeenCalled();
    expect(fixture.actors.get(1)?.llmConfig).toEqual(validLlmConfig);
    expect(fixture.publishUpdated).toHaveBeenCalledWith(1);
  });

  test("clears actor LLM config to use global defaults", async () => {
    const fixture = createFixture();
    fixture.actors.set(1, {
      id: 1,
      roleId: 1,
      enabled: false,
      llmConfig: validLlmConfig,
    });

    await expect(fixture.controller.saveLlmConfig(1, null)).resolves.toBeNull();

    expect(fixture.actorDB.clearActorLlmConfig).toHaveBeenCalledWith(1);
    expect(fixture.actors.get(1)?.llmConfig).toBeUndefined();
    expect(fixture.publishUpdated).toHaveBeenCalledWith(1);
  });

  test("rejects unknown LLM models before saving", async () => {
    const fixture = createFixture();

    await expect(
      fixture.controller.saveLlmConfig(1, {
        ...validLlmConfig,
        model: "unknown-model",
      }),
    ).rejects.toThrow("Unsupported LLM model: unknown-model");

    expect(fixture.actorDB.upsertActor).not.toHaveBeenCalled();
  });

  test("rejects unsupported thinking levels before saving", async () => {
    const fixture = createFixture();

    await expect(
      fixture.controller.saveLlmConfig(1, {
        model: "qwen3",
        baseUrl: "http://127.0.0.1:8000/v1/",
        apiKey: "local-key",
        thinkingLevel: ThinkingLevel.MEDIUM,
      }),
    ).rejects.toThrow("qwen3 does not support thinking level: medium");

    expect(fixture.actorDB.upsertActor).not.toHaveBeenCalled();
  });

  test("saves disabled web search without an ApiKey", async () => {
    const fixture = createFixture();
    const config = { enabled: false, tavilyApiKey: "" };

    await expect(
      fixture.controller.saveWebSearchConfig(1, config),
    ).resolves.toEqual(config);

    expect(fixture.actors.get(1)?.webSearchConfig).toEqual(config);
    expect(fixture.publishUpdated).toHaveBeenCalledWith(1);
  });

  test("rejects enabled web search without an ApiKey", async () => {
    const fixture = createFixture();

    await expect(
      fixture.controller.saveWebSearchConfig(1, {
        enabled: true,
        tavilyApiKey: "  ",
      }),
    ).rejects.toThrow("Tavily ApiKey is required");

    expect(fixture.actorDB.upsertActor).not.toHaveBeenCalled();
  });

  test("saves global LLM config and updates runtime defaults", async () => {
    const fixture = createFixture();
    await GlobalConfig.load(new MemFs(), {
      bootstrap: createBootstrapConfig({ mode: "dev", mongoKind: "memory" }),
    });
    GlobalConfig.applyRecord(fixture.getGlobalConfig());

    await expect(
      fixture.controller.saveGlobalLlmConfig(validLlmConfig),
    ).resolves.toEqual(validLlmConfig);

    expect(fixture.getGlobalConfig().defaultLlm).toEqual(validLlmConfig);
    expect(GlobalConfig.defaultLlm).toEqual(validLlmConfig);
  });

  test("saves global embedding config without updating runtime defaults", async () => {
    const fixture = createFixture();
    await GlobalConfig.load(new MemFs(), {
      bootstrap: createBootstrapConfig({ mode: "dev", mongoKind: "memory" }),
    });
    GlobalConfig.applyRecord(fixture.getGlobalConfig());
    const runtimeEmbedding = GlobalConfig.defaultEmbedding;

    await expect(
      fixture.controller.saveGlobalEmbeddingConfig(validEmbeddingConfig),
    ).resolves.toMatchObject({
      config: validEmbeddingConfig,
      restartRequired: true,
      vectorIndex: {
        state: "ready",
        activeFingerprint: "active",
      },
    });

    expect(fixture.getGlobalConfig().defaultEmbedding).toEqual(
      validEmbeddingConfig,
    );
    expect(GlobalConfig.defaultEmbedding).toEqual(runtimeEmbedding);
  });
});
