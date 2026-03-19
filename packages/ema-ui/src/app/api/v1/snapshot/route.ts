import { getServer } from "../../shared-server";

export async function POST(request: Request) {
  const server = await getServer();
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const result = await server.snapshot(body.name ?? "default");
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
