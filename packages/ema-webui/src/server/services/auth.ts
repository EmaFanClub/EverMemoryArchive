import "server-only";

import { ensureEmaServer } from "@/server/ema-server";
import type { OwnerStatusResponse } from "@/types/auth/v1beta1";

export async function getOwnerStatus(): Promise<OwnerStatusResponse> {
  const server = await ensureEmaServer();
  const status = await server.controller.setup.getStatus();
  const user = status.owner;
  return {
    apiVersion: "v1beta1",
    ownerReady: status.complete,
    ...(user
      ? {
          user: {
            id: String(user.id),
            name: user.name,
          },
        }
      : {}),
  };
}
