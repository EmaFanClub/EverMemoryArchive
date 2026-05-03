import { afterEach, describe, expect, test, vi } from "vitest";
import path from "node:path";

import { MemFs } from "../../shared/fs";
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

  test("creates dev memory bootstrap with fixed data root paths", () => {
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
    expect(bootstrap.devBootstrap).toEqual({
      restoreDefaultSnapshot: true,
    });
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
    expect(bootstrap.devBootstrap).toEqual({
      restoreDefaultSnapshot: false,
    });
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
    expect(bootstrap.devBootstrap.restoreDefaultSnapshot).toBe(false);
  });

  test("loads bootstrap without implicitly creating runtime config", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:7890");

    const bootstrap = createBootstrapConfig({
      mode: "dev",
      mongoKind: "memory",
    });
    await GlobalConfig.load(new MemFs(), { bootstrap });

    expect(GlobalConfig.system.mode).toBe("dev");
    expect(GlobalConfig.system.dataRoot).toBe(bootstrap.paths.dataRoot);
    expect(GlobalConfig.system.logsDir).toBe(bootstrap.paths.logsDir);
    expect(GlobalConfig.system.httpsProxy).toBe("http://127.0.0.1:7890");
    expect(GlobalConfig.mongo.kind).toBe("memory");
    expect(GlobalConfig.agent.workspaceDir).toBe(bootstrap.paths.workspaceDir);
    expect(GlobalConfig.hasRuntimeConfig).toBe(false);
    expect(() => GlobalConfig.defaultLlm).toThrow(
      "Database-backed GlobalConfig has not been loaded",
    );
  });

  test("loads .env proxy values for bootstrap-time system config", async () => {
    vi.stubEnv("HTTPS_PROXY", "");
    const fs = new MemFs();
    await fs.write(
      path.join(getWorkspaceRoot(), ".env"),
      "HTTPS_PROXY=http://127.0.0.1:7890\n",
    );

    await GlobalConfig.load(fs, {
      bootstrap: createBootstrapConfig({ mode: "dev", mongoKind: "memory" }),
    });

    expect(GlobalConfig.system.httpsProxy).toBe("http://127.0.0.1:7890");
  });

  test("applies database-backed global config record", async () => {
    await GlobalConfig.load(new MemFs(), {
      bootstrap: createBootstrapConfig({ mode: "dev", mongoKind: "memory" }),
    });

    GlobalConfig.applyRecord({
      ...createTestGlobalConfigRecord(),
      system: {
        httpsProxy: "http://127.0.0.1:7890",
      },
      defaultLlm: {
        ...createTestGlobalConfigRecord().defaultLlm,
        google: {
          ...createTestGlobalConfigRecord().defaultLlm.google,
          apiKey: "db-gemini-key",
        },
      },
    });

    expect(GlobalConfig.system.httpsProxy).toBe("http://127.0.0.1:7890");
    expect(GlobalConfig.defaultLlm.google.apiKey).toBe("db-gemini-key");
  });

  test("updates runtime global config fields independently", async () => {
    await GlobalConfig.load(new MemFs(), {
      bootstrap: createBootstrapConfig({ mode: "dev", mongoKind: "memory" }),
    });
    const record = createTestGlobalConfigRecord();
    GlobalConfig.applyRecord(record);

    GlobalConfig.updateDefaultLlm({
      ...record.defaultLlm,
      google: {
        ...record.defaultLlm.google,
        apiKey: "updated-llm-key",
      },
    });
    GlobalConfig.updateSystemConfig({
      httpsProxy: "http://127.0.0.1:7890",
    });

    expect(GlobalConfig.defaultLlm.google.apiKey).toBe("updated-llm-key");
    expect(GlobalConfig.defaultEmbedding).toEqual(record.defaultEmbedding);
    expect(GlobalConfig.system.httpsProxy).toBe("http://127.0.0.1:7890");
  });

  test("resolves runtime provider config values without changing stored config", () => {
    vi.stubEnv("EMA_TEST_OPENAI_KEY", "sk-resolved");
    vi.stubEnv("EMA_TEST_VERTEX_PROJECT", "resolved-project");
    vi.stubEnv("EMA_TEST_VERTEX_CREDENTIALS", "/tmp/vertex-key.json");

    const record = createTestGlobalConfigRecord();
    const llm = {
      ...record.defaultLlm,
      provider: "openai" as const,
      openai: {
        ...record.defaultLlm.openai,
        apiKey: "EMA_TEST_OPENAI_KEY",
      },
      google: {
        ...record.defaultLlm.google,
        project: "EMA_TEST_VERTEX_PROJECT",
        location: "us-central1",
        credentialsFile: "EMA_TEST_VERTEX_CREDENTIALS",
      },
    };
    const embedding = {
      ...record.defaultEmbedding,
      google: {
        ...record.defaultEmbedding.google,
        project: "MISSING_VERTEX_PROJECT",
        credentialsFile: "GOOGLE_APPLICATION_CREDENTIALS",
      },
    };

    expect(GlobalConfig.resolveRuntimeLlmConfig(llm).openai.apiKey).toBe(
      "sk-resolved",
    );
    expect(GlobalConfig.resolveRuntimeLlmConfig(llm).google.project).toBe(
      "resolved-project",
    );
    expect(
      GlobalConfig.resolveRuntimeLlmConfig(llm).google.credentialsFile,
    ).toBe("/tmp/vertex-key.json");
    expect(
      GlobalConfig.resolveRuntimeEmbeddingConfig(embedding).google.project,
    ).toBe("");
    expect(
      GlobalConfig.resolveRuntimeEmbeddingConfig(embedding).google
        .credentialsFile,
    ).toBe("");
    expect(llm.openai.apiKey).toBe("EMA_TEST_OPENAI_KEY");
  });
});
