import type {
  ConversationMessage,
  InputContent,
  MessageReplyRef,
} from "@/types/chat/v1beta1";

export type ChatMessageRole = "actor" | "user";

const TIMELINE_SEPARATOR_GAP_MS = 30 * 60 * 1000;

export interface ChatMessageViewModel {
  id: string;
  role: ChatMessageRole;
  msgId?: number;
  time?: number;
  timeLabel: string;
  name: string;
  text: string;
  contents: InputContent[];
  replyTo?: MessageReplyRef;
}

export interface ChatMessageGroupViewModel {
  id: string;
  role: ChatMessageRole;
  messages: ChatMessageViewModel[];
}

export type ChatTimelineItemViewModel =
  | {
      type: "separator";
      id: string;
      label: string;
      tone: "date" | "time";
    }
  | {
      type: "group";
      id: string;
      group: ChatMessageGroupViewModel;
    };

export function buildChatMessageViewModels(
  messages: ConversationMessage[],
): ChatMessageViewModel[] {
  return messages.map((message, index) => ({
    id: buildMessageKey(message, index),
    role: message.kind,
    msgId: message.msgId,
    time: message.time,
    timeLabel: formatMessageTime(message.time),
    name: message.name,
    text: formatContentsPreview(message.contents),
    contents: message.contents,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
  }));
}

export function groupChatMessages(
  messages: ChatMessageViewModel[],
): ChatMessageGroupViewModel[] {
  return messages.reduce<ChatMessageGroupViewModel[]>((groups, message) => {
    const currentGroup = groups.at(-1);
    if (currentGroup && shouldAppendToGroup(currentGroup, message)) {
      currentGroup.messages.push(message);
      return groups;
    }

    groups.push({
      id: message.id,
      role: message.role,
      messages: [message],
    });
    return groups;
  }, []);
}

export function buildChatTimelineItems(
  messages: ChatMessageViewModel[],
): ChatTimelineItemViewModel[] {
  const items: ChatTimelineItemViewModel[] = [];
  let activeGroup: ChatMessageGroupViewModel | null = null;

  messages.forEach((message, index) => {
    const previousMessage = index > 0 ? messages[index - 1] : null;
    const separator = buildTimelineSeparator(previousMessage, message);
    if (separator) {
      activeGroup = null;
      items.push(separator);
    }

    if (activeGroup && shouldAppendToGroup(activeGroup, message)) {
      activeGroup.messages.push(message);
      return;
    }

    activeGroup = {
      id: message.id,
      role: message.role,
      messages: [message],
    };
    items.push({
      type: "group",
      id: activeGroup.id,
      group: activeGroup,
    });
  });

  return items;
}

function buildMessageKey(message: ConversationMessage, index: number) {
  return typeof message.msgId === "number"
    ? `${message.kind}-${message.msgId}`
    : `${message.kind}-pending-${index}`;
}

function formatContentsPreview(contents: InputContent[]) {
  const parts = contents
    .map((content) => {
      if (content.type === "text") {
        return content.text;
      }
      if (content.text?.trim()) {
        return content.text;
      }
      if (content.mimeType.startsWith("image/")) {
        return "[图片]";
      }
      return `（${content.mimeType}）`;
    })
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.join(" ");
}

const messageTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatMessageTime(time?: number) {
  if (typeof time !== "number" || !Number.isFinite(time)) {
    return "";
  }

  return messageTimeFormatter.format(new Date(time));
}

function shouldAppendToGroup(
  group: ChatMessageGroupViewModel,
  message: ChatMessageViewModel,
) {
  return group.role === message.role;
}

function buildTimelineSeparator(
  previousMessage: ChatMessageViewModel | null,
  message: ChatMessageViewModel,
): ChatTimelineItemViewModel | null {
  if (!isValidTime(message.time)) {
    return null;
  }

  if (!previousMessage || !isValidTime(previousMessage.time)) {
    return {
      type: "separator",
      id: `date-${dateKey(message.time)}-${message.id}`,
      label: formatTimelineSeparatorTime(message.time),
      tone: "date",
    };
  }

  if (!isSameLocalDay(previousMessage.time, message.time)) {
    return {
      type: "separator",
      id: `date-${dateKey(message.time)}-${message.id}`,
      label: formatTimelineSeparatorTime(message.time),
      tone: "date",
    };
  }

  if (message.time - previousMessage.time >= TIMELINE_SEPARATOR_GAP_MS) {
    return {
      type: "separator",
      id: `time-${previousMessage.id}-${message.id}`,
      label: formatTimelineSeparatorTime(message.time),
      tone: "time",
    };
  }

  return null;
}

function isValidTime(time: number | undefined): time is number {
  return typeof time === "number" && Number.isFinite(time);
}

function formatTimelineSeparatorTime(time: number) {
  const date = new Date(time);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const timeLabel = formatMessageTime(time);

  if (isSameLocalDay(time, today.getTime())) {
    return timeLabel;
  }

  if (isSameLocalDay(time, yesterday.getTime())) {
    return `昨天 ${timeLabel}`;
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  if (date.getFullYear() === today.getFullYear()) {
    return `${month}/${day} ${timeLabel}`;
  }

  return `${date.getFullYear()}/${month}/${day} ${timeLabel}`;
}

function isSameLocalDay(leftTime: number, rightTime: number) {
  return dateKey(leftTime) === dateKey(rightTime);
}

function dateKey(time: number) {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
