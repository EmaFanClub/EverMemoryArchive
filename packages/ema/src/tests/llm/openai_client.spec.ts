import { expect, test, describe } from "vitest";
import { RetryConfig, type LLMApiConfig } from "../../config";
import { OpenAIClient } from "../../llm/openai_client";
import { type Message } from "../../schema";

describe.skip("OpenAI", () => {
  test("should make a simple completion", async () => {
    const config: LLMApiConfig = {
      key: process.env.GEMINI_API_KEY || "",
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
    };
    // todo: document that `GEMINI_API_KEY` is required for testing.
    if (!config.key) {
      throw new Error("GEMINI_API_KEY is not set to test OpenAIClient");
    }
    const client = new OpenAIClient(
      "gemini-2.5-flash",
      config,
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
    expect(/hello/i.test(response.message.contents[0].text)).toBeTruthy();
  });
});
