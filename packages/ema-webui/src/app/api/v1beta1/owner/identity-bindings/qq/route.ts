import { saveOwnerQqBindingService } from "@/server/services/dashboard";
import type { OwnerQqBindingSaveRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as OwnerQqBindingSaveRequest;
  const result = await saveOwnerQqBindingService(body);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
