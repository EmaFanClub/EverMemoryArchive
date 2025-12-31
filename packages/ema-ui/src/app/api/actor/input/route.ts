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
 * POST /api/actor/input - Sends input to actor
 * Body:
 *   - userId: User ID
 *   - actorId: Actor ID
 *   - inputs: Array of inputs
 *
 * Returns a success response.
 */
export const POST = postBody(ActorInputRequest)(async (body) => {
  const server = await getServer();
  const actor = await server.getActor(body.userId, body.actorId);

  // Processes input.
  await actor.work({ inputs: body.inputs });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
