/**
 * Actor Input endpoint.
 * See https://nextjs.org/blog/building-apis-with-nextjs#32-multiple-http-methods-in-one-file
 */

import { getServer } from "../../shared-server";
import * as k from "arktype";
import { postBody } from "../../utils";

const Content = k.type({
  type: "'text'",
  text: "string",
});

const ActorInputRequest = k.type({
  userId: "number.integer",
  actorId: "number.integer",
  conversationId: "number.integer",
  inputs: Content.array(),
});

/**
 * Sends input to actor.
 *
 * Body:
 *   - userId (`number`): User ID
 *   - actorId (`number`): Actor ID
 *   - conversationId (`number`): Conversation ID
 *   - inputs (`Content[]`): Array of inputs
 *
 * Content:
 *   - type (`"text"`): The content type.
 *   - text (`string`): The text content.
 *
 * @example
 * ```ts
 * // Send text input to actor
 * const response = await fetch("/api/actor/input", {
 *   method: "POST",
 *   headers: {
 *     "Content-Type": "application/json",
 *   },
 *   body: JSON.stringify({
 *     userId: 1,
 *     actorId: 1,
 *     conversationId: 1,
 *     inputs: [{ type: "text", text: "Hello, world!" }],
 *   }),
 * });
 *
 */
export const POST = postBody(ActorInputRequest)(async (body) => {
  const server = await getServer();
  const actor = await server.getActor(
    body.userId,
    body.actorId,
    body.conversationId,
  );

  // Processes input.
  await actor.work(body.inputs);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
