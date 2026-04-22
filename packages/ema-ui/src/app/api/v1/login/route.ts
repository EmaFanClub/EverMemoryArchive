import { getServer } from "../../shared-server";

export async function GET() {
  const server = await getServer();
  const user = await server.getDefaultUser();
  return new Response(JSON.stringify(user), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
