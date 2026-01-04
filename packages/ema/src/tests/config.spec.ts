import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { Config } from "../config";

import configTestData from "./config_test.yaml?raw";

describe("Config", () => {
  test("should load values from a YAML file", () => {
    // 1. Create a temporary test directory and a new config file.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ema-config-test-"));

    try {
      const configPath = path.join(tempDir, "config.yaml");

      // 2. Write some config items into the config file.
      fs.writeFileSync(configPath, configTestData, "utf-8");

      // 3. Load config and verify values match the file content.
      const config = Config.fromYaml(configPath);

      expect(config.llm.openai.key).toBe("test-openai-key");
      expect(config.llm.openai.base_url).toBe("https://example.com/openai/v1/");
      expect(config.llm.google.key).toBe("test-google-key");
      expect(config.llm.google.base_url).toBe("https://example.com/google/v1/");
      expect(config.llm.chat_model).toBe("test-model");
      expect(config.llm.chat_provider).toBe("openai");

      expect(config.llm.retry.enabled).toBe(false);
      expect(config.llm.retry.max_retries).toBe(5);

      expect(config.tools.enable_bash).toBe(false);
    } finally {
      // 4. Delete the temporary directory.
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
