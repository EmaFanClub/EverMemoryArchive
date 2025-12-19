import { getServer } from "../shared-server";

/**
 * POST /api/snapshot - Take a snapshot of the MongoDB database
 * Body: { name: string = "default" }
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new Response(
      JSON.stringify({
        error: "This endpoint is only available in development mode",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const server = await getServer();
  const body = await request.json();
  const name = body.name || "default";

  const snapshot = await server.snapshot(name);
  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
