import { z } from "zod";
import dayjs from "dayjs";
import { Skill } from "../base";
import type { ToolResult, ToolContext } from "../../tools/base";

//TODO: Use arktype in future
const DemoSkillSchema = z
  .object({
    input: z.string().min(1).describe("用户输入的原始命令文本"),
  })
  .strict();

/**
 * Parses a user input string that starts with '#'.
 * Supports commands like '#time' or '#echo hello'.
 */
function parseCommand(input: string): { command: string; args: string } | null {
  if (!input.startsWith("#")) {
    return null;
  }
  const trimmed = input.trim();
  const match = trimmed.match(/^#([a-zA-Z]+)\s*(.*)$/);
  if (!match) {
    return null;
  }
  return { command: match[1].toLowerCase(), args: match[2].trim() };
}

export default class DemoSkill extends Skill {
  /** Returns a description of the demo skill that understands #time and #echo commands. */
  description = "解析以 # 开头的命令并生成结果。";

  parameters = DemoSkillSchema.toJSONSchema();

  /**
   * Executes the demo skill.
   * - Validates args with zod
   * - Supports #time and #echo commands
   * - Returns localized error messages for invalid inputs
   * @param args - Skill arguments.
   * @param context - Optional tool context (unused).
   */
  async execute(args: any, context?: ToolContext): Promise<ToolResult> {
    let payload: z.infer<typeof DemoSkillSchema>;
    try {
      payload = DemoSkillSchema.parse(args);
    } catch (err) {
      return {
        success: false,
        error: `Invalid demo-skill input: ${(err as Error).message}`,
      };
    }

    const input = payload.input;
    const parsed = parseCommand(input);

    if (!parsed) {
      return {
        success: false,
        error: "未检测到命令，请使用以 # 开头的指令。",
      };
    }

    if (parsed.command === "time") {
      return {
        success: true,
        content: dayjs(new Date()).format("YYYY-MM-DD HH:mm:ss"),
      };
    }

    if (parsed.command === "echo") {
      if (!parsed.args) {
        return {
          success: false,
          error: "#echo 需要一个字符串参数。",
        };
      }
      return {
        success: true,
        content: parsed.args,
      };
    }

    return {
      success: false,
      error: "未知命令，可用命令：#time、#echo",
    };
  }
}
