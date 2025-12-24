"use client";

import { useState, useEffect } from "react";
import styles from "./page.module.css";
import type { Message, ActorEvent } from "ema";

// todo: consider adding tests for this component to verify message state management
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Set up SSE connection to subscribe to actor events
  useEffect(() => {
    const eventSource = new EventSource("/api/actor/sse?userId=1&actorId=1");

    eventSource.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data);

        // Process events from the actor
        if (response.events && Array.isArray(response.events)) {
          response.events.forEach((evt: ActorEvent) => {
            console.log("evt", evt);

            const content = evt.content;
            // Handles LLM response which contains the assistant's message
            if (
              evt.type === "runFinished" &&
              typeof content === "object" &&
              "msg" in content
            ) {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: content.msg },
              ]);
            }
          });
        }

        // Update loading state based on actor status
        if (response.status === "idle") {
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Error parsing SSE event:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE connection error:", error);
      eventSource.close();
    };

    // Cleanup on unmount (EventSource.close() is safe to call multiple times)
    return () => {
      eventSource.close();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      content: inputValue.trim(),
    };

    // Add user message to conversation
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputValue("");
    setIsLoading(true);

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
          inputs: [{ kind: "text", content: userMessage.content }],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to send message: ${response.status} ${response.statusText}`,
        );
      }

      // Response will come through SSE, so we don't need to process it here
      // Note: isLoading remains true until SSE event with status 'idle' arrives
    } catch (error) {
      console.error("Error:", error);
      // Add error message to chat
      const errorMessage: Message = {
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
      };
      setMessages([...updatedMessages, errorMessage]);
      // Reset loading state since no SSE event will come if the request failed
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>How can I help you?</h1>
      </div>

      <div className={styles.chatArea}>
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
                  {message.role === "user" ? "You" : "MeowGPT"}
                </div>
                <div className={styles.messageContent}>{message.content}</div>
              </div>
            ))}
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
          disabled={isLoading}
        />
        <div className={styles.buttonGroup}>
          <button
            type="submit"
            aria-label="Send message"
            className={styles.sendButton}
            disabled={isLoading || !inputValue.trim()}
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
