"use client";

import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { APP_VERSION_BADGE } from "@/app-version";
import styles from "./page.module.css";

type ToastState = {
  id: number;
  kind: "success" | "error";
  message: string;
};

function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.24-.02-2.26-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.33-1.75-1.33-1.75-1.09-.75.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23.96-.27 1.98-.4 3-.4s2.05.13 3.01.4c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.82.58C20.57 21.8 24 17.31 24 12c0-6.63-5.37-12-12-12Z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastSeqRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  function showToast(message: string, kind: ToastState["kind"]) {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastSeqRef.current += 1;
    setToast({ id: toastSeqRef.current, message, kind });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1800);
  }

  async function submit() {
    const value = token.trim();
    if (!value) {
      showToast("请输入访问 Token", "error");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1beta1/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      if (!response.ok) {
        showToast("Token 不正确", "error");
        return;
      }
      showToast("验证通过", "success");
      router.replace("/dashboard");
    } catch {
      showToast("登录失败，请稍后重试", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-label="访问验证">
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>EMA WebUI</span>
            <h1>EverMemoryArchive</h1>
          </div>
          <span className={styles.versionBadge}>{APP_VERSION_BADGE}</span>
        </header>

        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className={styles.field}>
            <span>访问 Token</span>
            <input
              value={token}
              placeholder="输入访问 Token"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? <LoaderCircle aria-hidden="true" /> : null}
            <span>{busy ? "验证中" : "进入"}</span>
          </button>
        </form>

        {toast ? (
          <div
            key={toast.id}
            className={`${styles.toast} ${
              toast.kind === "success" ? styles.toastSuccess : styles.toastError
            }`}
            role={toast.kind === "success" ? "status" : "alert"}
            aria-live={toast.kind === "success" ? "polite" : "assertive"}
          >
            {toast.kind === "success" ? (
              <Check aria-hidden="true" />
            ) : (
              <X aria-hidden="true" />
            )}
            <span>{toast.message}</span>
          </div>
        ) : null}
      </section>
      <a
        className={styles.githubLink}
        href="https://github.com/EmaFanClub/EverMemoryArchive"
        target="_blank"
        rel="noreferrer"
        aria-label="打开 EverMemoryArchive GitHub 仓库"
        title="GitHub"
      >
        <GithubMark />
      </a>
    </main>
  );
}
