"use client";

import { useState } from "react";
import styles from "./page.module.css";

interface Message {
  role: string;
  content: string;
}

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
        throw new Error("Failed to get response");
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
        <span className={styles.icon}>🐋</span>
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
              <div
                key={index}
                className={`${styles.message} ${
                  message.role === "user" ? styles.userMessage : styles.assistantMessage
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
          className={styles.input}
          placeholder="Message DeepSeek"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={isLoading}
        />
        <div className={styles.buttonGroup}>
          <button type="button" className={styles.actionButton} disabled>
            🧠 DeepThink
          </button>
          <button type="button" className={styles.actionButton} disabled>
            🌐 Search
          </button>
          <button
            type="submit"
            className={styles.sendButton}
            disabled={isLoading || !inputValue.trim()}
          >
            ⬆️
          </button>
        </div>
      </form>
    </div>
  );
}
