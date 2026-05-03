import type {
  ChatHistoryResponse,
  GetChatHistoryParams,
  SendMessageRequest,
  SendMessageResponse,
} from "@/types/chat/v1beta1";

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error(
      extractMessage(payload) || `${response.status} ${response.statusText}`,
    );
  }

  return payload as T;
}

function extractMessage(payload: unknown) {
  if (typeof payload === "string") {
    return payload.trim();
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") {
    return record.message;
  }
  if (
    record.error &&
    typeof record.error === "object" &&
    typeof (record.error as Record<string, unknown>).message === "string"
  ) {
    return (record.error as Record<string, string>).message;
  }
  return null;
}

export function getChatHistory({
  actorId,
  session,
  limit,
  beforeMsgId,
}: GetChatHistoryParams) {
  const params = new URLSearchParams();
  if (typeof limit === "number") {
    params.set("limit", String(limit));
  }
  if (typeof beforeMsgId === "number") {
    params.set("beforeMsgId", String(beforeMsgId));
  }

  const query = params.toString();
  return fetchJson<ChatHistoryResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/conversations/${encodeURIComponent(session)}/messages${query ? `?${query}` : ""}`,
    { method: "GET" },
  );
}

export function sendChatMessage({
  actorId,
  session,
  request,
}: {
  actorId: string;
  session: string;
  request: SendMessageRequest;
}) {
  return fetchJson<SendMessageResponse>(
    `/api/v1beta1/actors/${encodeURIComponent(actorId)}/conversations/${encodeURIComponent(session)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
}
