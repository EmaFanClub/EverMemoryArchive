import { subscribeSse } from "@/transport/sse";
import type { EmaKnownEvent, EmaEventTopic } from "@/types/events/v1beta1";

export function subscribeEmaEvents(
  topics: EmaEventTopic[] | null,
  handler: (event: EmaKnownEvent) => void,
) {
  const params = new URLSearchParams();
  if (topics?.length) {
    params.set("topics", topics.join(","));
  }
  const query = params.toString();
  return subscribeSse<EmaKnownEvent>(
    `/api/v1beta1/events/stream${query ? `?${query}` : ""}`,
    handler,
  );
}
