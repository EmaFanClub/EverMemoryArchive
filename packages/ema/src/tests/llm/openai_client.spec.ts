import { expect, test, describe } from "vitest";

import { OpenAIClient } from "../../llm/openai_client";

describe.skip("OpenAI", () => {
  test("should make a simple completion", async () => {
    const apiKey = process.env.GEMINI_API_KEY || "";
    // todo: document that `GEMINI_API_KEY` is required for testing.
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set to test OpenAIClient");
    }
    const client = new OpenAIClient(
      apiKey,
      "https://generativelanguage.googleapis.com/v1beta/openai/",
      // gemini model
      "gemini-2.5-flash",
    );

    const messages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Say 'Hello from OpenAI!' and nothing else." },
    ];

    const response = await client.generate(messages);
    expect(response).toBeDefined();
    expect(/hello/i.test(response.content)).toBeTruthy();
  });
});
