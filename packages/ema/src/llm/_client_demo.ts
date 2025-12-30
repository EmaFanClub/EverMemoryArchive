import { LLMClient } from "./client";
import { LLMConfig } from "../config";
import type { Message } from "../schema";
import type { Tool } from "../tools/base";
import { FinalReplyTool } from "../tools/final_reply_tool";

const openaiConfig = new LLMConfig({
  apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || "",
  apiBase: "https://generativelanguage.googleapis.com/v1beta/openai/",
  model: "gemini-2.5-flash",
  provider: "openai",
});

const googleConfig = new LLMConfig({
  apiKey: process.env.GEMINI_API_KEY || "",
  apiBase: "https://generativelanguage.googleapis.com",
  model: "gemini-2.5-flash",
  provider: "google",
});

const messages = [
  {
    role: "user",
    contents: [{ type: "text", text: "你好呀，你叫什么名字？" }],
  },
] as Message[];

const tools = [new FinalReplyTool()] as Tool[];

const systemPrompt =
  "你叫小黑，你是一只智能助理小猫娘，喜欢卖萌，说话结尾会加上喵~";

async function test(provider: "google" | "openai") {
  const client = new LLMClient(
    provider === "google" ? googleConfig : openaiConfig,
  );
  const response = await client.generate(messages, tools, systemPrompt);
  console.log(`[${provider}] Response:`, JSON.stringify(response, null, 2));
}

await test("google");

await test("openai");
