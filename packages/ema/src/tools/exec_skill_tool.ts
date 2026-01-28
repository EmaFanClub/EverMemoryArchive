import { z } from "zod";
import { Tool } from "./base";
import type { ToolResult, ToolContext } from "./base";
import { type SkillRegistry } from "../skills";

const ExeSkillSchema = z
  .object({
    skill_name: z.string().min(1).describe("需要执行的 skill 名称"),
    skill_args: z.any().optional().describe("传给 skill.execute 的参数对象"),
  })
  .strict();

export class ExecSkillTool extends Tool {
  private registry: SkillRegistry;

  /**
   * @param registry - In-memory registry of skills keyed by name.
   */
  constructor(registry: SkillRegistry) {
    super();
    this.registry = registry;
  }

  name = "exec_skill";

  description =
    "执行指定 skill，并返回执行结果。当你确定需要使用某个 skill 来完成任务时，可以使用此工具来执行该 skill。";

  parameters = ExeSkillSchema.toJSONSchema();

  /**
   * Executes a registered skill by name.
   * @param args - Arguments containing skill name and payload.
   * @param context - Optional tool context forwarded to the skill.
   */
  async execute(args: any, context?: ToolContext): Promise<ToolResult> {
    let payload: z.infer<typeof ExeSkillSchema>;
    try {
      payload = ExeSkillSchema.parse(args);
    } catch (err) {
      return {
        success: false,
        error: `Invalid exe_skill_tool input: ${(err as Error).message}`,
      };
    }

    const skill = this.registry[payload.skill_name];
    if (!skill) {
      return {
        success: false,
        error: `Skill '${payload.skill_name}' does not exist.`,
      };
    }
    return await skill.execute(payload.skill_args, context);
  }
}
