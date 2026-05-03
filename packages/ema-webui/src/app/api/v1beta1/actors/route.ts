import {
  buildActorListResponse,
  createActorService,
} from "@/server/services/dashboard";
import type { CreateActorRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await buildActorListResponse(), { status: 200 });
}

export async function POST(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<CreateActorRequest>;
  if (!body.name?.trim()) {
    return Response.json(
      { message: "Actor name is required." },
      { status: 400 },
    );
  }

  try {
    const result = await createActorService({
      name: body.name,
      avatarUrl: body.avatarUrl,
      roleBook: body.roleBook ?? "",
      sleepSchedule: body.sleepSchedule ?? {
        startMinutes: 0,
        endMinutes: 8 * 60,
      },
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("sleepSchedule") ? 400 : 500;
    return Response.json(
      {
        message: message || "Failed to create actor.",
      },
      { status },
    );
  }
}
