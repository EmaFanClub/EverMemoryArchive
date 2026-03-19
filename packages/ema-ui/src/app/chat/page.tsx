"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import {
  collapseContents,
  parseReplyRef,
  type ActorResponse,
  type ConversationMessage,
  type InputContent,
  type TextItem,
} from "ema/shared";

const DEFAULT_USER_ID = 1;
const DEFAULT_ACTOR_ID = 1;
const DEFAULT_USER_UID = "1";
const DEFAULT_USER_NAME = "alice";
const DEFAULT_ACTOR_NAME = "Ema";
const DEFAULT_WEB_SESSION = `web-chat-${DEFAULT_USER_UID}`;

interface InitialChatState {
  session: string;
  messages: ConversationMessage[];
}

let chatInitPromise: Promise<InitialChatState> | null = null;
let chatInitCache: InitialChatState | null = null;

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function renderContents(contents: InputContent[]): string {
  return (collapseContents(contents, false) as TextItem[])
    .map((content) => content.text)
    .join("");
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [connected, setConnected] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const chatAreaRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let eventSource: EventSource | null = null;

    const init = async () => {
      setInitializing(true);
      try {
        if (!chatInitPromise) {
          chatInitPromise = (async () => {
            const history = await fetchJson<{
              messages: ConversationMessage[];
            }>(
              `/api/v1/chat/${encodeURIComponent(DEFAULT_WEB_SESSION)}/history?limit=100`,
            );

            return {
              session: DEFAULT_WEB_SESSION,
              messages: history.messages,
            };
          })().catch((error) => {
            chatInitPromise = null;
            throw error;
          });
        }

        if (!chatInitCache) {
          chatInitCache = await chatInitPromise;
        }

        if (!active) {
          return;
        }

        sessionRef.current = chatInitCache.session;
        setMessages(chatInitCache.messages);
        setNotice("Conversation history loaded.");

        eventSource = new EventSource(
          `/api/v1/chat/${encodeURIComponent(chatInitCache.session)}/sse`,
        );

        eventSource.onopen = () => {
          setConnected(true);
        };

        eventSource.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as
              | ActorResponse
              | { kind: "ready" };
            setConnected(true);
            if (payload.kind !== "chat") {
              return;
            }
            setMessages((prev) => [
              ...prev,
              {
                kind: "actor",
                msgId: payload.msgId,
                name: DEFAULT_ACTOR_NAME,
                contents: [{ type: "text", text: payload.ema_reply.contents }],
                ...(payload.ema_reply.reply_to
                  ? (() => {
                      const replyTo = parseReplyRef(payload.ema_reply.reply_to);
                      return replyTo ? { replyTo } : {};
                    })()
                  : {}),
              },
            ]);
          } catch (error) {
            console.error("Failed to parse SSE payload:", error);
          }
        };

        eventSource.onerror = () => {
          setConnected(false);
          setNotice("SSE connection error.");
        };
      } catch (error) {
        console.error("Failed to initialize chat:", error);
        setNotice(
          error instanceof Error
            ? error.message
            : "Chat initialization failed.",
        );
      } finally {
        if (active) {
          setInitializing(false);
        }
      }
    };

    void init();

    return () => {
      active = false;
      eventSource?.close();
    };
  }, []);

  useEffect(() => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) {
      return;
    }
    if (shouldAutoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [messages.length]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current);
    }
    snapshotTimerRef.current = setTimeout(() => {
      setNotice(null);
      snapshotTimerRef.current = null;
    }, 3200);
    return () => {
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
    };
  }, [notice]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = inputValue.trim();
    const session = sessionRef.current;
    if (!text || !session) {
      return;
    }

    const userMessage: ConversationMessage = {
      kind: "user",
      uid: DEFAULT_USER_UID,
      name: DEFAULT_USER_NAME,
      contents: [{ type: "text", text }],
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");

    try {
      const result = await fetchJson<{
        ok: boolean;
        msgId?: number;
      }>(`/api/v1/chat/${encodeURIComponent(session)}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: DEFAULT_USER_ID,
          actorId: DEFAULT_ACTOR_ID,
          uid: DEFAULT_USER_UID,
          name: DEFAULT_USER_NAME,
          text,
          time: Date.now(),
        }),
      });
      if (result.ok && typeof result.msgId === "number") {
        setMessages((prev) =>
          prev.map((message) =>
            message === userMessage
              ? {
                  ...message,
                  msgId: result.msgId,
                }
              : message,
          ),
        );
      }
    } catch (error) {
      console.error("Failed to send chat message:", error);
      setNotice(
        error instanceof Error ? error.message : "Failed to send message.",
      );
    }
  };

  const handleSnapshot = async () => {
    setNotice(null);
    setSnapshotting(true);
    try {
      const data = await fetchJson<{ fileName?: string }>("/api/v1/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "default" }),
      });
      setNotice(
        data.fileName
          ? `Snapshot saved: ${data.fileName}`
          : "Snapshot created.",
      );
    } catch (error) {
      console.error("Snapshot error:", error);
      setNotice("Snapshot failed.");
    } finally {
      setSnapshotting(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>How can I help you?</h1>
        </div>
        <button
          className={styles.snapshotButton}
          onClick={handleSnapshot}
          disabled={snapshotting}
        >
          {snapshotting ? "Snapshotting..." : "Snapshot"}
        </button>
      </div>
      {notice ? <div className={styles.snapshotStatus}>{notice}</div> : null}

      <div
        className={styles.chatArea}
        ref={chatAreaRef}
        onScroll={() => {
          const chatArea = chatAreaRef.current;
          if (!chatArea) {
            return;
          }
          const gap = 80;
          const distanceToBottom =
            chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
          shouldAutoScrollRef.current = distanceToBottom <= gap;
        }}
      >
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            {initializing ? "Connecting to EMA..." : "Start a conversation"}
          </div>
        ) : (
          <div className={styles.messages}>
            {messages.map((message, index) => (
              <div
                key={index}
                className={`${styles.message} ${
                  message.kind === "user"
                    ? styles.userMessage
                    : styles.assistantMessage
                }`}
              >
                <div className={styles.messageRole}>{message.name}</div>
                <div className={styles.messageContent}>
                  {renderContents(message.contents)}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} className={styles.messagesEnd} />
          </div>
        )}
      </div>

      <form className={styles.inputArea} onSubmit={handleSubmit}>
        <input
          type="text"
          aria-label="Chat message input"
          className={styles.input}
          placeholder={connected ? "Enter message..." : "Connecting..."}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          disabled={initializing || !connected}
        />
        <div className={styles.buttonGroup}>
          <button
            type="submit"
            aria-label="Send message"
            className={styles.sendButton}
            disabled={initializing || !connected || !inputValue.trim()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8.3125 0.981587C8.66767 1.0545 8.97902 1.20558 9.2627 1.43374C9.48724 1.61438 9.73029 1.85933 9.97949 2.10854L14.707 6.83608L13.293 8.25014L9 3.95717V15.0431H7V3.95717L2.70703 8.25014L1.29297 6.83608L6.02051 2.10854C6.26971 1.85933 6.51277 1.61438 6.7373 1.43374C6.97662 1.24126 7.28445 1.04542 7.6875 0.981587C7.8973 0.94841 8.1031 0.956564 8.3125 0.981587Z"
                fill="currentColor"
              ></path>
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
