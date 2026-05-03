import { MessageSquareQuote, X } from "lucide-react";
import styles from "@/app/dashboard/page.module.css";

import type { ChatMessageViewModel } from "@/features/chat/view-model";
import type { InputContent } from "@/types/chat/v1beta1";

export interface ReplyPreview {
  title: string;
  text: string;
  idLabel?: string;
  targetMessageId?: string;
}

function getDisplayUserName(name: string) {
  const trimmed = name.trim();
  return trimmed && trimmed !== "EMA User" ? trimmed : "你";
}

export function renderMessageTime(timeLabel: string, time?: number) {
  if (!timeLabel) {
    return null;
  }

  return (
    <time
      className={styles.messageTime}
      dateTime={
        typeof time === "number" ? new Date(time).toISOString() : undefined
      }
      data-copy-ignore="true"
      aria-label={`发送时间 ${timeLabel}`}
    >
      {timeLabel}
    </time>
  );
}

export function renderMessageContents(contents: InputContent[]) {
  return contents.map((content, index) => {
    if (content.type === "text") {
      return <p key={index}>{content.text}</p>;
    }

    if (content.mimeType.startsWith("image/")) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={index}
          className={styles.inlineImage}
          src={`data:${content.mimeType};base64,${content.data}`}
          alt="图片"
          data-copy-text="[图片]"
        />
      );
    }

    return (
      <p key={index} className={styles.attachmentText}>
        {content.text?.trim() || content.mimeType}
      </p>
    );
  });
}

export function buildReplyPreview(
  replyTo: ChatMessageViewModel["replyTo"],
  messageByMsgId: Map<number, ChatMessageViewModel>,
  userName: string,
): ReplyPreview | null {
  if (!replyTo) {
    return null;
  }

  if (replyTo.kind !== "msg") {
    return {
      title: "引用消息",
      text: "来自其他渠道的消息",
    };
  }

  const source = messageByMsgId.get(replyTo.msgId);
  if (!source) {
    return {
      title: "引用消息",
      text: `消息 #${replyTo.msgId}`,
      idLabel: `#${replyTo.msgId}`,
    };
  }

  const text =
    source.contents
      .map((content) => {
        if (content.type === "text") {
          return content.text.trim();
        }
        if (content.text?.trim()) {
          return content.text.trim();
        }
        if (content.mimeType.startsWith("image/")) {
          return "[图片]";
        }
        return `[${content.mimeType}]`;
      })
      .filter(Boolean)
      .join(" ") || "消息";

  return {
    title: source.role === "user" ? getDisplayUserName(userName) : source.name,
    text,
    targetMessageId: source.id,
    ...(typeof source.msgId === "number"
      ? { idLabel: `#${source.msgId}` }
      : {}),
  };
}

export function renderReplyPreview(
  preview: ReplyPreview,
  onJumpToMessage: (messageId: string) => void,
) {
  const content = (
    <>
      <span className={styles.replyPreviewMeta}>
        <span className={styles.replyPreviewTitle}>
          <MessageSquareQuote aria-hidden="true" />
          <span>{preview.title}</span>
        </span>
        {preview.idLabel ? (
          <span className={styles.replyPreviewId}>{preview.idLabel}</span>
        ) : null}
      </span>
      <span className={styles.replyPreviewText}>{preview.text}</span>
    </>
  );

  if (preview.targetMessageId) {
    return (
      <button
        type="button"
        className={`${styles.replyPreview} ${styles.replyPreviewClickable}`}
        data-copy-ignore="true"
        aria-label={`跳转到引用消息 ${preview.idLabel ?? ""}`.trim()}
        onClick={(event) => {
          event.currentTarget.blur();
          onJumpToMessage(preview.targetMessageId!);
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={styles.replyPreview} data-copy-ignore="true">
      {content}
    </div>
  );
}

export function renderComposerReplyPreview(
  preview: ReplyPreview,
  onCancel: () => void,
) {
  return (
    <div className={styles.composerReplyPreview} aria-label="正在引用消息">
      <span className={styles.replyPreviewMeta}>
        <span className={styles.replyPreviewTitle}>
          <MessageSquareQuote aria-hidden="true" />
          <span>{preview.title}</span>
        </span>
        {preview.idLabel ? (
          <span className={styles.replyPreviewId}>{preview.idLabel}</span>
        ) : null}
      </span>
      <span className={styles.replyPreviewText}>{preview.text}</span>
      <button
        type="button"
        className={styles.composerReplyCancel}
        aria-label="取消引用"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onCancel}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

export function renderMessageId(message: ChatMessageViewModel) {
  if (typeof message.msgId !== "number") {
    return null;
  }

  return (
    <span
      className={styles.messageIdBadge}
      data-copy-ignore="true"
      aria-hidden="true"
    >
      #{message.msgId}
    </span>
  );
}
