export async function POST() {
  return new Response(
    JSON.stringify({
      error: "Training is temporarily disabled.",
    }),
    {
      status: 501,
      headers: { "Content-Type": "application/json" },
    },
  );
}
