import { z } from "zod";
import { Skill } from "../base";
import type { ToolContext, ToolResult } from "../../tools/base";
import type { ConversationMessageEntity } from "../../db/base";
import {
  buildAvailableStickersMarkdown,
  formatStickerDisplayText,
  getStickerById,
  getStickerInPack,
  getStickerPack,
} from "./pack";
import {
  createCollectedSticker,
  stickerPackIdToInlineData,
  updateStickerMetadata,
} from "./utils";

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
    id: z.string().min(1).describe("新表情包的 id，全局唯一"),
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
  PreviewStickerSchema,
  UpdateStickerSchema,
  CreateStickerSchema,
]);

type StickerSkillInput = z.infer<typeof StickerSkillSchema>;

function extractImageParts(
  row: ConversationMessageEntity,
): NonNullable<ToolResult["parts"]> {
  return row.message.contents.filter(
    (content): content is NonNullable<ToolResult["parts"]>[number] =>
      content.type === "inline_data" && content.mimeType.startsWith("image/"),
  );
}

/**
 * Sticker management skill for previewing and maintaining pluggable sticker packs.
 */
export default class StickerSkill extends Skill {
  description =
    "该技能用于预览、更新和收藏表情包，在需要查看某个表情的原图、修改表情信息或把聊天记录中的图片收藏成表情时使用。发送表情仍需使用 ema_reply 工具。";

  parameters = StickerSkillSchema.toJSONSchema();

  /**
   * Loads the skill playbook and injects the currently available sticker list.
   * @returns Sticker skill playbook markdown.
   */
  override async getPlaybook(): Promise<string> {
    const base = await super.getPlaybook();
    return base.replaceAll(
      "{AVAILABLE_STICKERS}",
      await buildAvailableStickersMarkdown(),
    );
  }

  /**
   * Executes preview, update, or create sticker operations.
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
        error: `Invalid sticker-skill input: ${(err as Error).message}`,
      };
    }

    if (payload.action === "preview") {
      const pack = await getStickerPack(payload.pack);
      if (!pack) {
        return {
          success: false,
          error: `Sticker pack '${payload.pack}' does not exist.`,
        };
      }
      const sticker = await getStickerInPack(payload.pack, payload.id);
      if (!sticker) {
        return {
          success: false,
          error: `Sticker '${payload.id}' does not exist in pack '${payload.pack}'.`,
        };
      }
      return {
        success: true,
        content: await formatStickerDisplayText(sticker.id),
        parts: [await stickerPackIdToInlineData(pack.pack, sticker.id)],
      };
    }

    if (payload.action === "update") {
      if (!(await getStickerPack(payload.pack))) {
        return {
          success: false,
          error: `Sticker pack '${payload.pack}' does not exist.`,
        };
      }
      if (!(await getStickerInPack(payload.pack, payload.id))) {
        return {
          success: false,
          error: `Sticker '${payload.id}' does not exist in pack '${payload.pack}'.`,
        };
      }
      await updateStickerMetadata(
        payload.pack,
        payload.id,
        payload.name,
        payload.description,
      );
      return {
        success: true,
        content: await formatStickerDisplayText(payload.id),
      };
    }

    const server = context?.server;
    const conversationId = context?.conversationId;
    if (!server) {
      return {
        success: false,
        error: "Missing server in skill context.",
      };
    }
    if (!conversationId) {
      return {
        success: false,
        error: "Missing conversationId in skill context.",
      };
    }
    if (await getStickerById(payload.id)) {
      return {
        success: false,
        error: `Sticker id '${payload.id}' already exists.`,
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
        error: `Message ${payload.msg_id} not found.`,
      };
    }
    const images = extractImageParts(row);
    const image = images[payload.idx - 1];
    if (!image) {
      return {
        success: false,
        error: `Message ${payload.msg_id} does not have image #${payload.idx}.`,
      };
    }
    await createCollectedSticker(
      payload.id,
      payload.name,
      payload.description,
      image,
    );
    return {
      success: true,
      content: await formatStickerDisplayText(payload.id),
      parts: [image],
    };
  }
}
