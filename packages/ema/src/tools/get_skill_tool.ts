import { z } from "zod";
import { Tool } from "./base";
import type { ToolResult, ToolContext } from "./base";
import { type SkillRegistry } from "../skills";

const GetSkillSchema = z
  .object({
    skill_name: z.string().min(1).describe("需要查看的 skill 名称"),
  })
  .strict();

export class GetSkillTool extends Tool {
  private registry: SkillRegistry;

  /**
   * @param registry - In-memory registry of skills keyed by name.
   */
  constructor(registry: SkillRegistry) {
    super();
    this.registry = registry;
  }

  name = "get_skill";

  description =
    "此工具用来查询某个技能的详细说明，在执行一个技能之前必须先使用该工具查询目标技能的详细说明。";

  parameters = GetSkillSchema.toJSONSchema();

  /**
   * Fetches the SKILL.md playbook for a given skill.
   * @param args - Arguments containing the skill name.
   * @param context - Optional tool context (unused).
   */
  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    let payload: z.infer<typeof GetSkillSchema>;
    try {
      payload = GetSkillSchema.parse(args);
    } catch (err) {
      return {
        success: false,
        error: `Invalid get_skill_tool input: ${(err as Error).message}`,
      };
    }

    const skill = this.registry[payload.skill_name];
    if (!skill) {
      return {
        success: false,
        error: `Skill '${payload.skill_name}' does not exist.`,
      };
    }

    const playbook = await skill.getPlaybook();
    return { success: true, content: playbook };
  }
}
