import type { InputContent } from "@/types/chat/v1beta1";

export function hasSelectionInsideElement(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return false;
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(element)) {
      return true;
    }
  }

  return false;
}

export interface SelectedClipboardContent {
  text: string;
  html: string;
  imageSources: string[];
  hasUserText: boolean;
}

export function escapeClipboardHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "<br>");
}

export function dataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?((?:;[^,]*)*?),(.*)$/);
  if (!match) {
    return null;
  }

  const mimeType = match[1] || "application/octet-stream";
  const metadata = match[2] ?? "";
  const payload = match[3] ?? "";

  try {
    const binary = metadata.includes(";base64")
      ? atob(payload)
      : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
  } catch {
    return null;
  }
}

function imageSourceToPngBlob(source: string) {
  return new Promise<Blob>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext("2d");

      if (!context || canvas.width === 0 || canvas.height === 0) {
        reject(new Error("Cannot create image clipboard blob."));
        return;
      }

      context.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Cannot encode image clipboard blob."));
      }, "image/png");
    };
    image.onerror = () => reject(new Error("Cannot load clipboard image."));
    image.src = source;
  });
}

function supportsClipboardWriteType(mimeType: string) {
  return (
    typeof ClipboardItem.supports !== "function" ||
    ClipboardItem.supports(mimeType)
  );
}

function getClipboardImageRepresentation(source: string) {
  const dataUrlBlob = dataUrlToBlob(source);
  if (dataUrlBlob?.type === "image/png") {
    return dataUrlBlob;
  }

  if (supportsClipboardWriteType("image/png")) {
    return imageSourceToPngBlob(source);
  }

  return null;
}

function createClipboardTextBlob(text: string, mimeType: string) {
  return new Blob([text], { type: mimeType });
}

export function buildClipboardItemData(content: SelectedClipboardContent) {
  const itemData: Record<string, string | Blob | PromiseLike<string | Blob>> =
    {};
  const isImageOnly = content.imageSources.length > 0 && !content.hasUserText;

  if (content.imageSources.length === 1 && isImageOnly) {
    const imageRepresentation = getClipboardImageRepresentation(
      content.imageSources[0],
    );
    if (imageRepresentation) {
      itemData["image/png"] = imageRepresentation;
    }
  }

  if (content.html) {
    itemData["text/html"] = createClipboardTextBlob(content.html, "text/html");
  }

  if (content.text && !isImageOnly) {
    itemData["text/plain"] = createClipboardTextBlob(
      content.text,
      "text/plain",
    );
  }

  return Object.keys(itemData).length > 0 ? itemData : null;
}

function isCopyIgnoredNode(node: Node) {
  const element =
    node instanceof Element
      ? node
      : node.parentNode instanceof Element
        ? node.parentNode
        : null;

  return Boolean(
    element?.closest(
      '[data-copy-ignore="true"], [data-message-context-menu="true"]',
    ),
  );
}

export function buildSelectedClipboardContent(
  root: HTMLElement,
): SelectedClipboardContent {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return {
      text: "",
      html: "",
      imageSources: [],
      hasUserText: false,
    };
  }

  const textFragments: string[] = [];
  const htmlFragments: string[] = [];
  const imageSources: string[] = [];
  let hasUserText = false;

  function appendText(text: string) {
    if (!text) {
      return;
    }

    if (text.trim().length > 0) {
      hasUserText = true;
    }

    const previous = textFragments.at(-1);
    if (typeof previous === "string" && !previous.startsWith("[")) {
      textFragments[textFragments.length - 1] = `${previous}${text}`;
    } else {
      textFragments.push(text);
    }
    htmlFragments.push(escapeClipboardHtml(text));
  }

  function walkSelectedNode(node: Node, range: Range) {
    if (!range.intersectsNode(node)) {
      return;
    }

    if (node !== root && isCopyIgnoredNode(node)) {
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      let start = 0;
      let end = text.length;

      if (node === range.startContainer) {
        start = range.startOffset;
      }
      if (node === range.endContainer) {
        end = range.endOffset;
      }

      appendText(text.slice(start, end));
      return;
    }

    if (!(node instanceof HTMLElement)) {
      node.childNodes.forEach((child) => walkSelectedNode(child, range));
      return;
    }

    const copyText = node.dataset.copyText;
    if (copyText) {
      const imageSrc =
        node instanceof HTMLImageElement ? node.currentSrc || node.src : "";

      if (textFragments.length > 0 && !textFragments.at(-1)?.endsWith("\n")) {
        textFragments.push("\n");
        htmlFragments.push("<br>");
      }
      textFragments.push(copyText);
      textFragments.push("\n");
      if (imageSrc) {
        imageSources.push(imageSrc);
        htmlFragments.push(
          `<img src="${imageSrc}" alt="图片" style="max-width: 280px; height: auto;">`,
        );
      } else {
        htmlFragments.push(escapeClipboardHtml(copyText));
      }
      htmlFragments.push("<br>");
      return;
    }

    if (node.tagName === "BR") {
      appendText("\n");
      return;
    }

    node.childNodes.forEach((child) => walkSelectedNode(child, range));

    if (node.tagName === "P" || node.tagName === "DIV") {
      appendText("\n");
    }
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    walkSelectedNode(root, selection.getRangeAt(index));
  }

  const text = textFragments
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const html = htmlFragments
    .join("")
    .replace(/(?:<br>){3,}/g, "<br><br>")
    .replace(/^(?:<br>)+|(?:<br>)+$/g, "");

  return {
    text,
    html,
    imageSources,
    hasUserText,
  };
}

export function buildMessageClipboardContent(
  contents: InputContent[],
): SelectedClipboardContent {
  const textFragments: string[] = [];
  const htmlFragments: string[] = [];
  const imageSources: string[] = [];
  let hasUserText = false;

  contents.forEach((content) => {
    if (content.type === "text") {
      const text = content.text.trim();
      if (!text) {
        return;
      }

      if (textFragments.length > 0 && !textFragments.at(-1)?.endsWith("\n")) {
        textFragments.push("\n");
        htmlFragments.push("<br>");
      }
      textFragments.push(text);
      htmlFragments.push(escapeClipboardHtml(text));
      hasUserText = true;
      return;
    }

    if (content.mimeType.startsWith("image/")) {
      const imageSrc = `data:${content.mimeType};base64,${content.data}`;
      if (textFragments.length > 0 && !textFragments.at(-1)?.endsWith("\n")) {
        textFragments.push("\n");
        htmlFragments.push("<br>");
      }
      textFragments.push(content.text?.trim() || "[图片]");
      textFragments.push("\n");
      imageSources.push(imageSrc);
      htmlFragments.push(
        `<img src="${imageSrc}" alt="图片" style="max-width: 280px; height: auto;">`,
      );
      htmlFragments.push("<br>");
      return;
    }

    if (content.mimeType) {
      if (textFragments.length > 0 && !textFragments.at(-1)?.endsWith("\n")) {
        textFragments.push("\n");
        htmlFragments.push("<br>");
      }
      const text = content.text?.trim() || content.mimeType;
      textFragments.push(text);
      htmlFragments.push(escapeClipboardHtml(text));
      hasUserText = true;
    }
  });

  const text = textFragments
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const html = htmlFragments
    .join("")
    .replace(/(?:<br>){3,}/g, "<br><br>")
    .replace(/^(?:<br>)+|(?:<br>)+$/g, "");

  return {
    text,
    html,
    imageSources,
    hasUserText,
  };
}
