import { getServer } from "@/server";

export async function POST(request: Request) {
  const server = await getServer();
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const result = await server.dbService.snapshot(body.name ?? "default", [
    server.scheduler.collectionName,
  ]);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
