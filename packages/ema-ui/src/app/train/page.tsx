"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type TrainResult = {
  actorId: number;
  conversationId: number;
  session: string;
  checkpointDir: string;
  messageCount: number;
  checkpointCount: number;
};

export default function TrainPage() {
  const [status, setStatus] = useState<"running" | "done" | "error">("running");
  const [result, setResult] = useState<TrainResult | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/v1/train", {
          method: "POST",
        });
        const payload = (await response.json().catch(() => null)) as
          | TrainResult
          | { error?: string }
          | null;
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setStatus("error");
          setError(
            payload && "error" in payload
              ? (payload.error ?? "Training failed.")
              : "Training failed.",
          );
          return;
        }
        setResult(payload as TrainResult);
        setStatus("done");
      } catch (err) {
        if (cancelled) {
          return;
        }
        setStatus("error");
        setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ margin: 20 }}>
      <h1>Train</h1>
      {status === "running" ? <p>Training...</p> : null}
      {status === "done" && result ? (
        <>
          <p>Training completed.</p>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </>
      ) : null}
      {status === "error" ? <p>Training failed: {error}</p> : null}
      <p>
        <Link href="/chat">Go to chat</Link>
      </p>
      <p>
        <Link href="/">Back</Link>
      </p>
    </main>
  );
}
