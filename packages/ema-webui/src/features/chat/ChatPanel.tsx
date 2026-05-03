"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import Image from "next/image";
import {
  ArrowDown,
  Check,
  ChevronRight,
  Copy,
  ImagePlus,
  LoaderCircle,
  Menu,
  MessageSquareQuote,
  Send,
  X,
} from "lucide-react";
import styles from "@/app/dashboard/page.module.css";

import {
  buildChatMessageViewModels,
  buildChatTimelineItems,
  type ChatMessageViewModel,
} from "@/features/chat/view-model";
import {
  buildClipboardItemData,
  buildMessageClipboardContent,
  buildSelectedClipboardContent,
  escapeClipboardHtml,
  hasSelectionInsideElement,
} from "@/features/chat/clipboard";
import {
  EMPTY_COMPOSER_SNAPSHOT,
  SUPPORTED_COMPOSER_IMAGE_MIME_TYPES,
  composerImageToInputContent,
  createComposerImageItem,
  dataUrlToImageFile,
  formatContentsPreviewForLatest,
  getComposerImageCount,
  isComposerSnapshotSendable,
  isSupportedComposerImageMimeType,
  parseComposerPasteHtml,
  readComposerSnapshot,
  revokeComposerImagePreview,
  type ComposerImageItem,
  type ComposerPastePart,
  type ComposerSnapshot,
} from "@/features/chat/composer-helpers";
import {
  buildReplyPreview,
  renderComposerReplyPreview,
  renderMessageContents,
  renderMessageId,
  renderMessageTime,
  renderReplyPreview,
} from "@/features/chat/message-rendering";
import { getChatHistory, sendChatMessage } from "@/transport/chat";
import { subscribeChatEvents } from "@/transport/chat-stream";
import type {
  ConversationMessage,
  InputContent,
  MessageReplyRef,
} from "@/types/chat/v1beta1";
import type {
  ActorRuntimeStatus,
  ActorSummary,
} from "@/types/dashboard/v1beta1";

type ChatHistoryStage = "loading" | "revealing" | "ready";
type LatestScrollState = "latest" | "history" | "returning";
type LocalConversationMessage = ConversationMessage & {
  __correlationId?: string;
};

interface MessageContextMenuState {
  messageId: string;
  closing: boolean;
  copyEnabled: boolean;
}

interface CopyToastState {
  id: number;
  message: string;
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
const PIN_TO_LATEST_THRESHOLD = 24;
const HISTORY_PAGE_SIZE = 30;
const COMPOSER_TEXTAREA_MIN_HEIGHT = 22;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 116;
const MESSAGE_SCROLLBAR_IDLE_DELAY = 3000;
const MESSAGE_SCROLLBAR_HOVER_WIDTH = 14;
const MESSAGE_SCROLLBAR_MIN_THUMB_HEIGHT = 32;
const MESSAGE_JUMP_TOP_OFFSET = 34;
const LIVE_MESSAGE_ANIMATION_DURATION = 560;
const HISTORY_REVEAL_ANIMATION_DURATION = 360;
const HISTORY_REVEAL_STAGGER = 42;
const HISTORY_REVEAL_MAX_STEPS = 18;
const HISTORY_TOP_PULL_MAX = 58;
const HISTORY_TOP_PULL_TRIGGER = 38;
const HISTORY_TOP_PULL_SETTLE_DURATION = 360;
const COMPOSER_MAX_IMAGE_COUNT = 3;
const COMPOSER_MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const COPY_TOAST_DURATION = 1400;
const DEFAULT_WEB_CHAT_SESSION = "web-chat-1";
const statusText: Record<ActorRuntimeStatus, string> = {
  sleep: "睡眠",
  online: "在线",
  busy: "忙碌",
  offline: "离线",
};
const transitionText = {
  booting: "启动中",
  shutting_down: "关闭中",
  waking: "唤醒中",
  sleeping: "入睡中",
} as const;

function userInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "U";
}

function actorAvatarText(name: string) {
  const actorMatch = /^actor\s*(\d+)$/i.exec(name.trim());
  if (actorMatch?.[1]) {
    return `A${actorMatch[1]}`;
  }

  return Array.from(name.trim()).slice(0, 2).join("").toUpperCase() || "A";
}

function createCorrelationId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildConversationMessageKey(
  message: ConversationMessage,
  fallbackIndex: number,
) {
  return typeof message.msgId === "number"
    ? `${message.kind}-${message.msgId}`
    : `${message.kind}-pending-${fallbackIndex}`;
}

function getNextConversationMessageId(messages: ConversationMessage[]) {
  return (
    messages.reduce(
      (maxMsgId, message) => Math.max(maxMsgId, message.msgId ?? 0),
      0,
    ) + 1
  );
}

