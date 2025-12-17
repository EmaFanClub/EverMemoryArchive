"use client";

import { useState } from "react";
import styles from "./page.module.css";
import type { Message } from "ema";

// todo: consider adding tests for this component to verify message state management
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "system",
      content: "You are MeowGPT and replies to me cutely. You speak chinese.",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
      // Call the chat API
      const response = await fetch("/api/roles/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: updatedMessages,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to get response: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();

      // Add assistant response to conversation
      const assistantMessage: Message = {
        role: "assistant",
        content: data.content,
      };

      setMessages([...updatedMessages, assistantMessage]);
    } catch (error) {
      console.error("Error:", error);
      // Optionally add error message to chat
      const errorMessage: Message = {
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
      };
      setMessages([...updatedMessages, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter out system message for display
  const displayMessages = messages.filter((msg) => msg.role !== "system");

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>How can I help you?</h1>
      </div>

      <div className={styles.chatArea}>
        {displayMessages.length === 0 ? (
          <div className={styles.emptyState}>
            Start a conversation with MeowGPT
          </div>
        ) : (
          <div className={styles.messages}>
            {displayMessages.map((message, index) => (
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
