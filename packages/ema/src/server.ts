import { OpenAIClient } from "./llm/openai_client";
import type { Message } from "./schema";

/**
 * The server class for the EverMindAgent.
 */
export class Server {
  private llmClient: OpenAIClient;

  constructor() {
    // Initialize OpenAI client with environment variables or defaults
    const apiKey =
      process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || "";
    const apiBase =
      process.env.OPENAI_API_BASE ||
      process.env.GEMINI_API_BASE ||
      "https://generativelanguage.googleapis.com/v1beta/openai/";
    const model =
      process.env.OPENAI_MODEL ||
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash";
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY or GEMINI_API_KEY env is not set");
    }

    this.llmClient = new OpenAIClient(apiKey, apiBase, model);
  }

  /**
   * Handles user login and returns a user object.
   *
   * Exposed as `GET /api/users/login`.
   *
   * @returns {{ id: number, name: string, email: string }} The logged-in user object.
   *
   * @example
   * // Example usage:
   * const user = server.login();
   * console.log(user.id); // 1
   */
  login() {
    return {
      id: 1,
      name: "alice",
      email: "alice@example.com",
    };
  }

  /**
   * Handles chat requests and returns LLM responses.
   *
   * Exposed as `POST /api/roles/chat`.
   *
   * @param messages - Array of conversation messages
   * @returns Promise<{ content: string, thinking?: string }> The LLM response
   *
   * @example
   * // Example usage:
   * const response = await server.chat([
   *   { role: "system", content: "You are a helpful assistant." },
   *   { role: "user", content: "Hello!" }
   * ]);
   * console.log(response.content);
   */
  async chat(messages: Message[]) {
    const response = await this.llmClient.generate(messages);
    return {
      content: response.content,
      thinking: response.thinking,
    };
  }
}
