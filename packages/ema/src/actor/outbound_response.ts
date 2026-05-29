import { MEDIA_INLINE_LIMIT_BYTES } from "../channel/utils";
import { formatStickerDisplayText } from "../skills/sticker-skill/pack";
import { stickerIdToBase64 } from "../skills/sticker-skill/utils";
import { formatImageReplyMediaText } from "../tools/ema_reply_tool";
import { ActorWorkspaceService } from "../workspace/actor_workspace";
import type { ActorChatResponse } from "./base";

interface OutboundResponseLogger {
  warn(message: string, data?: unknown): void;
}

interface BuildOutboundActorChatResponseOptions {
  workspace?: ActorWorkspaceService;
  logger?: OutboundResponseLogger;
}

export async function buildOutboundActorChatResponse(
  response: ActorChatResponse,
  options: BuildOutboundActorChatResponseOptions = {},
): Promise<ActorChatResponse> {
  if (response.ema_reply.kind === "sticker") {
    return await buildStickerOutboundResponse(response, options.logger);
  }
  if (response.ema_reply.kind === "image") {
    return await buildImageOutboundResponse(response, options);
  }
  return response;
}

async function buildStickerOutboundResponse(
  response: ActorChatResponse,
  logger?: OutboundResponseLogger,
): Promise<ActorChatResponse> {
  try {
    return {
      ...response,
      ema_reply: {
        ...response.ema_reply,
        content: await stickerIdToBase64(response.ema_reply.content),
      },
    };
  } catch (error) {
    logger?.warn(
      `Failed to resolve sticker '${response.ema_reply.content}', falling back to text proxy.`,
      error,
    );
    return {
      ...response,
      ema_reply: {
        ...response.ema_reply,
        kind: "text",
        content: await formatStickerDisplayText(response.ema_reply.content),
      },
    };
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
