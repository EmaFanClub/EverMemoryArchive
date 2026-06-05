import { z } from "zod";
import { Skill } from "../base";
import type { ToolContext, ToolResult } from "../../tools/base";
import type { ConversationMessageEntity } from "../../db/base";
import type { ImageMIME, InlineDataItem } from "../../llm/schema";
import { isImageMime } from "../../llm/utils";
import { ActorStickerStore, type ResolvedStickerPack } from "../../stickers";

const ListStickersSchema = z
  .object({
    action: z.literal("list").describe("列出当前角色可用表情包"),
  })
  .strict();

const PreviewStickerSchema = z
  .object({
    action: z.literal("preview").describe("预览一张表情包原图"),
    pack: z.string().min(1).describe("表情包所属包名"),
    id: z.string().min(1).describe("需要预览的表情包 id"),
  })
  .strict();

const UpdateStickerSchema = z
  .object({
    action: z.literal("update").describe("更新某个表情包的名称和描述"),
    pack: z.string().min(1).describe("要修改的表情包包名"),
    id: z.string().min(1).describe("需要修改的表情包 id"),
    name: z.string().min(1).describe("新的表情名称"),
    description: z.string().min(1).describe("新的表情描述"),
  })
  .strict();

const CreateStickerSchema = z
  .object({
    action: z.literal("create").describe("把聊天记录中的图片收藏为新表情包"),
    id: z.string().min(1).describe("新表情包的 id，当前角色唯一"),
    name: z.string().min(1).describe("新表情包的名称"),
    description: z.string().min(1).describe("新表情包的描述"),
    msg_id: z.number().int().positive().describe("来源消息的 msg_id"),
    idx: z
      .number()
      .int()
      .min(1)
      .describe("该消息中第几张图片，idx 从 1 开始计数"),
  })
  .strict();

const StickerSkillSchema = z.discriminatedUnion("action", [
  ListStickersSchema,
  PreviewStickerSchema,
  UpdateStickerSchema,
  CreateStickerSchema,
]);

type StickerSkillInput = z.infer<typeof StickerSkillSchema>;

function extractImageParts(
  row: ConversationMessageEntity,
): Array<InlineDataItem & { mimeType: ImageMIME }> {
  return row.message.contents.filter(
    (content): content is InlineDataItem & { mimeType: ImageMIME } =>
      content.type === "inline_data" && isImageMime(content.mimeType),
  );
}

/**
 * Sticker management skill for previewing and maintaining pluggable sticker packs.
 */
export default class StickerSkill extends Skill {
  description =
    "该技能用于查看可用表情包，并在聊天中选择合适表情回应。适合在想发表情、回应对方表情包/图片/梗、轻量冒泡、接梗、表达情绪，或觉得文字会过度解释时使用。发送表情仍需使用 ema_reply 工具。";

  parameters = StickerSkillSchema.toJSONSchema();

  constructor(
    skillsDir: string,
    name: string,
    private readonly stickerStore: ActorStickerStore = new ActorStickerStore(),
  ) {
    super(skillsDir, name);
  }

  /**
   * Loads the static skill playbook. Actor-specific sticker inventory is listed
   * through the list action so get_skill output is stable across actors.
   * @returns Sticker skill playbook markdown.
   */
  override async getPlaybook(): Promise<string> {
    return await super.getPlaybook();
  }

  /**
   * Executes list, preview, update, or create sticker operations.
   * @param args - Skill input.
   * @param context - Tool context containing server and conversation scope when needed.
   * @returns Operation result.
   */
  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    let payload: StickerSkillInput;
    try {
      payload = StickerSkillSchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        content: `Invalid sticker-skill input: ${(err as Error).message}`,
      };
    }

    const actorId = context?.actorId;
    if (typeof actorId !== "number") {
      return {
        success: false,
        content: "Missing actorId in skill context.",
      };
    }

    if (payload.action === "list") {
      try {
        await this.stickerStore.ensureActorStickerPacks(actorId);
        return {
          success: true,
          content: formatAvailableStickersMarkdown(
            await this.stickerStore.listStickerPacks(actorId),
          ),
        };
      } catch (error) {
        return {
          success: false,
          content: `Failed to list stickers: ${messageFromError(error)}`,
        };
      }
    }

    if (payload.action === "preview") {
      try {
        await this.stickerStore.ensureActorStickerPacks(actorId);
        const pack = await this.stickerStore.getStickerPack(
          actorId,
          payload.pack,
        );
        if (!pack) {
          return {
            success: false,
            content: `Sticker pack '${payload.pack}' does not exist.`,
          };
        }
        const sticker = await this.stickerStore.getStickerInPack(
          actorId,
          payload.pack,
          payload.id,
        );
        if (!sticker) {
          return {
            success: false,
            content: `Sticker '${payload.id}' does not exist in pack '${payload.pack}'.`,
          };
        }
        return {
          success: true,
          content: await this.stickerStore.formatStickerDisplayText(
            actorId,
            sticker.id,
          ),
          images: [
            await this.stickerStore.stickerIdToInlineData(actorId, sticker.id),
          ],
        };
      } catch (error) {
        return {
          success: false,
          content: `Failed to preview sticker: ${messageFromError(error)}`,
        };
      }
    }

    if (payload.action === "update") {
      try {
        await this.stickerStore.ensureActorStickerPacks(actorId);
        await this.stickerStore.updateStickerMetadata(
          actorId,
          payload.pack,
          payload.id,
          payload.name,
          payload.description,
        );
        return {
          success: true,
          content: await this.stickerStore.formatStickerDisplayText(
            actorId,
            payload.id,
          ),
        };
      } catch (error) {
        return {
          success: false,
          content: `Failed to update sticker: ${messageFromError(error)}`,
        };
      }
    }

    const server = context?.server;
    const conversationId = context?.conversationId;
    if (!server) {
      return {
        success: false,
        content: "Missing server in skill context.",
      };
    }
    if (!conversationId) {
      return {
        success: false,
        content: "Missing conversationId in skill context.",
      };
    }

    const rows =
      await server.dbService.conversationMessageDB.listConversationMessages({
        conversationId,
        msgIds: [payload.msg_id],
        limit: 1,
      });
    const row = rows[0];
    if (!row) {
      return {
        success: false,
        content: `Message ${payload.msg_id} not found.`,
      };
    }
    const images = extractImageParts(row);
    const image = images[payload.idx - 1];
    if (!image) {
      return {
        success: false,
        content: `Message ${payload.msg_id} does not have image #${payload.idx}.`,
      };
    }
    try {
      await this.stickerStore.createCollectedSticker(
        actorId,
        payload.id,
        payload.name,
        payload.description,
        image,
      );
      return {
        success: true,
        content: await this.stickerStore.formatStickerDisplayText(
          actorId,
          payload.id,
        ),
        images: [image],
      };
    } catch (error) {
      return {
        success: false,
        content: `Failed to create sticker: ${messageFromError(error)}`,
      };
    }
  }
}

function formatAvailableStickersMarkdown(packs: ResolvedStickerPack[]): string {
  if (packs.length === 0) {
    return "- None.";
  }
  return packs
    .map((pack) =>
      [
        `- ${pack.pack}`,
        ...pack.stickers.map(
          (item) =>
            `  - id: \`${item.id}\`｜名称：${item.name}｜说明：${item.description}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
}

function messageFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /(?:[A-Za-z]:)?[\\/](?:[^\\/ \t\r\n"'`]+[\\/])*[^\\/ \t\r\n"'`]+/g,
    "[path]",
  );
}
