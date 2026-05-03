import { dataUrlToBlob } from "@/features/chat/clipboard";
import type { ImageMIME, InputContent } from "@/types/chat/v1beta1";

export type ComposerImageSource = "attachment" | "clipboard";

export interface ComposerImageItem {
  id: string;
  file: File;
  fileName: string;
  mimeType: ImageMIME;
  previewUrl: string;
  size: number;
  source: ComposerImageSource;
}

type ComposerContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      imageId: string;
    };

export interface ComposerSnapshot {
  parts: ComposerContentPart[];
  text: string;
  imageIds: string[];
}

export type ComposerPastePart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      src: string;
    };

export const SUPPORTED_COMPOSER_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
] as const satisfies readonly ImageMIME[];
export const EMPTY_COMPOSER_SNAPSHOT: ComposerSnapshot = {
  parts: [],
  text: "",
  imageIds: [],
};

export function isSupportedComposerImageMimeType(
  mimeType: string,
): mimeType is ImageMIME {
  return SUPPORTED_COMPOSER_IMAGE_MIME_TYPES.includes(mimeType as ImageMIME);
}

function createComposerImageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createComposerImageItem(
  file: File,
  source: ComposerImageSource,
): ComposerImageItem | null {
  if (!isSupportedComposerImageMimeType(file.type)) {
    return null;
  }

  return {
    id: createComposerImageId(),
    file,
    fileName: file.name || "图片",
    mimeType: file.type,
    previewUrl: URL.createObjectURL(file),
    size: file.size,
    source,
  };
}

export function revokeComposerImagePreview(image: ComposerImageItem) {
  URL.revokeObjectURL(image.previewUrl);
}

function getImageFileExtension(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  return mimeType.split("/")[1]?.replace("svg+xml", "svg") || "png";
}

export function dataUrlToImageFile(dataUrl: string, index: number) {
  const blob = dataUrlToBlob(dataUrl);

  if (!blob || !isSupportedComposerImageMimeType(blob.type)) {
    return null;
  }

  return new File(
    [blob],
    `粘贴图片-${index + 1}.${getImageFileExtension(blob.type)}`,
    {
      type: blob.type,
    },
  );
}

function mergeComposerPasteTextPart(parts: ComposerPastePart[], text: string) {
  if (!text) {
    return;
  }

  const normalizedText = text.replace(/\u00a0/g, " ");
  const previous = parts.at(-1);

  if (previous?.type === "text") {
    previous.text += normalizedText;
    return;
  }

  parts.push({
    type: "text",
    text: normalizedText,
  });
}

function normalizeComposerPasteParts(parts: ComposerPastePart[]) {
  const normalizedParts = parts.filter(
    (part) => part.type === "image" || part.text.length > 0,
  );
  const firstText = normalizedParts.find((part) => part.type === "text");
  const lastText = normalizedParts.findLast((part) => part.type === "text");

  if (firstText?.type === "text") {
    firstText.text = firstText.text.replace(/^\n+/, "");
  }

  if (lastText?.type === "text") {
    lastText.text = lastText.text.replace(/\n+$/, "");
  }

  return normalizedParts.filter(
    (part) => part.type === "image" || part.text.length > 0,
  );
}

export function parseComposerPasteHtml(html: string) {
  if (!html.trim()) {
    return [];
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const parts: ComposerPastePart[] = [];
  const blockTags = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DIV",
    "FIGURE",
    "FOOTER",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "LI",
    "MAIN",
    "P",
    "SECTION",
  ]);

  function appendLineBreak() {
    const previous = parts.at(-1);

    if (previous?.type === "text") {
      if (!previous.text.endsWith("\n")) {
        previous.text += "\n";
      }
      return;
    }

    parts.push({
      type: "text",
      text: "\n",
    });
  }

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      mergeComposerPasteTextPart(parts, node.textContent ?? "");
      return;
    }

    if (!(node instanceof HTMLElement)) {
      node.childNodes.forEach(walk);
      return;
    }

    if (node.matches('[data-copy-ignore="true"]')) {
      return;
    }

    if (node.tagName === "BR") {
      appendLineBreak();
      return;
    }

    if (node instanceof HTMLImageElement) {
      const src = node.currentSrc || node.src;

      if (src.startsWith("data:image/")) {
        parts.push({
          type: "image",
          src,
        });
      }
      return;
    }

    node.childNodes.forEach(walk);

    if (blockTags.has(node.tagName)) {
      appendLineBreak();
    }
  }

  document.body.childNodes.forEach(walk);

  return normalizeComposerPasteParts(parts);
}

