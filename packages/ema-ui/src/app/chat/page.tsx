"use client";

import { useState, useEffect, useRef } from "react";
import styles from "./page.module.css";
import type { ActorAgentEvent, Message } from "ema";

let initialLoadPromise: Promise<Message[] | null> | null = null;
let initialMessagesCache: Message[] | null = null;

// todo: consider adding tests for this component to verify message state management
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [snapshotting, setSnapshotting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const chatAreaRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Set up SSE connection to subscribe to actor events
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let isActive = true;

    const init = async () => {
      setInitializing(true);
      try {
        if (!initialLoadPromise) {
          initialLoadPromise = (async () => {
            try {
              await fetch("/api/users/login");
            } catch (error) {
              console.error("Error logging in:", error);
            }

            try {
              const response = await fetch(
                "/api/conversations/messages?conversationId=1&limit=100",
              );
              if (response.ok) {
                const data = (await response.json()) as { messages: Message[] };
                if (Array.isArray(data.messages)) {
                  return data.messages;
                }
              }
            } catch (error) {
              console.error("Error loading history:", error);
            }
            return null;
          })().catch((error) => {
            initialLoadPromise = null;
            throw error;
          });
        }

        if (!initialMessagesCache) {
          initialMessagesCache = await initialLoadPromise;
        }

        if (isActive && Array.isArray(initialMessagesCache)) {
          setMessages(initialMessagesCache);
          setNotice("Conversation history loaded.");
        }
      } finally {
        if (isActive) {
          setInitializing(false);
        }
      }

      if (!isActive) {
        return;
      }

      eventSource = new EventSource(
        "/api/actor/sse?userId=1&actorId=1&conversationId=1",
      );

      eventSource.onmessage = (event) => {
        try {
          const evt = JSON.parse(event.data) as ActorAgentEvent;
          const content = evt.content;
          if (
            evt.kind === "emaReplyReceived" &&
            typeof content === "object" &&
            "reply" in content
          ) {
            setMessages((prev) => [
              ...prev,
              {
                role: "model",
                contents: [{ type: "text", text: content.reply.response }],
              },
            ]);
          }
        } catch (error) {
          console.error("Error parsing SSE event:", error);
        }
      };

      eventSource.onerror = (error) => {
        // todo: reconnect
        console.error("SSE connection error:", error);
        eventSource?.close();
      };
    };

    void init();

    // Cleanup on unmount (EventSource.close() is safe to call multiple times)
    return () => {
      isActive = false;
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      role: "user",
      contents: [{ type: "text", text: inputValue.trim() }],
    };

    // Add user message to conversation
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputValue("");
    try {
      // Send input to actor using the new API
      const response = await fetch("/api/actor/input", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: 1,
          actorId: 1,
          conversationId: 1,
          // TODO: If supporting more input types, need to adjust here
          inputs: userMessage.contents,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to send message: ${response.status} ${response.statusText}`,
        );
      }

      // Response will come through SSE, so we don't need to process it here
    } catch (error) {
      console.error("Error:", error);
      // Add error message to chat
      const errorMessage: Message = {
        role: "model",
        contents: [
          {
            type: "text",
            text: "Sorry, I encountered an error. Please try again.",
          },
        ],
      };
      setMessages([...updatedMessages, errorMessage]);
    }
  };

  const handleSnapshot = async () => {
    setNotice(null);
    setSnapshotting(true);
    try {
      const response = await fetch("/api/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "default" }),
      });
      if (!response.ok) {
        const text = await response.text();
        setNotice(text || "Snapshot failed.");
        return;
      }
      const data = (await response.json().catch(() => null)) as {
        fileName?: string;
      } | null;
      setNotice(
        data?.fileName
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
            Start a conversation with MeowGPT
          </div>
        ) : (
          <div className={styles.messages}>
            {messages.map((message, index) => (
              // Consider adding a unique identifier to each message (e.g., timestamp or UUID) and use that as the key instead.
              <div
                key={index}
                className={`${styles.message} ${
                  message.role === "user"
                    ? styles.userMessage
                    : styles.assistantMessage
                }`}
              >
                <div className={styles.messageRole}>
                  {message.role === "user" ? "You" : "Ema"}
                </div>
                <div className={styles.messageContent}>
                  {message.contents![0].text}
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
          placeholder="Enter message..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={initializing}
        />
        <div className={styles.buttonGroup}>
          <button
            type="submit"
            aria-label="Send message"
            className={styles.sendButton}
            disabled={initializing || !inputValue.trim()}
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
