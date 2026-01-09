import { z } from "zod";
import { Skill } from "../base";
import { ToolResult } from "../../tools/base";

/** Format a Date as `YYYY-MM-DD HH:mm:ss`. */
function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join(
      "-",
    ) +
    " " +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(
      ":",
    )
  );
}

const DemoSkillSchema = z
  .object({
    input: z.string().min(1).describe("用户输入的原始命令文本"),
  })
  .strict();

/**
 * Parse a user input string that starts with '#'.
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
  /** Simple demo skill that understands #time and #echo commands. */
  get description(): string {
    return "解析以 # 开头的命令并生成结果。";
  }

  get parameters(): Record<string, any> {
    return DemoSkillSchema.toJSONSchema();
  }

  /**
   * Execute the demo skill.
   * - validates args with zod
   * - supports #time and #echo commands
   * - returns localized error messages for invalid inputs
   */
  async execute(args: { input: string }): Promise<ToolResult> {
    let payload: { input: string };
    try {
      payload = DemoSkillSchema.parse(args);
    } catch (err) {
      return new ToolResult({
        success: false,
        error: `Invalid demo-skill input: ${(err as Error).message}`,
      });
    }

    const input = payload.input;
    const parsed = parseCommand(input);

    if (!parsed) {
      return new ToolResult({
        success: false,
        error: "未检测到命令，请使用以 # 开头的指令。",
      });
    }

    if (parsed.command === "time") {
      return new ToolResult({
        success: true,
        content: formatDate(new Date()),
      });
    }

    if (parsed.command === "echo") {
      if (!parsed.args) {
        return new ToolResult({
          success: false,
          error: "#echo 需要一个字符串参数。",
        });
      }
      return new ToolResult({
        success: true,
        content: parsed.args,
      });
    }

    return new ToolResult({
      success: false,
      error: "未知命令，可用命令：#time、#echo",
    });
  }
}
