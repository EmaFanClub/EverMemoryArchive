import type {
  Content,
  ImageUrlItem,
  ImageMIME,
  MIME,
  InlineDataItem,
  InputContent,
  MediaItem,
  Message,
  ModelMessage,
  TextItem,
  ThinkingItem,
  ToolCall,
  ToolResult,
  UserMessage,
} from "./schema";
import {
  AUDIO_MIME_TYPES,
  DEFAULT_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
} from "./schema";

const SUPPORTED_MIME_TYPES = new Set<string>([
  ...IMAGE_MIME_TYPES,
  ...VIDEO_MIME_TYPES,
  ...AUDIO_MIME_TYPES,
  ...DOCUMENT_MIME_TYPES,
  ...DEFAULT_MIME_TYPES,
]);

const IMAGE_MIME_TYPE_SET = new Set<string>(IMAGE_MIME_TYPES);

/**
 * Checks whether a MIME type is part of EMA's supported media schema.
 *
 * @param mime - MIME type to inspect.
 * @returns `true` when the MIME type is supported by EMA.
 */
export function isSupportedMime(mime: string): mime is MIME {
  return SUPPORTED_MIME_TYPES.has(mime);
}

/**
 * Checks whether a MIME type is part of EMA's supported image schema.
 *
 * @param mime - MIME type to inspect.
 * @returns `true` when the MIME type is an image type supported by EMA.
 */
export function isImageMime(mime: string): mime is ImageMIME {
  return IMAGE_MIME_TYPE_SET.has(mime);
}

/**
 * Checks whether a message was produced by the model.
 *
 * @param message - Message to inspect.
 * @returns `true` when the message role is `model`.
 */
export function isModelMessage(message: Message): message is ModelMessage {
  return message.role === "model";
}

/**
 * Checks whether a message was provided by the user/runtime.
 *
 * @param message - Message to inspect.
 * @returns `true` when the message role is `user`.
 */
export function isUserMessage(message: Message): message is UserMessage {
  return message.role === "user";
}

/**
 * Checks whether a content block is plain text.
 *
 * @param content - Content block to inspect.
 * @returns `true` when the content block is a `TextItem`.
 */
export function isTextItem(content: Content): content is TextItem {
  return content.type === "text";
}

/**
 * Checks whether a content block is model reasoning/thinking content.
 *
 * @param content - Content block to inspect.
 * @returns `true` when the content block is a `ThinkingItem`.
 */
export function isThinkingItem(content: Content): content is ThinkingItem {
  return content.type === "thinking";
}

/**
 * Checks whether a content block carries image URL media.
 *
 * @param content - Content block to inspect.
 * @returns `true` when the content block is an `ImageUrlItem`.
 */
export function isImageUrlItem(content: Content): content is ImageUrlItem {
  return content.type === "image_url";
}

/**
 * Checks whether a content block carries inline media data.
 *
 * @param content - Content block to inspect.
 * @returns `true` when the content block is an `InlineDataItem`.
 */
export function isInlineDataItem(content: Content): content is InlineDataItem {
  return content.type === "inline_data";
}

/**
 * Checks whether a content block carries media.
 *
 * @param content - Content block to inspect.
 * @returns `true` when the content block is a `MediaItem`.
 */
export function isMediaItem(content: Content): content is MediaItem {
  return isImageUrlItem(content) || isInlineDataItem(content);
}

/**
 * Checks whether a content block is a model-emitted tool call.
 *
 * @param content - Content block to inspect.
 * @returns `true` when the content block is a `ToolCall`.
 */
export function isToolCall(content: Content): content is ToolCall {
  return content.type === "tool_call";
}

/**
 * Checks whether a content block is a tool execution result.
 *
 * @param content - Content block to inspect.
 * @returns `true` when the content block is a `ToolResult`.
 */
export function isToolResult(content: Content): content is ToolResult {
  return content.type === "tool_result";
}

/**
 * Formats media as text for contexts that cannot carry media payloads.
 *
 * @param content - Media content to format.
 * @returns Human-readable media label.
 */
export function formatMediaText(content: MediaItem): string {
  const text = content.text?.trim();
  if (content.type === "image_url") {
    return text ? `${text}（image_url）` : `（image_url）`;
  }
  return text ? `${text}（${content.mimeType}）` : `（${content.mimeType}）`;
}

function formatMediaTextItem(content: MediaItem): TextItem {
  return {
    type: "text",
    text: formatMediaText(content),
  };
}

/**
 * Collapses multimodal contents into pure text contents for prompt rendering.
 *
 * @param contents - User-authored input contents.
 * @returns Text-only contents preserving media labels.
 */
export function collapseContentsToText(contents: InputContent[]): TextItem[] {
  return contents.map((content): TextItem => {
    if (content.type === "text") {
      return content;
    }
    return formatMediaTextItem(content);
  });
}

/**
 * Collapses media payloads before sending history to text-only models.
 *
 * @param contents - Message contents to normalize.
 * @returns Contents that do not carry media payloads.
 */
export function collapseContentsForTextOnlyModel(
  contents: Content[],
): Content[] {
  const collapsed: Content[] = [];

  for (const content of contents) {
    if (isMediaItem(content)) {
      const textItem = formatMediaTextItem(content);
      const previous = collapsed[collapsed.length - 1];
      if (previous?.type === "text" && previous.text === textItem.text) {
        continue;
      }
      collapsed.push(textItem);
      continue;
    }

    if (content.type === "tool_result" && content.result.images?.length) {
      collapsed.push({
        ...content,
        result: {
          text: content.result.text,
        },
      });
      continue;
    }

    collapsed.push(content);
  }

  return collapsed;
}

/**
 * Expands multimodal contents for model messages by exposing media metadata as
 * text while preserving the original inline payload for multimodal providers.
 *
 * @param contents - User-authored input contents.
 * @returns Contents with media labels inserted before inline payloads.
 */
export function expandContentsForModel(
  contents: InputContent[],
): InputContent[] {
  return contents.flatMap((content): InputContent[] => {
    if (content.type === "text") {
      return [content];
    }
    return [formatMediaTextItem(content), content];
  });
}