export function getComposerImageCount(
  attachmentImages: ComposerImageItem[],
  inlineImagesById: Record<string, ComposerImageItem>,
) {
  return attachmentImages.length + Object.keys(inlineImagesById).length;
}

function collectComposerParts(node: Node, parts: ComposerContentPart[]) {
  if (node.nodeType === 3) {
    parts.push({
      type: "text",
      text: node.textContent ?? "",
    });
    return;
  }

  if (!(node instanceof HTMLElement)) {
    return;
  }

  const imageId = node.dataset.composerImageId;
  if (imageId) {
    parts.push({
      type: "image",
      imageId,
    });
    return;
  }

  if (node.tagName === "BR") {
    parts.push({
      type: "text",
      text: "\n",
    });
    return;
  }

  node.childNodes.forEach((child) => collectComposerParts(child, parts));

  if (node.tagName === "DIV" || node.tagName === "P") {
    parts.push({
      type: "text",
      text: "\n",
    });
  }
}

function mergeComposerTextParts(parts: ComposerContentPart[]) {
  return parts.reduce<ComposerContentPart[]>((mergedParts, part) => {
    if (part.type === "image") {
      mergedParts.push(part);
      return mergedParts;
    }

    if (!part.text) {
      return mergedParts;
    }

    const previous = mergedParts.at(-1);
    if (previous?.type === "text") {
      previous.text += part.text;
      return mergedParts;
    }

    mergedParts.push({ ...part });
    return mergedParts;
  }, []);
}

function compactComposerParts(parts: ComposerContentPart[]) {
  return mergeComposerTextParts(
    parts.filter((part) => part.type === "image" || part.text.length > 0),
  );
}

function normalizeComposerParts(parts: ComposerContentPart[]) {
  const mergedParts = compactComposerParts(parts);
  const firstText = mergedParts.find((part) => part.type === "text");
  const lastText = mergedParts.findLast((part) => part.type === "text");

  if (firstText?.type === "text") {
    firstText.text = firstText.text.trimStart();
  }

  if (lastText?.type === "text") {
    lastText.text = lastText.text.trimEnd();
  }

  return compactComposerParts(mergedParts);
}

export function readComposerSnapshot(
  editor: HTMLElement | null,
  options: { normalize?: boolean } = {},
): ComposerSnapshot {
  if (!editor) {
    return EMPTY_COMPOSER_SNAPSHOT;
  }

  const parts: ComposerContentPart[] = [];
  editor.childNodes.forEach((child) => collectComposerParts(child, parts));
  const snapshotParts = options.normalize
    ? normalizeComposerParts(parts)
    : compactComposerParts(parts);

  return {
    parts: snapshotParts,
    text: snapshotParts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(""),
    imageIds: snapshotParts.flatMap((part) =>
      part.type === "image" ? [part.imageId] : [],
    ),
  };
}

export function isComposerSnapshotSendable(snapshot: ComposerSnapshot) {
  return snapshot.parts.some((part) =>
    part.type === "image" ? true : part.text.trim().length > 0,
  );
}

export function formatContentsPreviewForLatest(contents: InputContent[]) {
  return (
    contents
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
      .join(" ") || "消息"
  );
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function composerImageToInputContent(
  image: ComposerImageItem,
): Promise<InputContent> {
  return {
    type: "inline_data",
    mimeType: image.mimeType,
    data: await readFileAsBase64(image.file),
    text: "[图片]",
  };
}
