import { subscribeSse } from "@/transport/sse";
import type { EmaKnownEvent } from "@/types/events/v1beta1";

export function subscribeChatEvents({
  actorId,
  session,
  handler,
  onDisconnect,
}: {
  actorId: string;
  session: string;
  handler: (event: EmaKnownEvent) => void;
  onDisconnect?: () => void;
}) {
  return subscribeSse<EmaKnownEvent>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/conversations/${encodeURIComponent(session)}/stream`,
    handler,
    { onDisconnect },
  );
}
