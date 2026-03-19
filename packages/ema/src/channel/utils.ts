import {
  AUDIO_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  type MIME,
} from "../schema";
import type {
  ChannelSessionInfo,
  ChannelSessionType,
  MessageReplyRef,
} from "./base";

export const MEDIA_INLINE_LIMIT_BYTES = 7 * 1024 * 1024;

const SUPPORTED_MIME_TYPES = new Set<string>([
  ...IMAGE_MIME_TYPES,
  ...VIDEO_MIME_TYPES,
  ...AUDIO_MIME_TYPES,
  ...DOCUMENT_MIME_TYPES,
]);

const MIME_ALIASES: Record<string, MIME> = {
  "image/jpg": "image/jpeg",
  "video/mov": "video/quicktime",
  "video/avi": "video/x-msvideo",
  "video/mpg": "video/mpeg",
  "video/wmv": "video/x-ms-wmv",
  "audio/mp3": "audio/mpeg",
  "audio/x-wav": "audio/wav",
};

const MIME_BY_EXTENSION: Record<string, MIME> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".flv": "video/x-flv",
  ".webm": "video/webm",
  ".wmv": "video/x-ms-wmv",
  ".3gp": "video/3gpp",
  ".3gpp": "video/3gpp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
};

export function buildSession(
  channel: string,
  type: ChannelSessionType,
  uid: string,
): string {
  return `${channel}-${type}-${uid}`;
}

export function resolveSession(session: string): ChannelSessionInfo | null {
  const first = session.indexOf("-");
  const second = session.indexOf("-", first + 1);
  if (first === -1 || second === -1) {
    return null;
  }

  const channel = session.slice(0, first);
  const type = session.slice(first + 1, second);
  const uid = session.slice(second + 1);

  if (type !== "chat" && type !== "group") {
    return null;
  }

  return {
    channel,
    type,
    uid,
  };
}

function normalizeSupportedMime(value: string | null | undefined): MIME | null {
  if (!value) {
    return null;
  }
  const normalized = value.split(";")[0]?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (SUPPORTED_MIME_TYPES.has(normalized)) {
    return normalized as MIME;
  }
  return MIME_ALIASES[normalized] ?? null;
}

function resolveMimeFromHint(hint: string | null | undefined): MIME | null {
  if (!hint) {
    return null;
  }
  const directMime = normalizeSupportedMime(hint);
  if (directMime) {
    return directMime;
  }
  const sanitizedHint = hint.split("#")[0]?.split("?")[0] ?? hint;
  const extension = extractExtension(sanitizedHint);
  if (!extension) {
    return null;
  }
  return MIME_BY_EXTENSION[extension] ?? null;
}

function extractExtension(value: string): string {
  const slashIndex = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  const fileName = slashIndex >= 0 ? value.slice(slashIndex + 1) : value;
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return "";
  }
  return fileName.slice(dotIndex).trim().toLowerCase();
}

export function resolveSupportedMediaMimeType(
  rawMimeType: string | null | undefined,
  hint?: string | null,
): MIME | null {
  const hintedMime = resolveMimeFromHint(hint);
  if (hintedMime) {
    return hintedMime;
  }
  return normalizeSupportedMime(rawMimeType);
}

export function shouldAcceptMedia(mimeType: MIME, sizeBytes: number): boolean {
  return (
    SUPPORTED_MIME_TYPES.has(mimeType) &&
    Number.isFinite(sizeBytes) &&
    sizeBytes >= 0 &&
    sizeBytes <= MEDIA_INLINE_LIMIT_BYTES
  );
}

export function formatReplyRef(ref: MessageReplyRef): string {
  if (ref.kind === "msg") {
    return String(ref.msgId);
  }
  return `${ref.channel}_message_id:${ref.channelMessageId}`;
}

export function parseReplyRef(value: string): MessageReplyRef | null {
  if (/^\d+$/.test(value)) {
    return {
      kind: "msg",
      msgId: Number(value),
    };
  }

  const matched = value.match(/^([a-zA-Z0-9_]+)_message_id:(.+)$/);
  if (!matched) {
    return null;
  }

  return {
    kind: "channel",
    channel: matched[1],
    channelMessageId: matched[2],
  };
}

export function formatMentionText(uid: string, aboutSelf = false): string {
  return aboutSelf ? "@(YOU)" : `@(${uid})`;
}
