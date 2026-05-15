import { afterEach, describe, expect, test, vi } from "vitest";
import path from "node:path";

import { MemFs } from "../../shared/fs";
import { ThinkingLevel } from "../../llm";
import {
  createBootstrapConfig,
  getWorkspaceRoot,
  GlobalConfig,
  GlobalConfigError,
} from "../global_config";
import { createTestGlobalConfigRecord } from "./helpers";

describe("GlobalConfig", () => {
  const emptyEnv = () => undefined;

  afterEach(() => {
    vi.unstubAllEnvs();
    GlobalConfig.resetForTests();
  });

  test("creates dev memory bootstrap with explicit data root paths", () => {
    const bootstrap = createBootstrapConfig(
      {
        mode: "dev",
        mongoKind: "memory",
        dataRoot: ".ema-test",
      },
      emptyEnv,
    );

    const dataRoot = path.join(getWorkspaceRoot(), ".ema-test");
    expect(bootstrap.mode).toBe("dev");
    expect(bootstrap.mongo).toMatchObject({
      kind: "memory",
      dbName: "ema",
    });
    expect(bootstrap.paths).toEqual({
      dataRoot,
      logsDir: path.join(dataRoot, "logs"),
      workspaceDir: path.join(dataRoot, "workspace"),
    });
    expect(bootstrap.devBootstrap).toBeUndefined();
  });

  test("creates timestamped dev data root by default", () => {
    const bootstrap = createBootstrapConfig(
      {
        mode: "dev",
        mongoKind: "memory",
      },
      emptyEnv,
    );

    expect(path.basename(path.dirname(bootstrap.paths.dataRoot))).toBe(
      ".ema_dev",
    );
    expect(path.basename(bootstrap.paths.dataRoot)).toMatch(
      /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/u,
    );
    expect(bootstrap.paths.logsDir).toBe(
      path.join(bootstrap.paths.dataRoot, "logs"),
    );
    expect(bootstrap.paths.workspaceDir).toBe(
      path.join(bootstrap.paths.dataRoot, "workspace"),
    );
    expect(bootstrap.devBootstrap).toBeUndefined();
  });

  test("uses configured workspace root for relative data root paths", () => {
    const workspaceRoot = path.join(process.cwd(), "custom-workspace-root");
    vi.stubEnv("EMA_WORKSPACE_ROOT", workspaceRoot);

    const bootstrap = createBootstrapConfig(
      {
        mode: "dev",
        mongoKind: "memory",
        dataRoot: ".ema-test",
      },
      emptyEnv,
    );

    expect(bootstrap.paths.dataRoot).toBe(
      path.join(workspaceRoot, ".ema-test"),
    );
  });

  test("defaults to production mode and requires mongo", () => {
    expect(() => createBootstrapConfig({}, emptyEnv)).toThrow(
      GlobalConfigError,
    );
  });

  test("requires remote mongo in production bootstrap", () => {
    expect(() => createBootstrapConfig({ mode: "prod" }, emptyEnv)).toThrow(
      GlobalConfigError,
    );

    const bootstrap = createBootstrapConfig(
      {
        mode: "prod",
        mongoUri: "mongodb://127.0.0.1:27017",
      },
      emptyEnv,
    );
    expect(bootstrap.mongo).toEqual({
      kind: "remote",
      uri: "mongodb://127.0.0.1:27017",
      dbName: "ema",
    });
    expect(bootstrap.paths.dataRoot).toBe(
      path.join(getWorkspaceRoot(), ".ema"),
    );
    expect(bootstrap.devBootstrap).toBeUndefined();
  });

  test("loads internal server bootstrap values from environment", () => {
    const envValues: Record<string, string> = {
      EMA_SERVER_MODE: "dev",
      EMA_SERVER_MONGO_KIND: "remote",
      EMA_SERVER_MONGO_URI: "mongodb://127.0.0.1:27017",
      EMA_SERVER_MONGO_DB: "ema_dev",
      EMA_SERVER_DATA_ROOT: ".ema-env-test",
    };
    const bootstrap = createBootstrapConfig({}, (name) => envValues[name]);

    const dataRoot = path.join(getWorkspaceRoot(), ".ema-env-test");
    expect(bootstrap.mode).toBe("dev");
    expect(bootstrap.mongo).toEqual({
      kind: "remote",
      uri: "mongodb://127.0.0.1:27017",
      dbName: "ema_dev",
    });
    expect(bootstrap.paths.dataRoot).toBe(dataRoot);
    expect(bootstrap.devBootstrap).toBeUndefined();
  });

  test("loads bootstrap without implicitly creating runtime config", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:7890");

    const bootstrap = createBootstrapConfig({
      mode: "dev",
      mongoKind: "memory",
    });
    await GlobalConfig.load(new MemFs(), { bootstrap });

    expect(GlobalConfig.mode).toBe("dev");
    expect(GlobalConfig.paths.dataRoot).toBe(bootstrap.paths.dataRoot);
    expect(GlobalConfig.paths.logsDir).toBe(bootstrap.paths.logsDir);
    expect(GlobalConfig.httpsProxy).toBe("http://127.0.0.1:7890");
    expect(GlobalConfig.mongo.kind).toBe("memory");
    expect(GlobalConfig.paths.workspaceDir).toBe(bootstrap.paths.workspaceDir);
    expect(GlobalConfig.hasRuntimeConfig).toBe(false);
    expect(() => GlobalConfig.defaultLlm).toThrow(
      "Database-backed GlobalConfig has not been loaded",
    );
  });

  test("loads .env proxy values into bootstrap config", async () => {
    vi.stubEnv("HTTPS_PROXY", "");
    const fs = new MemFs();
    await fs.write(
      path.join(getWorkspaceRoot(), ".env"),
      [
        "EMA_SERVER_MODE=dev",
        "EMA_SERVER_MONGO_KIND=memory",
        "HTTPS_PROXY=http://127.0.0.1:7890",
        "",
      ].join("\n"),
    );

    await GlobalConfig.load(fs);

    expect(GlobalConfig.httpsProxy).toBe("http://127.0.0.1:7890");
  });

  test("applies database-backed global config record", async () => {
    await GlobalConfig.load(new MemFs(), {
      bootstrap: createBootstrapConfig({
        mode: "dev",
        mongoKind: "memory",
        httpsProxy: "http://127.0.0.1:7891",
      }),
    });
    const defaultLlm = {
      model: "gpt-5.5",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-db",
      thinkingLevel: ThinkingLevel.HIGH,
    };

    GlobalConfig.applyRecord({
      ...createTestGlobalConfigRecord(),
      accessToken: " webui-token ",
      defaultLlm,
    });

    expect(GlobalConfig.httpsProxy).toBe("http://127.0.0.1:7891");
    expect(GlobalConfig.accessToken).toBe("webui-token");
    expect(GlobalConfig.defaultLlm).toEqual(defaultLlm);

    GlobalConfig.applyRecord({
      ...createTestGlobalConfigRecord(),
      system: {
        accessToken: " legacy-token ",
        httpsProxy: "http://legacy-proxy.invalid",
      },
    });

    expect(GlobalConfig.accessToken).toBe("legacy-token");
    expect(GlobalConfig.httpsProxy).toBe("http://127.0.0.1:7891");
  });

  test("updates runtime global config fields independently", async () => {
    await GlobalConfig.load(new MemFs(), {
      bootstrap: createBootstrapConfig({ mode: "dev", mongoKind: "memory" }),
    });
    const record = createTestGlobalConfigRecord();
    GlobalConfig.applyRecord(record);

    GlobalConfig.updateDefaultLlm({
      ...record.defaultLlm,
      apiKey: "updated-llm-key",
    });

    expect(GlobalConfig.defaultLlm.apiKey).toBe("updated-llm-key");
    expect(GlobalConfig.defaultEmbedding).toEqual(record.defaultEmbedding);
  });

  test("normalizes legacy chat LLM configs when loading global config", async () => {
    await GlobalConfig.load(new MemFs(), {
      bootstrap: createBootstrapConfig({ mode: "dev", mongoKind: "memory" }),
    });
    const record = createTestGlobalConfigRecord();
    const openaiLegacy = {
      provider: "openai",
      openai: {
        mode: "responses",
        model: "gpt-5.5",
        baseUrl: " https://api.openai.com/v1 ",
        apiKey: " sk-legacy ",
      },
      google: {
        model: "gemini-3.1-pro-preview",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "google-key",
        useVertexAi: false,
        project: "",
        location: "",
        credentialsFile: "",
      },
    };
    GlobalConfig.applyRecord({
      ...record,
      defaultLlm: openaiLegacy as never,
    });

    expect(GlobalConfig.defaultLlm).toEqual({
      model: "gpt-5.5",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-legacy",
    });

    const googleLegacy = {
      ...openaiLegacy,
      provider: "google",
      google: {
        ...openaiLegacy.google,
        apiKey: " gemini-key ",
      },
    };
    GlobalConfig.applyRecord({
      ...record,
      defaultLlm: googleLegacy as never,
    });

    expect(GlobalConfig.defaultLlm).toEqual({
      model: "gemini-3.1-pro-preview",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "gemini-key",
    });

    const credentialsJson = '{"type":"service_account","project_id":"p"}';
    GlobalConfig.applyRecord({
      ...record,
      defaultLlm: {
        ...googleLegacy,
        google: {
          ...googleLegacy.google,
          useVertexAi: true,
          credentialsFile: ` ${credentialsJson} `,
        },
      } as never,
    });

    expect(GlobalConfig.defaultLlm).toEqual({
      model: "gemini-3.1-pro-preview",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: credentialsJson,
    });
  });

  test("normalizes legacy embedding configs when loading global config", async () => {
    await GlobalConfig.load(new MemFs(), {
      bootstrap: createBootstrapConfig({ mode: "dev", mongoKind: "memory" }),
    });
    const record = createTestGlobalConfigRecord();
    const embeddingCredentialsJson =
      '{"type":"service_account","project_id":"embedding-p"}';
    const legacyEmbedding = {
      provider: "google",
      openai: {
        model: "text-embedding-3-large",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-embedding",
      },
      google: {
        model: "gemini-embedding-001",
        baseUrl: " https://generativelanguage.googleapis.com ",
        apiKey: "google-key",
        useVertexAi: true,
        project: "legacy-project",
        location: "global",
        credentialsFile: ` ${embeddingCredentialsJson} `,
      },
    };

    GlobalConfig.applyRecord({
      ...record,
      defaultEmbedding: legacyEmbedding as never,
    });

    expect(GlobalConfig.defaultEmbedding).toEqual({
      provider: "google",
      model: "gemini-embedding-001",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: embeddingCredentialsJson,
    });
  });
});
