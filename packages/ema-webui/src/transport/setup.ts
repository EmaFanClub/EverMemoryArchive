import type {
  SetupCheckPhase,
  SetupCheckTarget,
  SetupCommitResponse,
  SetupDraft,
  SetupDryRunResponse,
  SetupServiceCheckResponse,
} from "@/types/setup/v1beta1";

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error(
      extractTransportError(payload) ||
        `${response.status} ${response.statusText}`,
    );
  }

  return payload as T;
}

function extractTransportError(payload: unknown): string | null {
  if (typeof payload === "string") {
    return payload.trim() || null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") {
    return record.message;
  }
  if (typeof record.summary === "string") {
    return record.summary;
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

const setupCheckEndpoints: Record<SetupCheckTarget, string> = {
  llm: "/api/v1beta1/initialization/llm-probes",
  embedding: "/api/v1beta1/initialization/embedding-probes",
};

export async function runSetupCheck(
  target: SetupCheckTarget,
  config: unknown,
  phase: SetupCheckPhase,
  attempt = 0,
) {
  const endpoint = setupCheckEndpoints[target];
  return fetchJson<SetupServiceCheckResponse>(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phase,
      attempt,
      config,
    }),
  });
}

export async function runSetupDryRun(draft: SetupDraft) {
  return fetchJson<SetupDryRunResponse>(
    "/api/v1beta1/initialization/validations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    },
  );
}

export async function commitSetup(draft: SetupDraft) {
  return fetchJson<SetupCommitResponse>("/api/v1beta1/initialization", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft }),
  });
}
