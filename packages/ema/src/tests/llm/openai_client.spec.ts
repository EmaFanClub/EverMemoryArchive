import { expect, test, describe } from "vitest";

import { GlobalConfig, RetryConfig } from "../../config/index";
import { OpenAIClient } from "../../llm/openai_client";
import { type Message } from "../../schema";
import { loadTestGlobalConfig } from "../helpers/config";

describe.skip("OpenAI", () => {
  test("should make a simple completion", async () => {
    await loadTestGlobalConfig();
    const config = GlobalConfig.defaultLlm.google;
    if (!config.apiKey) {
      throw new Error("Google API key is not set to test OpenAIClient");
    }
    const client = new OpenAIClient(
      {
        mode: "responses",
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      },
      new RetryConfig(),
    );

    const messages: Message[] = [
      {
        role: "user",
        contents: [
          { type: "text", text: "Say 'Hello from OpenAI!' and nothing else." },
        ],
      },
    ];

    const response = await client.generate(
      messages,
      [],
      "You are a helpful assistant.",
    );
    expect(response).toBeDefined();
    const firstText = response.message.contents.find(
      (content) => content.type === "text",
    );
    expect(firstText).toBeDefined();
    expect(/hello/i.test(firstText!.text)).toBeTruthy();
  });
});
