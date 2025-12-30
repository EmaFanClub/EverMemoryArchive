/**
 * Actor Input endpoint.
 * See https://nextjs.org/blog/building-apis-with-nextjs#32-multiple-http-methods-in-one-file
 */

import { getServer } from "../../shared-server";
import * as k from "arktype";
import { postBody } from "../../utils";

const ActorInput = k.type({
  kind: "'text'",
  content: "string",
});

const ActorInputRequest = k.type({
  userId: "number.integer",
  actorId: "number.integer",
  inputs: ActorInput.array(),
});

/**
 * Sends input to actor.
 *
 * Body:
 *   - userId (`number`): User ID
 *   - actorId (`number`): Actor ID
 *   - inputs (`ActorInput[]`): Array of inputs
 *
 * ActorInput:
 *   - kind (`"text"`): The kind of the input.
 *   - content (`string`): The content of the input.
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
 *     inputs: [{ kind: "text", content: "Hello, world!" }],
 *   }),
 * });
 *
 */
export const POST = postBody(ActorInputRequest)(async (body) => {
  const server = await getServer();
  const actor = await server.getActor(body.userId, body.actorId);

  // Processes input.
  await actor.work(body.inputs);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
