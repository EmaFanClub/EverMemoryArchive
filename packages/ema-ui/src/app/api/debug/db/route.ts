/**
 * Debug DB endpoint (in-memory mongo only).
 */

import { getServer } from "../../shared-server";

export async function GET(request: Request) {
  const server = await getServer();
  const url = new URL(request.url);
  const collection = url.searchParams.get("collection");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 200;

  if (limitRaw && Number.isNaN(limit)) {
    return new Response(JSON.stringify({ error: "limit must be a number" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = server.mongo.getDb();

  if (!collection) {
    const collections = await db.listCollections().toArray();
    const stats = await Promise.all(
      collections.map(async (item) => {
        const count = await db.collection(item.name).countDocuments();
        return { name: item.name, count };
      }),
    );
    return new Response(JSON.stringify({ collections: stats }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const docs = await db
    .collection(collection)
    .find()
    .limit(Number.isNaN(limit) ? 200 : limit)
    .toArray();

  return new Response(JSON.stringify({ collection, docs }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
