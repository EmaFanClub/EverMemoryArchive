import type { OwnerStatusResponse } from "@/types/auth/v1beta1";
import type { SetupStatusResponse } from "@/types/setup/v1beta1";

export async function getOwnerStatus() {
  const response = await fetch("/api/v1beta1/initialization", {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const status = (await response.json()) as SetupStatusResponse;
  return {
    apiVersion: "v1beta1",
    ownerReady: !status.needsInitialization,
  } satisfies OwnerStatusResponse;
}
