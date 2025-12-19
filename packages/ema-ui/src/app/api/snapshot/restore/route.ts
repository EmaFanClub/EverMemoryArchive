import { getServer } from "../../shared-server";

/**
 * POST /api/snapshot/restore - Restore a snapshot of the MongoDB database by name
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
  const restored = await server.restoreFromSnapshot(name);
  return new Response(
    JSON.stringify({
      message: restored ? "Snapshot restored" : "Snapshot not found",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
