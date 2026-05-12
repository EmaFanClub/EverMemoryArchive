import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test, beforeEach, afterEach } from "vitest";

import { PromptStore } from "../loader";

describe("PromptStore", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ema-prompts-"));
    await fs.mkdir(path.join(rootDir, "system_prompt", "partials"), {
      recursive: true,
    });
    await fs.mkdir(path.join(rootDir, "task_prompt"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  test("loads a system prompt with includes and variables", async () => {
    await fs.writeFile(
      path.join(rootDir, "system_prompt", "foreground.md"),
      [
        "<!-- @include system_prompt/partials/preamble.md -->",
        "",
        "---",
        "",
        "<!-- @include system_prompt/partials/interaction-guidelines-{SESSION_TYPE}.md -->",
        "",
        "Role: {ROLE_PROMPT}",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(rootDir, "system_prompt", "partials", "preamble.md"),
      "# 前言",
    );
    await fs.writeFile(
      path.join(
        rootDir,
        "system_prompt",
        "partials",
        "interaction-guidelines-chat.md",
      ),
      "# 私聊流程",
    );

    const prompt = await new PromptStore(rootDir).loadSystemPrompt(
      "foreground",
      {
        SESSION_TYPE: "chat",
        ROLE_PROMPT: "role book",
      },
    );

    expect(prompt).toBe("# 前言\n\n---\n\n# 私聊流程\n\nRole: role book");
  });

  test("lets templates control spacing around trimmed includes", async () => {
    await fs.writeFile(
      path.join(rootDir, "system_prompt", "background.md"),
      [
        "",
        "<!-- @include system_prompt/partials/preamble.md -->",
        "",
        "---",
        "",
        "<!-- @include system_prompt/partials/system.md -->",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(rootDir, "system_prompt", "partials", "preamble.md"),
      "\n# 前言\n\n",
    );
    await fs.writeFile(
      path.join(rootDir, "system_prompt", "partials", "system.md"),
      "\n# 系统\n\n",
    );

    const prompt = await new PromptStore(rootDir).loadSystemPrompt(
      "background",
    );

    expect(prompt).toBe("# 前言\n\n---\n\n# 系统");
  });

  test("loads a task prompt and replaces variables", async () => {
    await fs.writeFile(
      path.join(rootDir, "task_prompt", "scheduled-chat.md"),
      "\nTask: {SCHEDULED_PROMPT}\n\n",
    );

    const prompt = await new PromptStore(rootDir).loadTaskPrompt(
      "scheduled-chat",
      { SCHEDULED_PROMPT: "主动问候" },
    );

    expect(prompt).toBe("Task: 主动问候");
  });

  test("does not read the prompt root from environment variables", async () => {
    const originalEnv = process.env.EMA_PROMPTS_DIR;
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ema-other-"));
    try {
      await fs.mkdir(path.join(otherRoot, "task_prompt"), { recursive: true });
      await fs.writeFile(
        path.join(rootDir, "task_prompt", "wake.md"),
        "from constructor",
      );
      await fs.writeFile(
        path.join(otherRoot, "task_prompt", "wake.md"),
        "from env",
      );
      process.env.EMA_PROMPTS_DIR = otherRoot;

      expect(await new PromptStore(rootDir).loadTaskPrompt("wake")).toBe(
        "from constructor",
      );
    } finally {
      if (originalEnv === undefined) {
        delete process.env.EMA_PROMPTS_DIR;
      } else {
        process.env.EMA_PROMPTS_DIR = originalEnv;
      }
      await fs.rm(otherRoot, { recursive: true, force: true });
    }
  });

  test("leaves variables unchanged when they are not provided", async () => {
    await fs.writeFile(
      path.join(rootDir, "task_prompt", "wake.md"),
      "Hello {name}",
    );

    await expect(new PromptStore(rootDir).loadTaskPrompt("wake")).resolves.toBe(
      "Hello {name}",
    );
  });

  test("does not cache prompt files", async () => {
    const promptPath = path.join(rootDir, "task_prompt", "wake.md");
    const store = new PromptStore(rootDir);

    await fs.writeFile(promptPath, "before");
    expect(await store.loadTaskPrompt("wake")).toBe("before");

    await fs.writeFile(promptPath, "after");
    expect(await store.loadTaskPrompt("wake")).toBe("after");
  });

  test("rejects includes outside the prompt root", async () => {
    await fs.writeFile(
      path.join(rootDir, "system_prompt", "background.md"),
      "<!-- @include ../../outside.md -->",
    );

    await expect(
      new PromptStore(rootDir).loadSystemPrompt("background"),
    ).rejects.toThrow("Prompt include path escapes prompt root");
  });

  test("rejects cyclic includes", async () => {
    await fs.writeFile(
      path.join(rootDir, "system_prompt", "background.md"),
      "<!-- @include system_prompt/partials/a.md -->",
    );
    await fs.writeFile(
      path.join(rootDir, "system_prompt", "partials", "a.md"),
      "<!-- @include system_prompt/partials/b.md -->",
    );
    await fs.writeFile(
      path.join(rootDir, "system_prompt", "partials", "b.md"),
      "<!-- @include system_prompt/partials/a.md -->",
    );

    await expect(
      new PromptStore(rootDir).loadSystemPrompt("background"),
    ).rejects.toThrow(
      "Prompt include cycle detected: system_prompt/background.md -> system_prompt/partials/a.md -> system_prompt/partials/b.md -> system_prompt/partials/a.md",
    );
  });
});
