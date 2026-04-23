import { afterEach, describe, expect, test, vi } from "vitest";
import path from "node:path";

import { MemFs } from "../../fs";
import { GlobalConfig, GlobalConfigError } from "../global_config";

async function loadExample(fs = new MemFs()): Promise<MemFs> {
  GlobalConfig.resetForTests();
  await fs.write(GlobalConfig.configPath, GlobalConfig.example);
  await GlobalConfig.load(fs);
  return fs;
}

describe("GlobalConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    GlobalConfig.resetForTests();
  });

  test("creates example config and throws when config is missing", async () => {
    const fs = new MemFs();
    const result = GlobalConfig.load(fs);

    await expect(result).rejects.toBeInstanceOf(GlobalConfigError);
    await expect(result).rejects.toThrow("EMA config not found");
    await expect(fs.exists(GlobalConfig.configPath)).resolves.toBe(true);
    await expect(fs.read(GlobalConfig.configPath)).resolves.toBe(
      GlobalConfig.example,
    );
  });

  test("loads default values and resolves env_key values", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:7890");

    await loadExample();

    expect(GlobalConfig.system.mode).toBe("dev");
    expect(GlobalConfig.system.dataRoot).toBe(
      path.join(path.dirname(GlobalConfig.configPath), "..", ".data"),
    );
    expect(GlobalConfig.system.logsDir).toBe(
      path.join(path.dirname(GlobalConfig.configPath), "..", "logs"),
    );
    expect(GlobalConfig.system.httpsProxy).toBe("http://127.0.0.1:7890");
    expect(GlobalConfig.mongo.kind).toBe("memory");
    expect(GlobalConfig.agent.workspaceDir).toBe(
      path.join(path.dirname(GlobalConfig.configPath), "..", "workspace"),
    );
    expect(GlobalConfig.defaultLlm.provider).toBe("google");
    expect(GlobalConfig.defaultLlm.google.model).toBe("gemini-3.1-pro-preview");
    expect(GlobalConfig.defaultLlm.google.apiKey).toBe("test-gemini-key");
    expect(GlobalConfig.defaultLlm.openai.apiKey).toBe("test-openai-key");
  });

  test("loads .env values when process env is empty", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fs = new MemFs();
    await fs.write(GlobalConfig.configPath, GlobalConfig.example);
    await fs.write(
      GlobalConfig.configPath.replace(/config\/config\.toml$/, ".env"),
      "GEMINI_API_KEY=env-file-key\n",
    );

    await GlobalConfig.load(fs);

    expect(GlobalConfig.defaultLlm.google.apiKey).toBe("env-file-key");
  });

  test("loads dev seed JSON", async () => {
    const fs = new MemFs();
    await fs.write(GlobalConfig.configPath, GlobalConfig.example);
    await fs.write(GlobalConfig.devSeedPath, GlobalConfig.devSeedExample);

    await GlobalConfig.load(fs);
    const seed = await GlobalConfig.loadDevSeed(fs);

    expect(seed).not.toBeNull();
    expect(seed?.users[0]?.name).toBe("alice");
    expect(seed?.actors[0]?.roleId).toBe(1);
  });

  test("rejects invalid actor config in dev seed JSON", async () => {
    const fs = new MemFs();
    const seed = JSON.parse(GlobalConfig.devSeedExample);
    seed.actors[0].channelConfig = {
      qq: {
        enabled: true,
      },
    };
    await fs.write(GlobalConfig.configPath, GlobalConfig.example);
    await fs.write(GlobalConfig.devSeedPath, JSON.stringify(seed));

    await GlobalConfig.load(fs);

    await expect(GlobalConfig.loadDevSeed(fs)).rejects.toThrow(
      "Invalid EMA dev seed",
    );
  });

  test("reports TOML parse errors with config path", async () => {
    const fs = new MemFs();
    await fs.write(GlobalConfig.configPath, "[system\nmode = 'dev'");

    await expect(GlobalConfig.load(fs)).rejects.toThrow(
      "Failed to parse EMA config",
    );
  });

  test("reports validation errors with config path", async () => {
    const fs = new MemFs();
    await fs.write(
      GlobalConfig.configPath,
      GlobalConfig.example.replace('provider = "google"', 'provider = "bad"'),
    );

    await expect(GlobalConfig.load(fs)).rejects.toThrow("Invalid EMA config");
  });
});
