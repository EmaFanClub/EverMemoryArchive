import { MEDIA_INLINE_LIMIT_BYTES } from "../channel/utils";
import { ActorStickerStore } from "../stickers";
import { formatImageReplyMediaText } from "../tools/ema_reply_tool";
import { ActorWorkspaceService } from "../workspace/actor_workspace";
import type { ActorChatResponse } from "./base";

interface OutboundResponseLogger {
  warn(message: string, data?: unknown): void;
}

interface BuildOutboundActorChatResponseOptions {
  workspace?: ActorWorkspaceService;
  stickerStore?: ActorStickerStore;
  logger?: OutboundResponseLogger;
}

export async function buildOutboundActorChatResponse(
  response: ActorChatResponse,
  options: BuildOutboundActorChatResponseOptions = {},
): Promise<ActorChatResponse> {
  if (response.ema_reply.kind === "sticker") {
    return await buildStickerOutboundResponse(response, options);
  }
  if (response.ema_reply.kind === "image") {
    return await buildImageOutboundResponse(response, options);
  }
  return response;
}

async function buildStickerOutboundResponse(
  response: ActorChatResponse,
  options: BuildOutboundActorChatResponseOptions,
): Promise<ActorChatResponse> {
  const stickerStore =
    options.stickerStore ??
    new ActorStickerStore(
      options.workspace ? { workspace: options.workspace } : {},
    );
  try {
    await stickerStore.ensureActorStickerPacks(response.actorId);
    return {
      ...response,
      ema_reply: {
        ...response.ema_reply,
        content: await stickerStore.stickerIdToBase64(
          response.actorId,
          response.ema_reply.content,
        ),
      },
    };
  } catch (error) {
    options.logger?.warn(
      `Failed to resolve sticker '${response.ema_reply.content}', falling back to text proxy.`,
      error,
    );
    return {
      ...response,
      ema_reply: {
        ...response.ema_reply,
        kind: "text",
        content: await formatStickerFallbackText(
          stickerStore,
          response.actorId,
          response.ema_reply.content,
        ),
      },
    };
  }
}

async function formatStickerFallbackText(
  stickerStore: ActorStickerStore,
  actorId: number,
  id: string,
): Promise<string> {
  try {
    return await stickerStore.formatStickerDisplayText(actorId, id);
  } catch {
    return `[表情：未知表情,id=${id}]`;
  }
}

async function buildImageOutboundResponse(
  response: ActorChatResponse,
  options: BuildOutboundActorChatResponseOptions,
): Promise<ActorChatResponse> {
  const workspace = options.workspace ?? new ActorWorkspaceService();
  try {
    const image = await workspace.readImageDataFile(
      response.actorId,
      response.ema_reply.content,
      {
        maxBytes: MEDIA_INLINE_LIMIT_BYTES,
      },
    );
    return {
      ...response,
      ema_reply: {
        ...response.ema_reply,
        content: image.data.toString("base64"),
      },
    };
  } catch (error) {
    options.logger?.warn(
      `Failed to resolve workspace image '${response.ema_reply.content}', falling back to text proxy.`,
      error,
    );
    return {
      ...response,
      ema_reply: {
        ...response.ema_reply,
        kind: "text",
        content: formatImageReplyMediaText(response.ema_reply),
      },
    };
  }
}
