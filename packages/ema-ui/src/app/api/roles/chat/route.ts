/**
 * Chat API endpoint.
 * See https://nextjs.org/blog/building-apis-with-nextjs#32-multiple-http-methods-in-one-file
 */

import { getServer } from "../../shared-server";

export async function POST(request: Request) {
  try {
    const server = getServer();
    const body = await request.json();
    const messages = body.messages;

    // Validate messages array
    if (!Array.isArray(messages)) {
      return new Response(
        JSON.stringify({
          error: "messages must be an array",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Validate each message has required fields
    for (const message of messages) {
      if (!message.role || !message.content) {
        return new Response(
          JSON.stringify({
            error: "Each message must have role and content fields",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    const response = await server.chat(messages);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An error occurred",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
