/**
 * See https://nextjs.org/blog/building-apis-with-nextjs#32-multiple-http-methods-in-one-file
 */

import { getServer } from "../../shared-server";

export async function GET(request: Request) {
  // For example, fetch data from your DB here
  const server = await getServer();
  const user = await server.login();
  return new Response(JSON.stringify(user), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
