import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { Config } from "../config";

describe("Config", () => {
  test("should load values from a YAML file", () => {
    // 1. Create a temporary test directory and a new config file.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ema-config-test-"));

    try {
      const configPath = path.join(tempDir, "config.yaml");

      // 2. Write some config items into the config file.
      fs.writeFileSync(
        configPath,
        [
          'api_key: "test-api-key"',
          'api_base: "https://example.com/v1/"',
          'model: "test-model"',
          'provider: "openai"',
          "retry:",
          "  enabled: false",
          "  max_retries: 5",
          "tools:",
          "  enable_bash: false",
          "",
        ].join("\n"),
        "utf-8",
      );

      // 3. Load config and verify values match the file content.
      const config = Config.fromYaml(configPath);

      expect(config.llm.apiKey).toBe("test-api-key");
      expect(config.llm.apiBase).toBe("https://example.com/v1/");
      expect(config.llm.model).toBe("test-model");
      expect(config.llm.provider).toBe("openai");

      expect(config.llm.retry.enabled).toBe(false);
      expect(config.llm.retry.maxRetries).toBe(5);

      expect(config.tools.enableBash).toBe(false);
    } finally {
      // 4. Delete the temporary directory.
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
