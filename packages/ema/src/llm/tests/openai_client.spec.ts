import { afterEach, describe, expect, test } from "vitest";

import { createBootstrapConfig, GlobalConfig } from "../../config";
import { MemFs } from "../../shared/fs";
import { RetryConfig } from "../retry";
import { OpenAIClient } from "../openai_client";

describe("OpenAIClient", () => {
  afterEach(() => {
    GlobalConfig.resetForTests();
  });

  test("collapses inline data to text instead of dropping it", async () => {
    await GlobalConfig.load(new MemFs(), {
      bootstrap: createBootstrapConfig({
        mode: "dev",
        mongoKind: "memory",
        dataRoot: "/tmp/ema-test",
      }),
    });
    const client = new OpenAIClient(
      {
        mode: "responses",
        model: "gpt-test",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
      },
      new RetryConfig(false),
    );

    expect(
      client.adaptMessageToAPI({
        role: "user",
        contents: [
          { type: "text", text: "看看" },
          {
            type: "inline_data",
            mimeType: "image/png",
            data: "base64-data",
            text: "[图片]",
          },
        ],
      }),
    ).toEqual([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "看看" },
          { type: "input_text", text: "[图片]（image/png）" },
        ],
      },
    ]);
  });
});