export function ChatPanel({
  actor,
  userName,
  onActorLatestMessage,
  actorInfoVisible,
  onToggleActorInfo,
}: {
  actor: ActorSummary;
  userName: string;
  onActorLatestMessage: (actorId: string, text: string, time: number) => void;
  actorInfoVisible: boolean;
  onToggleActorInfo: () => void;
}) {
  const [messages, setMessages] = useState<LocalConversationMessage[]>([]);
  const latestMessagesRef = useRef<LocalConversationMessage[]>([]);
  const nextLocalMsgIdRef = useRef(1);
  const [messageMenu, setMessageMenu] =
    useState<MessageContextMenuState | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [historyStage, setHistoryStage] = useState<ChatHistoryStage>("loading");
  const [olderHistoryState, setOlderHistoryState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [nextBeforeMsgId, setNextBeforeMsgId] = useState<number | null>(null);
  const messageViewModels = buildChatMessageViewModels(messages);
  const messageByMsgId = new Map(
    messageViewModels.flatMap((message) =>
      typeof message.msgId === "number" ? [[message.msgId, message]] : [],
    ),
  );
  const chatTimelineItems = buildChatTimelineItems(messageViewModels);
  const messageStreamRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const composerEditorRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const composerDockRef = useRef<HTMLFormElement>(null);
  const latestScrollStateRef = useRef<LatestScrollState>("latest");
  const pendingCorrelationIdsRef = useRef<Map<string, number>>(new Map());
  const confirmedCorrelationIdsRef = useRef<Set<string>>(new Set());
  const isPinnedToLatestRef = useRef(true);
  const composerReservedHeightRef = useRef(120);
  const isMessageScrollbarHoveredRef = useRef(false);
  const messageScrollbarVisibleRef = useRef(false);
  const messageScrollbarIdleTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const liveMessageAnimationTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const historyRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const topPullDistanceRef = useRef(0);
  const topPullSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const topPullReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const composerNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const copyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const olderHistoryLoadingRef = useRef(false);
  const pendingScrollRestoreRef = useRef<{
    anchorMessageId: string | null;
    anchorOffsetTop: number;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const closeMenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachmentImagesRef = useRef<ComposerImageItem[]>([]);
  const inlineImagesByIdRef = useRef<Record<string, ComposerImageItem>>({});
  const [composerSnapshot, setComposerSnapshot] = useState<ComposerSnapshot>(
    EMPTY_COMPOSER_SNAPSHOT,
  );
  const [attachmentImages, setAttachmentImages] = useState<ComposerImageItem[]>(
    [],
  );
  const [inlineImagesById, setInlineImagesById] = useState<
    Record<string, ComposerImageItem>
  >({});
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<CopyToastState | null>(null);
  const [composerIsSending, setComposerIsSending] = useState(false);
  const [composerEditorScrollable, setComposerEditorScrollable] =
    useState(false);
  const [composerReservedHeight, setComposerReservedHeight] = useState(120);
  const [messageScrollbarVisible, setMessageScrollbarVisible] = useState(false);
  const [liveMessageIds, setLiveMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [messageScrollbarMetrics, setMessageScrollbarMetrics] = useState({
    canScroll: false,
    thumbHeight: 0,
    thumbTop: 0,
  });
  const [topPullDistance, setTopPullDistance] = useState(0);
  const [isTopPullSettling, setIsTopPullSettling] = useState(false);
  const [latestScrollState, setLatestScrollState] =
    useState<LatestScrollState>("latest");
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [conversationTyping, setConversationTyping] = useState(false);
  const [composerReplyTo, setComposerReplyTo] =
    useState<MessageReplyRef | null>(null);
  const composerImageCount = getComposerImageCount(
    attachmentImages,
    inlineImagesById,
  );
  const lifecycleInputLocked =
    actor.transition === "booting" || actor.transition === "shutting_down";
  const composerLocked = actor.status === "offline" || lifecycleInputLocked;
  const composerLockedNotice =
    actor.transition === "booting"
      ? "角色正在启动，稍后再发送"
      : actor.transition === "shutting_down"
        ? "角色正在关闭，稍后再发送"
        : "请先在设置页启用角色";
  const canSendMessage =
    !composerLocked &&
    !composerIsSending &&
    (attachmentImages.length > 0 ||
      isComposerSnapshotSendable(composerSnapshot));

  const allocateNextLocalMessageId = useCallback(() => {
    const nextMsgId = Math.max(
      nextLocalMsgIdRef.current,
      getNextConversationMessageId(latestMessagesRef.current),
    );
    nextLocalMsgIdRef.current = nextMsgId + 1;
    return nextMsgId;
  }, []);

  function showComposerNotice(message: string) {
    if (composerNoticeTimerRef.current) {
      clearTimeout(composerNoticeTimerRef.current);
    }

    setComposerNotice(message);
    composerNoticeTimerRef.current = setTimeout(() => {
      setComposerNotice(null);
      composerNoticeTimerRef.current = null;
    }, 2200);
  }

  function showCopyToast(message = "已复制") {
    if (copyToastTimerRef.current) {
      clearTimeout(copyToastTimerRef.current);
    }

    setCopyToast((current) => ({
      id: (current?.id ?? 0) + 1,
      message,
    }));
    copyToastTimerRef.current = setTimeout(() => {
      setCopyToast(null);
      copyToastTimerRef.current = null;
    }, COPY_TOAST_DURATION);
  }

  function clearCurrentTextSelection() {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      selection.removeAllRanges();
    }
  }

  function syncComposerEditorState() {
    const snapshot = readComposerSnapshot(composerEditorRef.current);
    const usedInlineImageIds = new Set(snapshot.imageIds);

    clearSelectedComposerImages();
    setComposerSnapshot(snapshot);
    setInlineImagesById((current) => {
      let changed = false;
      const nextImages: Record<string, ComposerImageItem> = {};

      Object.entries(current).forEach(([imageId, image]) => {
        if (usedInlineImageIds.has(imageId)) {
          nextImages[imageId] = image;
          return;
        }

        changed = true;
        revokeComposerImagePreview(image);
      });

      return changed ? nextImages : current;
    });
    syncComposerEditorLayoutToCaret();
  }

  function resizeComposerEditorToContent() {
    const editor = composerEditorRef.current;
    if (!editor) {
      return;
    }

    editor.style.height = `${COMPOSER_TEXTAREA_MIN_HEIGHT}px`;
    const scrollHeight = editor.scrollHeight;
    const shouldScroll = scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT + 1;

    editor.style.height = `${
      shouldScroll ? COMPOSER_TEXTAREA_MAX_HEIGHT : scrollHeight
    }px`;
    setComposerEditorScrollable((current) =>
      current === shouldScroll ? current : shouldScroll,
    );
  }

  function keepComposerCaretVisible() {
    const editor = composerEditorRef.current;
    if (!editor) {
      return;
    }

    editor.scrollTop = editor.scrollHeight;
  }

  function syncComposerEditorLayoutToCaret() {
    window.requestAnimationFrame(() => {
      resizeComposerEditorToContent();
      keepComposerCaretVisible();
    });
  }

  function clearComposerEditor() {
    const editor = composerEditorRef.current;
    if (editor) {
      editor.textContent = "";
      resizeComposerEditorToContent();
    }
    setComposerSnapshot(EMPTY_COMPOSER_SNAPSHOT);
  }

  function insertInlineImageBlockAtCursor(image: ComposerImageItem) {
    const editor = composerEditorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    const imageBlock = document.createElement("span");
    imageBlock.className = styles.composerInlineImageBlock;
    imageBlock.contentEditable = "false";
    imageBlock.dataset.composerImageId = image.id;

    const preview = document.createElement("img");
    preview.src = image.previewUrl;
    preview.alt = image.fileName;
    preview.draggable = false;
    preview.onload = resizeComposerEditorToContent;

    imageBlock.append(preview);

    const selection = window.getSelection();
    let range =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0)
        : document.createRange();

    if (!editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    range.deleteContents();
    range.insertNode(imageBlock);
    range.setStartAfter(imageBlock);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    window.requestAnimationFrame(() => {
      syncComposerEditorState();
      resizeComposerEditorToContent();
      keepComposerCaretVisible();
    });
  }

  function insertTextAtComposerCursor(text: string) {
    const editor = composerEditorRef.current;
    if (!editor || !text) {
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    let range =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0)
        : document.createRange();

    if (!editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function clearSelectedComposerImages() {
    composerEditorRef.current
      ?.querySelectorAll<HTMLElement>("[data-composer-image-id][data-selected]")
      .forEach((element) => {
        delete element.dataset.selected;
      });
  }

  function selectComposerImageBlock(imageBlock: HTMLElement) {
    clearSelectedComposerImages();
    imageBlock.dataset.selected = "true";

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNode(imageBlock);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function removeInlineImage(imageId: string) {
    const editor = composerEditorRef.current;
    const imageBlock = editor?.querySelector<HTMLElement>(
      `[data-composer-image-id="${CSS.escape(imageId)}"]`,
    );
    const parentNode = imageBlock?.parentNode ?? null;
    const fallbackOffset = imageBlock
      ? Array.from(parentNode?.childNodes ?? []).indexOf(imageBlock)
      : 0;

    imageBlock?.remove();

    setInlineImagesById((current) => {
      const image = current[imageId];
      if (!image) {
        return current;
      }

      const nextImages = { ...current };
      delete nextImages[imageId];
      revokeComposerImagePreview(image);
      return nextImages;
    });
    syncComposerEditorState();
    editor?.focus();

    if (parentNode) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(parentNode, Math.max(0, fallbackOffset));
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  function removeInlineImageElement(imageBlock: HTMLElement) {
    const imageId = imageBlock.dataset.composerImageId;
    if (!imageId) {
      return false;
    }

    removeInlineImage(imageId);
    return true;
  }

  function getComposerImageBlockFromNode(node: Node | null) {
    if (!node) {
      return null;
    }

    const element =
      node instanceof HTMLElement ? node : (node.parentElement ?? null);
    return element?.closest<HTMLElement>("[data-composer-image-id]") ?? null;
  }

  function getSelectedComposerImageBlocks() {
    const selection = window.getSelection();
    const editor = composerEditorRef.current;
    if (
      !selection ||
      selection.isCollapsed ||
      !editor ||
      selection.rangeCount === 0
    ) {
      return [];
    }

    const range = selection.getRangeAt(0);
    return Array.from(
      editor.querySelectorAll<HTMLElement>("[data-composer-image-id]"),
    ).filter((imageBlock) => range.intersectsNode(imageBlock));
  }

  function deleteSelectedComposerContentIfHasImages() {
    const selection = window.getSelection();
    const editor = composerEditorRef.current;
    if (
      !selection ||
      selection.isCollapsed ||
      !editor ||
      selection.rangeCount === 0 ||
      getSelectedComposerImageBlocks().length === 0
    ) {
      return false;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    selection.removeAllRanges();
    selection.addRange(range);
    syncComposerEditorState();
    editor.focus();
    return true;
  }

  function getAdjacentComposerImageBlockForDeletion(
    key: "Backspace" | "Delete",
  ) {
    const selection = window.getSelection();
    const editor = composerEditorRef.current;
    if (
      !selection ||
      !selection.isCollapsed ||
      !editor ||
      selection.rangeCount === 0
    ) {
      return null;
    }

    const range = selection.getRangeAt(0);
    let candidate: Node | null = null;

    if (range.startContainer instanceof Text) {
      const textNode = range.startContainer;
      const textBeforeCursor = textNode.data.slice(0, range.startOffset);
      const textAfterCursor = textNode.data.slice(range.startOffset);

      if (key === "Backspace" && textBeforeCursor.length === 0) {
        candidate = textNode.previousSibling;
      }
      if (key === "Delete" && textAfterCursor.length === 0) {
        candidate = textNode.nextSibling;
      }
    } else if (range.startContainer instanceof Element) {
      candidate =
        key === "Backspace"
          ? (range.startContainer.childNodes[range.startOffset - 1] ?? null)
          : (range.startContainer.childNodes[range.startOffset] ?? null);
    }

    const imageBlock = getComposerImageBlockFromNode(candidate);
    return imageBlock && editor.contains(imageBlock) ? imageBlock : null;
  }

  function maybeDeleteComposerImageWithKey(key: "Backspace" | "Delete") {
    if (deleteSelectedComposerContentIfHasImages()) {
      return true;
    }

    const selectedImageBlock = getAdjacentComposerImageBlockForDeletion(key);

    if (!selectedImageBlock) {
      return false;
    }

    return removeInlineImageElement(selectedImageBlock);
  }

  function addAttachmentImages(files: File[]) {
    if (files.length === 0) {
      return;
    }

    let nextImageCount = composerImageCount;
    const acceptedImages: ComposerImageItem[] = [];
    let notice: string | null = null;

    files.forEach((file) => {
      if (!isSupportedComposerImageMimeType(file.type)) {
        notice = "仅支持图片文件";
        return;
      }

      if (file.size > COMPOSER_MAX_IMAGE_SIZE) {
        notice = "单张图片不能超过5MB";
        return;
      }

      if (nextImageCount >= COMPOSER_MAX_IMAGE_COUNT) {
        notice = "最多发送3张图片";
        return;
      }

      const image = createComposerImageItem(file, "attachment");
      if (!image) {
        notice = "仅支持图片文件";
        return;
      }

      acceptedImages.push(image);
      nextImageCount += 1;
    });

    if (acceptedImages.length > 0) {
      setAttachmentImages((current) => [...current, ...acceptedImages]);
    }

    if (notice) {
      showComposerNotice(notice);
    }
  }

  function addClipboardImages(files: File[]) {
    if (files.length === 0) {
      return;
    }

    let nextImageCount = composerImageCount;
    const acceptedImages: ComposerImageItem[] = [];
    let notice: string | null = null;

    files.forEach((file) => {
      if (!isSupportedComposerImageMimeType(file.type)) {
        notice = "仅支持图片文件";
        return;
      }

      if (file.size > COMPOSER_MAX_IMAGE_SIZE) {
        notice = "单张图片不能超过5MB";
        return;
      }

      if (nextImageCount >= COMPOSER_MAX_IMAGE_COUNT) {
        notice = "最多发送3张图片";
        return;
      }

      const image = createComposerImageItem(file, "clipboard");
      if (!image) {
        notice = "仅支持图片文件";
        return;
      }

      acceptedImages.push(image);
      nextImageCount += 1;
    });

    if (acceptedImages.length > 0) {
      setInlineImagesById((current) => {
        const nextImages = { ...current };
        acceptedImages.forEach((image) => {
          nextImages[image.id] = image;
        });
        return nextImages;
      });
      acceptedImages.forEach(insertInlineImageBlockAtCursor);
      syncComposerEditorState();
    }

    if (notice) {
      showComposerNotice(notice);
    }
  }

  function pasteComposerRichParts(parts: ComposerPastePart[]) {
    if (parts.length === 0) {
      return false;
    }

    let nextImageCount = composerImageCount;
    let imageIndex = 0;
    let notice: string | null = null;
    const acceptedImages: ComposerImageItem[] = [];
    const pasteParts = parts.flatMap<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "image";
          image: ComposerImageItem;
        }
    >((part) => {
      if (part.type === "text") {
        return part.text ? [part] : [];
      }

      const file = dataUrlToImageFile(part.src, imageIndex);
      imageIndex += 1;

      if (!file) {
        notice = "仅支持图片文件";
        return [];
      }

      if (file.size > COMPOSER_MAX_IMAGE_SIZE) {
        notice = "单张图片不能超过5MB";
        return [];
      }

      if (nextImageCount >= COMPOSER_MAX_IMAGE_COUNT) {
        notice = "最多发送3张图片";
        return [];
      }

      const image = createComposerImageItem(file, "clipboard");
      if (!image) {
        notice = "仅支持图片文件";
        return [];
      }

      acceptedImages.push(image);
      nextImageCount += 1;
      return [
        {
          type: "image",
          image,
        },
      ];
    });

    if (acceptedImages.length > 0) {
      setInlineImagesById((current) => {
        const nextImages = { ...current };
        acceptedImages.forEach((image) => {
          nextImages[image.id] = image;
        });
        return nextImages;
      });
    }

    pasteParts.forEach((part) => {
      if (part.type === "text") {
        insertTextAtComposerCursor(part.text);
        return;
      }

      insertInlineImageBlockAtCursor(part.image);
    });

    syncComposerEditorState();

    if (notice) {
      showComposerNotice(notice);
    }

    return pasteParts.length > 0 || Boolean(notice);
  }

  function removeAttachmentImage(imageId: string) {
    setAttachmentImages((current) => {
      const image = current.find((item) => item.id === imageId);
      if (image) {
        revokeComposerImagePreview(image);
      }

      return current.filter((item) => item.id !== imageId);
    });
  }

  function handleComposerEditorClick(event: ReactMouseEvent<HTMLDivElement>) {
    const imageBlock = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-composer-image-id]",
    );

    if (!imageBlock) {
      clearSelectedComposerImages();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectComposerImageBlock(imageBlock);
  }

  function handleComposerPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const richParts = parseComposerPasteHtml(
      event.clipboardData.getData("text/html"),
    );

    if (richParts.some((part) => part.type === "image")) {
      event.preventDefault();
      pasteComposerRichParts(richParts);
      return;
    }

    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    addClipboardImages(files);
  }

  function handleAttachmentInputChange(
    event: ReactChangeEvent<HTMLInputElement>,
  ) {
    addAttachmentImages(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function syncMessageScrollbarMetrics() {
    const stream = messageStreamRef.current;
    if (!stream) {
      return;
    }

    const trackHeight = Math.max(
      0,
      stream.clientHeight - composerReservedHeightRef.current,
    );
    const maxScrollTop = Math.max(0, stream.scrollHeight - stream.clientHeight);
    const canScroll = maxScrollTop > 1 && trackHeight > 0;
    const thumbHeight = canScroll
      ? Math.min(
          trackHeight,
          Math.max(
            MESSAGE_SCROLLBAR_MIN_THUMB_HEIGHT,
            (trackHeight * stream.clientHeight) / stream.scrollHeight,
          ),
        )
      : 0;
    const thumbTop = canScroll
      ? ((trackHeight - thumbHeight) * stream.scrollTop) / maxScrollTop
      : 0;

    setMessageScrollbarMetrics((current) => {
      const next = {
        canScroll,
        thumbHeight: Math.round(thumbHeight),
        thumbTop: Math.round(thumbTop),
      };

      if (
        current.canScroll === next.canScroll &&
        current.thumbHeight === next.thumbHeight &&
        current.thumbTop === next.thumbTop
      ) {
        return current;
      }

      return next;
    });
  }

  function setMessageScrollbarShown(visible: boolean) {
    messageScrollbarVisibleRef.current = visible;
    setMessageScrollbarVisible(visible);
  }

  function setLatestScrollStateValue(nextState: LatestScrollState) {
    latestScrollStateRef.current = nextState;
    setLatestScrollState((current) =>
      current === nextState ? current : nextState,
    );
  }

  function clearMessageScrollbarIdleTimer() {
    if (!messageScrollbarIdleTimerRef.current) {
      return;
    }

    clearTimeout(messageScrollbarIdleTimerRef.current);
    messageScrollbarIdleTimerRef.current = null;
  }

  function clearHistoryRevealTimer() {
    if (!historyRevealTimerRef.current) {
      return;
    }

    clearTimeout(historyRevealTimerRef.current);
    historyRevealTimerRef.current = null;
  }

  function clearTopPullSettleTimer() {
    if (!topPullSettleTimerRef.current) {
      return;
    }

    clearTimeout(topPullSettleTimerRef.current);
    topPullSettleTimerRef.current = null;
  }

  function clearTopPullReleaseTimer() {
    if (!topPullReleaseTimerRef.current) {
      return;
    }

    clearTimeout(topPullReleaseTimerRef.current);
    topPullReleaseTimerRef.current = null;
  }

  function captureScrollRestoreAnchor(stream: HTMLElement) {
    const streamRect = stream.getBoundingClientRect();
    const messageElements = Array.from(
      stream.querySelectorAll<HTMLElement>("[data-message-view-id]"),
    );
    const anchorElement =
      messageElements.find(
        (element) => element.getBoundingClientRect().bottom >= streamRect.top,
      ) ?? messageElements[0];

    return {
      anchorMessageId: anchorElement?.dataset.messageViewId ?? null,
      anchorOffsetTop: anchorElement
        ? anchorElement.getBoundingClientRect().top - streamRect.top
        : 0,
      scrollHeight: stream.scrollHeight,
      scrollTop: stream.scrollTop,
    };
  }

  function setTopPullDistanceValue(distance: number) {
    const nextDistance = Math.max(0, Math.min(HISTORY_TOP_PULL_MAX, distance));
    if (nextDistance > 0) {
      clearTopPullReleaseTimer();
      setIsTopPullSettling(false);
    }
    topPullDistanceRef.current = nextDistance;
    setTopPullDistance(nextDistance);
  }

  function releaseTopPullDistance() {
    clearTopPullReleaseTimer();
    setIsTopPullSettling(true);
    setTopPullDistanceValue(0);
    topPullReleaseTimerRef.current = setTimeout(() => {
      setIsTopPullSettling(false);
      topPullReleaseTimerRef.current = null;
    }, HISTORY_TOP_PULL_SETTLE_DURATION);
  }

  function settleTopPullDistance() {
    if (olderHistoryLoadingRef.current) {
      setTopPullDistanceValue(HISTORY_TOP_PULL_TRIGGER);
      return;
    }

    releaseTopPullDistance();
  }

  function scheduleTopPullSettle() {
    clearTopPullSettleTimer();
    topPullSettleTimerRef.current = setTimeout(() => {
      settleTopPullDistance();
      topPullSettleTimerRef.current = null;
    }, 180);
  }

  function scheduleMessageScrollbarHide() {
    clearMessageScrollbarIdleTimer();

    messageScrollbarIdleTimerRef.current = setTimeout(() => {
      if (!isMessageScrollbarHoveredRef.current) {
        setMessageScrollbarShown(false);
      }
      messageScrollbarIdleTimerRef.current = null;
    }, MESSAGE_SCROLLBAR_IDLE_DELAY);
  }

  function showMessageScrollbarForActivity() {
    syncMessageScrollbarMetrics();

    if (!messageScrollbarVisibleRef.current) {
      setMessageScrollbarShown(true);
    }

    if (isMessageScrollbarHoveredRef.current) {
      clearMessageScrollbarIdleTimer();
      return;
    }

    scheduleMessageScrollbarHide();
  }

  function clearHoveredMessageId() {
    setHoveredMessageId((current) => (current === null ? current : null));
  }

  function scrollToLatestMessageSmooth() {
    const stream = messageStreamRef.current;
    if (!stream) {
      setUnreadMessageCount(0);
      setLatestScrollStateValue("latest");
      return;
    }

    const maxScrollTop = Math.max(0, stream.scrollHeight - stream.clientHeight);
    setUnreadMessageCount(0);
    isPinnedToLatestRef.current = true;

    if (Math.abs(maxScrollTop - stream.scrollTop) <= PIN_TO_LATEST_THRESHOLD) {
      stream.scrollTop = maxScrollTop;
      setLatestScrollStateValue("latest");
      syncMessageScrollbarMetrics();
      return;
    }

    setLatestScrollStateValue("returning");
    stream.scrollTo({
      top: maxScrollTop,
      behavior: "smooth",
    });
    syncMessageScrollbarMetrics();
  }

  const markLiveMessage = useCallback((messageId: string) => {
    setLiveMessageIds((current) => {
      const next = new Set(current);
      next.add(messageId);
      return next;
    });

    const existingTimer = liveMessageAnimationTimersRef.current.get(messageId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      setLiveMessageIds((current) => {
        if (!current.has(messageId)) {
          return current;
        }

        const next = new Set(current);
        next.delete(messageId);
        return next;
      });
      liveMessageAnimationTimersRef.current.delete(messageId);
    }, LIVE_MESSAGE_ANIMATION_DURATION + 120);

    liveMessageAnimationTimersRef.current.set(messageId, timer);
  }, []);

  function handleMessageStreamPointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const streamRect = event.currentTarget.getBoundingClientRect();
    const scrollbarTrackBottom = streamRect.bottom - composerReservedHeight;
    const isHoveringScrollbar =
      event.clientX >= streamRect.right - MESSAGE_SCROLLBAR_HOVER_WIDTH &&
      event.clientX <= streamRect.right &&
      event.clientY >= streamRect.top &&
      event.clientY <= scrollbarTrackBottom;

    if (isHoveringScrollbar === isMessageScrollbarHoveredRef.current) {
      return;
    }

    isMessageScrollbarHoveredRef.current = isHoveringScrollbar;
    if (isHoveringScrollbar) {
      setMessageScrollbarShown(true);
      clearMessageScrollbarIdleTimer();
      return;
    }

    scheduleMessageScrollbarHide();
  }

  function handleMessageStreamScroll() {
    clearHoveredMessageId();
    syncMessageScrollbarMetrics();
    showMessageScrollbarForActivity();
  }

  async function loadOlderMessages() {
    const stream = messageStreamRef.current;
    if (
      olderHistoryLoadingRef.current ||
      olderHistoryState === "done" ||
      !stream ||
      typeof nextBeforeMsgId !== "number"
    ) {
      return;
    }

    olderHistoryLoadingRef.current = true;
    isPinnedToLatestRef.current = false;
    setLatestScrollStateValue("history");
    pendingScrollRestoreRef.current = captureScrollRestoreAnchor(stream);
    setOlderHistoryState("loading");
    setTopPullDistanceValue(HISTORY_TOP_PULL_TRIGGER);
    showMessageScrollbarForActivity();

    try {
      const history = await getChatHistory({
        actorId: actor.id,
        session: DEFAULT_WEB_CHAT_SESSION,
        limit: HISTORY_PAGE_SIZE,
        beforeMsgId: nextBeforeMsgId,
      });

      setMessages((currentMessages) => {
        const existingKeys = new Set(
          currentMessages.map((message, index) =>
            buildConversationMessageKey(message, index),
          ),
        );
        const olderMessages = history.messages.filter(
          (message, index) =>
            !existingKeys.has(buildConversationMessageKey(message, index)),
        );
        return [...olderMessages, ...currentMessages];
      });
      setNextBeforeMsgId(history.pagination.nextBeforeMsgId ?? null);
      setOlderHistoryState(history.pagination.hasMore ? "idle" : "done");
    } catch {
      pendingScrollRestoreRef.current = null;
      setOlderHistoryState("error");
    } finally {
      olderHistoryLoadingRef.current = false;
      setTopPullDistanceValue(0);
    }
  }

  function handleMessageStreamWheel(event: ReactWheelEvent<HTMLDivElement>) {
    showMessageScrollbarForActivity();

    const stream = event.currentTarget;
    const isPullingPastTop = event.deltaY < 0 && stream.scrollTop <= 0;
    if (isPullingPastTop && olderHistoryState === "done") {
      event.preventDefault();
      const remainingRatio =
        1 - topPullDistanceRef.current / (HISTORY_TOP_PULL_MAX + 18);
      const pullDelta = Math.min(Math.abs(event.deltaY), 72) * 0.16;
      setTopPullDistanceValue(
        topPullDistanceRef.current + Math.max(1.5, pullDelta * remainingRatio),
      );
      scheduleTopPullSettle();
      return;
    }

    const canLoadOlder =
      olderHistoryState !== "done" && typeof nextBeforeMsgId === "number";
    if (event.deltaY >= 0 || stream.scrollTop > 0 || !canLoadOlder) {
      if (topPullDistanceRef.current > 0 && event.deltaY > 0) {
        settleTopPullDistance();
      }
      return;
    }

    event.preventDefault();
    const remainingRatio =
      1 - topPullDistanceRef.current / (HISTORY_TOP_PULL_MAX + 18);
    const pullDelta = Math.min(Math.abs(event.deltaY), 80) * 0.22;
    const nextDistance =
      topPullDistanceRef.current + Math.max(2, pullDelta * remainingRatio);
    setTopPullDistanceValue(nextDistance);

    if (
      nextDistance >= HISTORY_TOP_PULL_TRIGGER &&
      olderHistoryState !== "loading"
    ) {
      void loadOlderMessages();
      return;
    }

    scheduleTopPullSettle();
  }

  function handleMessageStreamPointerLeave() {
    if (!isMessageScrollbarHoveredRef.current) {
      return;
    }

    isMessageScrollbarHoveredRef.current = false;
    scheduleMessageScrollbarHide();
  }

  function openMessageMenu(
    event: ReactMouseEvent<HTMLDivElement>,
    message: ChatMessageViewModel,
  ) {
    event.preventDefault();
    const copyEnabled = hasSelectionInsideElement(event.currentTarget);
    if (closeMenuTimerRef.current) {
      clearTimeout(closeMenuTimerRef.current);
      closeMenuTimerRef.current = null;
    }
    setMessageMenu({
      messageId: message.id,
      closing: false,
      copyEnabled,
    });
  }

  function quoteMessage(message: ChatMessageViewModel) {
    if (typeof message.msgId !== "number") {
      return;
    }

    setComposerReplyTo({
      kind: "msg",
      msgId: message.msgId,
    });
    closeMessageMenu();
    window.requestAnimationFrame(() => {
      composerEditorRef.current?.focus();
    });
  }

  function closeMessageMenu() {
    setMessageMenu((current) => {
      if (!current || current.closing) {
        return current;
      }
      return {
        ...current,
        closing: true,
      };
    });
    if (closeMenuTimerRef.current) {
      clearTimeout(closeMenuTimerRef.current);
    }
    closeMenuTimerRef.current = setTimeout(() => {
      setMessageMenu(null);
      closeMenuTimerRef.current = null;
    }, 140);
  }

  async function copyMessageContent(message: ChatMessageViewModel) {
    if (!messageMenu || messageMenu.messageId !== message.id) {
      return;
    }

    const selectedContent = messageMenu.copyEnabled
      ? (() => {
          const messageElement = document.querySelector<HTMLElement>(
            `[data-message-view-id="${CSS.escape(messageMenu.messageId)}"]`,
          );
          return messageElement
            ? buildSelectedClipboardContent(messageElement)
            : {
                text: (window.getSelection()?.toString() ?? "").trim(),
                html: escapeClipboardHtml(
                  window.getSelection()?.toString() ?? "",
                ),
                imageSources: [],
                hasUserText: true,
              };
        })()
      : buildMessageClipboardContent(message.contents);
    if (
      selectedContent.text.trim().length === 0 &&
      selectedContent.imageSources.length === 0
    ) {
      return;
    }

    let copied = false;

    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const itemData = buildClipboardItemData(selectedContent);

        if (itemData) {
          try {
            await navigator.clipboard.write([new ClipboardItem(itemData)]);
            copied = true;
          } catch {
            // Fall back to plain text only when the selection really has text.
          }
        }
      }

      if (
        !copied &&
        (selectedContent.hasUserText ||
          selectedContent.imageSources.length === 0)
      ) {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(selectedContent.text);
          copied = true;
        }
      }
    } catch {
      // Clipboard permission can be denied; keep the UI quiet for now.
    }

    if (copied) {
      showCopyToast();
      clearCurrentTextSelection();
      closeMessageMenu();
    }
  }

  function jumpToMessage(messageId: string) {
    const target = document.querySelector<HTMLElement>(
      `[data-message-view-id="${CSS.escape(messageId)}"]`,
    );
    const stream = messageStreamRef.current;
    if (!target || !stream) {
      return;
    }

    clearHoveredMessageId();

    const streamRect = stream.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const maxScrollTop = Math.max(0, stream.scrollHeight - stream.clientHeight);
    const nextScrollTop = clamp(
      stream.scrollTop +
        targetRect.top -
        streamRect.top -
        MESSAGE_JUMP_TOP_OFFSET,
      0,
      maxScrollTop,
    );

    stream.scrollTo({
      top: nextScrollTop,
      behavior: "smooth",
    });

    setHighlightedMessageId(null);
    window.requestAnimationFrame(() => {
      setHighlightedMessageId(messageId);
    });
  }

  async function buildInlineComposerContents() {
    const snapshot = readComposerSnapshot(composerEditorRef.current, {
      normalize: true,
    });
    const contents: InputContent[] = [];

    for (const part of snapshot.parts) {
      if (part.type === "text") {
        if (part.text.length > 0) {
          contents.push({
            type: "text",
            text: part.text,
          });
        }
        continue;
      }

      const image = inlineImagesById[part.imageId];
      if (image) {
        contents.push(await composerImageToInputContent(image));
      }
    }

    return contents;
  }

  async function sendComposerMessage() {
    if (composerLocked) {
      showComposerNotice(composerLockedNotice);
      return;
    }

    if (!canSendMessage || composerIsSending) {
      return;
    }

    const sentAt = Date.now();
    setComposerIsSending(true);

    try {
      const outgoingMessages: LocalConversationMessage[] = [];
      let replyToConsumed = false;

      for (const attachmentImage of attachmentImages) {
        const msgId = allocateNextLocalMessageId();
        const correlationId = createCorrelationId();
        const contents = [await composerImageToInputContent(attachmentImage)];
        outgoingMessages.push({
          kind: "user",
          msgId,
          time: sentAt,
          uid: "current-user",
          name: userName,
          contents,
          __correlationId: correlationId,
          ...(composerReplyTo && !replyToConsumed
            ? { replyTo: composerReplyTo }
            : {}),
        });
        replyToConsumed = true;
      }

      const inlineContents = await buildInlineComposerContents();
      if (inlineContents.length > 0) {
        const msgId = allocateNextLocalMessageId();
        const correlationId = createCorrelationId();
        outgoingMessages.push({
          kind: "user",
          msgId,
          time: sentAt,
          uid: "current-user",
          name: userName,
          contents: inlineContents,
          __correlationId: correlationId,
          ...(composerReplyTo && !replyToConsumed
            ? { replyTo: composerReplyTo }
            : {}),
        });
      }

      if (outgoingMessages.length === 0) {
        return;
      }

      scrollToLatestMessageSmooth();
      outgoingMessages.forEach((message) => {
        if (typeof message.msgId === "number") {
          markLiveMessage(`user-${message.msgId}`);
        }
      });
      onActorLatestMessage(
        actor.id,
        formatContentsPreviewForLatest(
          outgoingMessages[outgoingMessages.length - 1].contents,
        ),
        sentAt,
      );

      setMessages((currentMessages) => [
        ...currentMessages,
        ...outgoingMessages,
      ]);
      outgoingMessages.forEach((message) => {
        if (message.__correlationId && typeof message.msgId === "number") {
          pendingCorrelationIdsRef.current.set(
            message.__correlationId,
            message.msgId,
          );
        }
      });

      attachmentImages.forEach(revokeComposerImagePreview);
      Object.values(inlineImagesById).forEach(revokeComposerImagePreview);
      setAttachmentImages([]);
      setInlineImagesById({});
      clearComposerEditor();
      setComposerReplyTo(null);

      let hasSendFailure = false;
      await Promise.all(
        outgoingMessages.map(async (message) => {
          const correlationId = message.__correlationId;
          if (!correlationId) {
            return;
          }
          try {
            const response = await sendChatMessage({
              actorId: actor.id,
              session: DEFAULT_WEB_CHAT_SESSION,
              request: {
                correlationId,
                contents: message.contents,
                ...(message.replyTo ? { replyTo: message.replyTo } : {}),
              },
            });
            confirmedCorrelationIdsRef.current.add(response.correlationId);
            pendingCorrelationIdsRef.current.delete(response.correlationId);
            setMessages((currentMessages) =>
              currentMessages.map((currentMessage) =>
                currentMessage.__correlationId === response.correlationId
                  ? response.message
                  : currentMessage,
              ),
            );
          } catch {
            hasSendFailure = true;
            pendingCorrelationIdsRef.current.delete(correlationId);
            setMessages((currentMessages) =>
              currentMessages.filter(
                (currentMessage) =>
                  currentMessage.__correlationId !== correlationId,
              ),
            );
          }
        }),
      );

      if (hasSendFailure) {
        showComposerNotice("发送失败，请稍后重试");
      }
    } catch {
      showComposerNotice("发送失败，请稍后重试");
    } finally {
      setComposerIsSending(false);
    }
  }

  const appendStreamMessage = useCallback(
    (message: ConversationMessage, correlationId?: string) => {
      if (
        correlationId &&
        confirmedCorrelationIdsRef.current.has(correlationId)
      ) {
        return;
      }

      if (
        correlationId &&
        pendingCorrelationIdsRef.current.has(correlationId)
      ) {
        confirmedCorrelationIdsRef.current.add(correlationId);
        pendingCorrelationIdsRef.current.delete(correlationId);
        setMessages((currentMessages) =>
          currentMessages.map((currentMessage) =>
            currentMessage.__correlationId === correlationId
              ? message
              : currentMessage,
          ),
        );
        return;
      }

      setMessages((currentMessages) => {
        if (
          typeof message.msgId === "number" &&
          currentMessages.some(
            (currentMessage) =>
              currentMessage.kind === message.kind &&
              currentMessage.msgId === message.msgId,
          )
        ) {
          return currentMessages;
        }
        return [...currentMessages, message];
      });

      if (typeof message.msgId === "number") {
        markLiveMessage(`${message.kind}-${message.msgId}`);
      }

      if (
        message.kind === "actor" &&
        latestScrollStateRef.current === "history"
      ) {
        setUnreadMessageCount((current) => Math.min(999, current + 1));
      } else {
        isPinnedToLatestRef.current = true;
      }

      onActorLatestMessage(
        actor.id,
        formatContentsPreviewForLatest(message.contents),
        message.time ?? Date.now(),
      );
    },
    [actor.id, markLiveMessage, onActorLatestMessage],
  );

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Backspace" || event.key === "Delete") {
      if (maybeDeleteComposerImageWithKey(event.key)) {
        event.preventDefault();
      }
      return;
    }

    if (
      event.key === "Enter" &&
      event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      window.requestAnimationFrame(syncComposerEditorState);
      return;
    }

    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    void sendComposerMessage();
  }

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const history = await getChatHistory({
          actorId: actor.id,
          session: DEFAULT_WEB_CHAT_SESSION,
          limit: HISTORY_PAGE_SIZE,
        });
        if (!cancelled) {
          latestMessagesRef.current = history.messages;
          nextLocalMsgIdRef.current = getNextConversationMessageId(
            history.messages,
          );
          setMessages(history.messages);
          setNextBeforeMsgId(history.pagination.nextBeforeMsgId ?? null);
          setOlderHistoryState(history.pagination.hasMore ? "idle" : "done");
          setHistoryStage("revealing");
        }
      } catch {
        if (!cancelled) {
          latestMessagesRef.current = [];
          nextLocalMsgIdRef.current = 1;
          setMessages([]);
          setNextBeforeMsgId(null);
          setOlderHistoryState("error");
          setHistoryStage("revealing");
        }
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
      clearHistoryRevealTimer();
    };
  }, [actor.id]);

  useEffect(() => {
    if (historyStage !== "revealing") {
      return;
    }

    clearHistoryRevealTimer();
    const revealSteps = Math.min(
      Math.max(chatTimelineItems.length - 1, 0),
      HISTORY_REVEAL_MAX_STEPS,
    );
    const revealDuration =
      HISTORY_REVEAL_ANIMATION_DURATION +
      revealSteps * HISTORY_REVEAL_STAGGER +
      140;
    historyRevealTimerRef.current = setTimeout(() => {
      setHistoryStage("ready");
      historyRevealTimerRef.current = null;
    }, revealDuration);

    return clearHistoryRevealTimer;
  }, [historyStage, chatTimelineItems.length]);

  useEffect(() => {
    if (!messageMenu) {
      return;
    }

    const closeMenuOnOutsidePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-message-context-menu="true"]')
      ) {
        return;
      }
      closeMessageMenu();
    };

    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMessageMenu();
      }
    };

    document.addEventListener("pointerdown", closeMenuOnOutsidePointerDown, {
      capture: true,
    });
    document.addEventListener("keydown", closeMenuOnEscape);

    return () => {
      document.removeEventListener(
        "pointerdown",
        closeMenuOnOutsidePointerDown,
        {
          capture: true,
        },
      );
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [messageMenu]);

  useEffect(() => {
    const liveMessageAnimationTimers = liveMessageAnimationTimersRef.current;

    return () => {
      if (closeMenuTimerRef.current) {
        clearTimeout(closeMenuTimerRef.current);
      }
      if (composerNoticeTimerRef.current) {
        clearTimeout(composerNoticeTimerRef.current);
      }
      if (copyToastTimerRef.current) {
        clearTimeout(copyToastTimerRef.current);
      }
      attachmentImagesRef.current.forEach(revokeComposerImagePreview);
      Object.values(inlineImagesByIdRef.current).forEach(
        revokeComposerImagePreview,
      );
      clearMessageScrollbarIdleTimer();
      clearHistoryRevealTimer();
      clearTopPullSettleTimer();
      clearTopPullReleaseTimer();
      liveMessageAnimationTimers.forEach((timer) => clearTimeout(timer));
      liveMessageAnimationTimers.clear();
    };
  }, []);

  useEffect(() => {
    latestMessagesRef.current = [];
    nextLocalMsgIdRef.current = 1;
    attachmentImagesRef.current.forEach(revokeComposerImagePreview);
    Object.values(inlineImagesByIdRef.current).forEach(
      revokeComposerImagePreview,
    );
    attachmentImagesRef.current = [];
    inlineImagesByIdRef.current = {};
    setAttachmentImages([]);
    setInlineImagesById({});
    if (composerEditorRef.current) {
      composerEditorRef.current.textContent = "";
      composerEditorRef.current.style.height = `${COMPOSER_TEXTAREA_MIN_HEIGHT}px`;
    }
    setComposerSnapshot(EMPTY_COMPOSER_SNAPSHOT);
    setUnreadMessageCount(0);
    setComposerReplyTo(null);
    setLatestScrollStateValue("latest");
    pendingCorrelationIdsRef.current.clear();
    confirmedCorrelationIdsRef.current.clear();
  }, [actor.id]);

  useEffect(() => {
    attachmentImagesRef.current = attachmentImages;
  }, [attachmentImages]);

  useEffect(() => {
    inlineImagesByIdRef.current = inlineImagesById;
  }, [inlineImagesById]);

  useEffect(() => {
    setConversationTyping(false);
  }, [actor.id]);

  useEffect(() => {
    latestMessagesRef.current = messages;
    nextLocalMsgIdRef.current = Math.max(
      nextLocalMsgIdRef.current,
      getNextConversationMessageId(messages),
    );
  }, [messages]);

  useEffect(() => {
    if (historyStage !== "ready") {
      setConversationTyping(false);
      return undefined;
    }

    setConversationTyping(false);
    const subscription = subscribeChatEvents({
      actorId: actor.id,
      session: DEFAULT_WEB_CHAT_SESSION,
      handler: (event) => {
        if (event.type === "conversation.typing.changed") {
          setConversationTyping(event.data.typing);
          return;
        }
        if (event.type !== "conversation.message.created") {
          return;
        }
        appendStreamMessage(event.data.message, event.correlationId);
      },
      onDisconnect: () => {
        setConversationTyping(false);
      },
    });

    return () => {
      setConversationTyping(false);
      subscription.close();
    };
  }, [actor.id, appendStreamMessage, historyStage]);

  useEffect(() => {
    if (!highlightedMessageId) {
      return;
    }

    const timer = setTimeout(() => {
      setHighlightedMessageId(null);
    }, 1700);

    return () => clearTimeout(timer);
  }, [highlightedMessageId]);

  useIsomorphicLayoutEffect(() => {
    resizeComposerEditorToContent();
  }, [composerSnapshot, inlineImagesById, attachmentImages.length]);

  useIsomorphicLayoutEffect(() => {
    const composerDock = composerDockRef.current;
    if (!composerDock) {
      return;
    }

    const syncComposerHeight = () => {
      setComposerReservedHeight(
        Math.ceil(composerDock.getBoundingClientRect().height),
      );
    };

    syncComposerHeight();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncComposerHeight);
    resizeObserver?.observe(composerDock);

    return () => {
      resizeObserver?.disconnect();
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    const stream = messageStreamRef.current;
    if (!stream || historyStage !== "revealing") {
      return;
    }

    stream.scrollTop = Math.max(0, stream.scrollHeight - stream.clientHeight);
    isPinnedToLatestRef.current = true;
    setUnreadMessageCount(0);
    setLatestScrollStateValue("latest");
    syncMessageScrollbarMetrics();
  }, [historyStage, messages.length, composerReservedHeight]);

  useIsomorphicLayoutEffect(() => {
    const stream = messageStreamRef.current;
    const pendingRestore = pendingScrollRestoreRef.current;
    if (!stream || !pendingRestore) {
      return;
    }

    const anchorElement = pendingRestore.anchorMessageId
      ? stream.querySelector<HTMLElement>(
          `[data-message-view-id="${CSS.escape(
            pendingRestore.anchorMessageId,
          )}"]`,
        )
      : null;

    if (anchorElement) {
      const streamTop = stream.getBoundingClientRect().top;
      const anchorOffsetTop =
        anchorElement.getBoundingClientRect().top - streamTop;
      stream.scrollTop += anchorOffsetTop - pendingRestore.anchorOffsetTop;
    } else {
      stream.scrollTop = Math.max(
        0,
        stream.scrollHeight -
          pendingRestore.scrollHeight +
          pendingRestore.scrollTop,
      );
    }

    pendingScrollRestoreRef.current = null;
    isPinnedToLatestRef.current = false;
    setLatestScrollStateValue("history");
    syncMessageScrollbarMetrics();
  }, [messages.length]);

  useIsomorphicLayoutEffect(() => {
    const stream = messageStreamRef.current;
    const previousReservedHeight = composerReservedHeightRef.current;
    const reservedHeightDelta = composerReservedHeight - previousReservedHeight;
    composerReservedHeightRef.current = composerReservedHeight;

    if (!stream || reservedHeightDelta === 0) {
      return;
    }

    showMessageScrollbarForActivity();

    const maxScrollTop = Math.max(0, stream.scrollHeight - stream.clientHeight);
    if (isPinnedToLatestRef.current) {
      stream.scrollTop = maxScrollTop;
      syncMessageScrollbarMetrics();
      return;
    }

    stream.scrollTop = Math.min(
      maxScrollTop,
      Math.max(0, stream.scrollTop + reservedHeightDelta),
    );
    syncMessageScrollbarMetrics();
  }, [composerReservedHeight]);

  useIsomorphicLayoutEffect(() => {
    const stream = messageStreamRef.current;
    const list = messageListRef.current;
    if (!stream || !list) {
      return;
    }

    let scrollFrameId = 0;

    const distanceToLatestMessage = () =>
      stream.scrollHeight - stream.clientHeight - stream.scrollTop;

    const syncPinnedState = () => {
      const pinnedToLatest =
        distanceToLatestMessage() <= PIN_TO_LATEST_THRESHOLD;
      if (!pinnedToLatest && latestScrollStateRef.current === "returning") {
        isPinnedToLatestRef.current = true;
        syncMessageScrollbarMetrics();
        return;
      }

      isPinnedToLatestRef.current = pinnedToLatest;
      if (pinnedToLatest) {
        setUnreadMessageCount(0);
        setLatestScrollStateValue("latest");
      } else if (latestScrollStateRef.current !== "returning") {
        setLatestScrollStateValue("history");
      }
      syncMessageScrollbarMetrics();
    };

    const scrollToLatestMessage = () => {
      stream.scrollTop = Math.max(0, stream.scrollHeight - stream.clientHeight);
      syncPinnedState();
    };

    const scheduleScrollToLatestMessage = () => {
      window.cancelAnimationFrame(scrollFrameId);
      scrollFrameId = window.requestAnimationFrame(scrollToLatestMessage);
    };

    const keepLatestMessagePinned = () => {
      showMessageScrollbarForActivity();
      if (isPinnedToLatestRef.current) {
        scheduleScrollToLatestMessage();
      }
    };

    isPinnedToLatestRef.current = true;
    setUnreadMessageCount(0);
    setLatestScrollStateValue("latest");
    scrollToLatestMessage();
    scheduleScrollToLatestMessage();
    stream.addEventListener("scroll", syncPinnedState, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(keepLatestMessagePinned);
    resizeObserver?.observe(stream);
    resizeObserver?.observe(list);

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(keepLatestMessagePinned);
    mutationObserver?.observe(list, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(scrollFrameId);
      stream.removeEventListener("scroll", syncPinnedState);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [actor.id]);

  const isHistoryLoading = historyStage === "loading";
  const isHistoryRevealing = historyStage === "revealing";
  const historyPullVisible =
    topPullDistance > 0 || olderHistoryState === "loading" || isTopPullSettling;
  const historyPullHeight = historyPullVisible
    ? Math.max(topPullDistance, olderHistoryState === "loading" ? 38 : 0)
    : 0;
  const historyPullReachedEnd =
    olderHistoryState === "done" && (topPullDistance > 0 || isTopPullSettling);
  const showBottomJumpButton =
    historyStage === "ready" && latestScrollState !== "latest";
  const isReturningToLatest = latestScrollState === "returning";
  const hasUnreadMessages =
    latestScrollState === "history" && unreadMessageCount > 0;
  const composerReplyPreview = buildReplyPreview(
    composerReplyTo ?? undefined,
    messageByMsgId,
    userName,
  );
  const showConversationTyping =
    conversationTyping &&
    actor.status === "online" &&
    actor.transition === null;
  const runtimeStatusLabel = actor.transition
    ? transitionText[actor.transition]
    : statusText[actor.status];
  const chatStatusLabel = showConversationTyping
    ? "正在输入..."
    : runtimeStatusLabel;
  const runtimeStatusClass = actor.transition ? "preparing" : actor.status;

  return (
    <div className={styles.chatShell}>
      <header className={styles.chatHeader}>
        <div className={styles.chatIdentity}>
          <div className={styles.chatTitleLine}>
            <span
              className={`${styles.chatTitleStatus} ${styles[runtimeStatusClass]}`}
              aria-label={chatStatusLabel}
            />
            <h1>{actor.name}</h1>
            <span
              className={`${styles.chatInlineStatus} ${
                showConversationTyping ? styles.chatInlineStatusTyping : ""
              }`}
            >
              {showConversationTyping ? (
                <>
                  正在输入
                  <span className={styles.typingDots} aria-hidden="true">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                </>
              ) : (
                runtimeStatusLabel
              )}
            </span>
          </div>
        </div>
        <div className={styles.chatHeaderActions}>
          <button
            type="button"
            className={`${styles.chatPanelToggle} ${
              !actorInfoVisible ? styles.chatPanelToggleInactive : ""
            }`}
            aria-label={actorInfoVisible ? "隐藏右侧卡片" : "显示右侧卡片"}
            aria-pressed={actorInfoVisible}
            title={actorInfoVisible ? "隐藏右侧卡片" : "显示右侧卡片"}
            onClick={onToggleActorInfo}
          >
            {actorInfoVisible ? (
              <ChevronRight key="right-panel-open" aria-hidden="true" />
            ) : (
              <Menu key="right-panel-closed" aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      <div className={styles.messageStage} aria-label={`${actor.name} 的对话`}>
        <div
          className={styles.conversationViewport}
          style={
            {
              "--composer-reserved-height": `${composerReservedHeight}px`,
            } as CSSProperties
          }
        >
          <div
            ref={messageStreamRef}
            className={styles.messageStream}
            onPointerEnter={handleMessageStreamPointerMove}
            onPointerMove={handleMessageStreamPointerMove}
            onPointerLeave={handleMessageStreamPointerLeave}
            onScroll={handleMessageStreamScroll}
            onWheel={handleMessageStreamWheel}
          >
            <div ref={messageListRef} className={styles.messageList}>
              {historyPullVisible ? (
                <div
                  className={`${styles.historyPullLoader} ${
                    isTopPullSettling ? styles.historyPullLoaderSettling : ""
                  } ${
                    !isTopPullSettling ? styles.historyPullLoaderVisible : ""
                  }`}
                  aria-hidden="true"
                  style={
                    {
                      "--history-pull-height": `${historyPullHeight}px`,
                    } as CSSProperties
                  }
                >
                  {historyPullReachedEnd ? (
                    <span>没有更早消息了</span>
                  ) : (
                    <LoaderCircle aria-hidden="true" />
                  )}
                </div>
              ) : null}
              {chatTimelineItems.map((item, itemIndex) => {
                const motionStyle = {
                  "--message-index": Math.min(itemIndex, 8),
                  "--timeline-reveal-index": Math.min(
                    chatTimelineItems.length - 1 - itemIndex,
                    HISTORY_REVEAL_MAX_STEPS,
                  ),
                } as CSSProperties;

                if (item.type === "separator") {
                  const isLiveSeparator = Array.from(liveMessageIds).some(
                    (messageId) => item.id.endsWith(`-${messageId}`),
                  );

                  return (
                    <div
                      key={item.id}
                      className={`${styles.timelineSeparator} ${
                        isLiveSeparator ? styles.timelineSeparatorLive : ""
                      } ${
                        isHistoryRevealing
                          ? styles.timelineItemHistoryReveal
                          : ""
                      }`}
                      style={motionStyle}
                      aria-label={item.label}
                    >
                      <span>{item.label}</span>
                    </div>
                  );
                }

                const group = item.group;

                return (
                  <article
                    key={group.id}
                    className={`${styles.messageGroup} ${
                      group.role === "user" ? styles.messageGroupUser : ""
                    } ${
                      isHistoryRevealing ? styles.timelineItemHistoryReveal : ""
                    }`}
                    style={motionStyle}
                  >
                    {group.role === "actor" ? (
                      <span
                        className={`${styles.actorAvatar} ${styles.messageAvatar}`}
                      >
                        {actorAvatarText(actor.name)}
                      </span>
                    ) : null}
                    <div className={styles.messageGroupBody}>
                      {group.messages.map((message, messageIndex) => {
                        const hasOlderInGroup = messageIndex > 0;
                        const hasNewerInGroup =
                          messageIndex < group.messages.length - 1;
                        const isTextOnlyMessage = message.contents.every(
                          (content) => content.type === "text",
                        );
                        const hasCornerTime =
                          isTextOnlyMessage && message.timeLabel.length > 0;
                        const replyPreview = buildReplyPreview(
                          message.replyTo,
                          messageByMsgId,
                          userName,
                        );
                        const isLiveMessage = liveMessageIds.has(message.id);

                        return (
                          <div
                            key={message.id}
                            data-message-view-id={message.id}
                            data-text-selectable="true"
                            data-message-bubble="true"
                            onPointerEnter={() =>
                              setHoveredMessageId(message.id)
                            }
                            onPointerMove={() =>
                              setHoveredMessageId(message.id)
                            }
                            onPointerLeave={() =>
                              setHoveredMessageId((current) =>
                                current === message.id ? null : current,
                              )
                            }
                            onContextMenu={(event) =>
                              openMessageMenu(event, message)
                            }
                            className={`${styles.messageBubble} ${
                              group.role === "user"
                                ? styles.messageBubbleUser
                                : styles.messageBubbleActor
                            } ${hasCornerTime ? styles.messageBubbleTextOnly : ""} ${
                              hasNewerInGroup
                                ? styles.messageBubbleHasNewer
                                : ""
                            } ${hasOlderInGroup ? styles.messageBubbleHasOlder : ""} ${
                              highlightedMessageId === message.id
                                ? styles.messageBubbleHighlighted
                                : ""
                            } ${
                              hoveredMessageId === message.id
                                ? styles.messageBubbleShowId
                                : ""
                            } ${isLiveMessage ? styles.messageBubbleLive : ""}`}
                          >
                            {replyPreview
                              ? renderReplyPreview(replyPreview, jumpToMessage)
                              : null}
                            {renderMessageContents(message.contents)}
                            {renderMessageTime(message.timeLabel, message.time)}
                            {renderMessageId(message)}
                            {messageMenu?.messageId === message.id ? (
                              <div
                                className={`${styles.messageContextMenu} ${
                                  group.role === "user"
                                    ? styles.messageContextMenuUser
                                    : ""
                                } ${
                                  messageMenu.closing
                                    ? styles.messageContextMenuClosing
                                    : ""
                                }`}
                                data-message-context-menu="true"
                                role="menu"
                                aria-label="消息操作"
                                onContextMenu={(event) =>
                                  event.preventDefault()
                                }
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  className={styles.messageMenuButton}
                                  aria-label="引用消息"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={(event) => {
                                    event.preventDefault();
                                    quoteMessage(message);
                                  }}
                                >
                                  <MessageSquareQuote aria-hidden="true" />
                                  <span className={styles.messageMenuTooltip}>
                                    引用消息
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className={styles.messageMenuButton}
                                  aria-label={
                                    messageMenu.copyEnabled
                                      ? "复制选中"
                                      : "复制全部"
                                  }
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={() =>
                                    void copyMessageContent(message)
                                  }
                                >
                                  <Copy aria-hidden="true" />
                                  <span className={styles.messageMenuTooltip}>
                                    {messageMenu.copyEnabled
                                      ? "复制选中"
                                      : "复制全部"}
                                  </span>
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    {group.role === "user" ? (
                      <span
                        className={`${styles.userAvatar} ${styles.messageAvatar}`}
                      >
                        {userInitial(userName)}
                      </span>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
          {isHistoryLoading ? (
            <div className={styles.messageLoading} role="status">
              <LoaderCircle aria-hidden="true" />
              <span>正在载入对话</span>
            </div>
          ) : null}
          <div
            className={`${styles.messageScrollbar} ${
              messageScrollbarVisible && messageScrollbarMetrics.canScroll
                ? styles.messageScrollbarVisible
                : ""
            }`}
            aria-hidden="true"
            style={
              {
                "--message-scrollbar-thumb-height": `${messageScrollbarMetrics.thumbHeight}px`,
                "--message-scrollbar-thumb-top": `${messageScrollbarMetrics.thumbTop}px`,
              } as CSSProperties
            }
          >
            <span className={styles.messageScrollbarThumb} />
          </div>

          {showBottomJumpButton ? (
            <button
              type="button"
              className={`${styles.bottomJumpButton} ${
                hasUnreadMessages ? styles.bottomJumpButtonUnread : ""
              } ${isReturningToLatest ? styles.bottomJumpButtonReturning : ""}`}
              disabled={isReturningToLatest}
              aria-label={
                hasUnreadMessages
                  ? `${unreadMessageCount}条新消息，回到底部`
                  : isReturningToLatest
                    ? "正在回到底部"
                    : "回到底部"
              }
              onClick={scrollToLatestMessageSmooth}
            >
              <ArrowDown aria-hidden="true" />
              <span>{unreadMessageCount}条新消息</span>
            </button>
          ) : null}

          {copyToast ? (
            <div
              key={copyToast.id}
              className={styles.copyToast}
              data-copy-ignore="true"
              role="status"
              aria-live="polite"
            >
              <Check aria-hidden="true" />
              <span>{copyToast.message}</span>
            </div>
          ) : null}

          <form
            ref={composerDockRef}
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              void sendComposerMessage();
            }}
          >
            <div
              className={`${styles.composerFrame} ${
                composerReplyPreview || attachmentImages.length > 0
                  ? styles.composerFrameStacked
                  : ""
              }`}
              data-locked={composerLocked ? "true" : undefined}
            >
              {composerReplyPreview
                ? renderComposerReplyPreview(composerReplyPreview, () =>
                    setComposerReplyTo(null),
                  )
                : null}
              {attachmentImages.length > 0 ? (
                <div className={styles.composerAttachmentTray}>
                  {attachmentImages.map((image) => (
                    <span
                      key={image.id}
                      className={styles.composerAttachment}
                      aria-label={image.fileName}
                    >
                      <Image
                        src={image.previewUrl}
                        alt={image.fileName}
                        width={44}
                        height={44}
                        unoptimized
                      />
                      <button
                        type="button"
                        aria-label="移除附件图片"
                        onClick={() => removeAttachmentImage(image.id)}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div
                ref={composerEditorRef}
                className={styles.composerTextarea}
                data-text-selectable="true"
                data-empty={!isComposerSnapshotSendable(composerSnapshot)}
                data-disabled={composerLocked ? "true" : undefined}
                data-scrollable={composerEditorScrollable}
                data-placeholder={
                  composerLocked
                    ? composerLockedNotice
                    : `向 ${actor.name} 发送消息`
                }
                contentEditable={!composerLocked}
                suppressContentEditableWarning
                role="textbox"
                aria-label="消息内容"
                aria-disabled={composerLocked}
                aria-multiline="true"
                onClick={(event) => {
                  if (composerLocked) {
                    event.preventDefault();
                    showComposerNotice(composerLockedNotice);
                    return;
                  }
                  handleComposerEditorClick(event);
                }}
                onInput={syncComposerEditorState}
                onKeyDown={(event) => {
                  if (composerLocked) {
                    event.preventDefault();
                    showComposerNotice(composerLockedNotice);
                    return;
                  }
                  handleComposerKeyDown(event);
                }}
                onPaste={(event) => {
                  if (composerLocked) {
                    event.preventDefault();
                    showComposerNotice(composerLockedNotice);
                    return;
                  }
                  handleComposerPaste(event);
                }}
              />
              <div className={styles.composerToolbar}>
                <input
                  ref={attachmentInputRef}
                  className={styles.composerFileInput}
                  type="file"
                  accept={SUPPORTED_COMPOSER_IMAGE_MIME_TYPES.join(",")}
                  multiple
                  tabIndex={-1}
                  disabled={composerLocked}
                  onChange={handleAttachmentInputChange}
                />
                <button
                  type="button"
                  className={styles.composerIconButton}
                  aria-label="添加图片"
                  disabled={composerLocked}
                  onClick={() => attachmentInputRef.current?.click()}
                >
                  <ImagePlus aria-hidden="true" />
                </button>
                <span className={styles.composerSendCluster}>
                  {composerNotice ? (
                    <span className={styles.composerNotice} role="status">
                      {composerNotice}
                    </span>
                  ) : null}
                  <button
                    type="submit"
                    className={styles.sendButton}
                    aria-label="发送消息"
                    disabled={!canSendMessage}
                  >
                    <Send aria-hidden="true" />
                  </button>
                </span>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
