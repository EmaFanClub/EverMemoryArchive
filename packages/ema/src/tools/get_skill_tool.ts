import { z } from "zod";
import { Tool, ToolResult } from "./base";
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

  get name(): string {
    return "get_skill";
  }

  get description(): string {
    return "获取指定 skill 的使用手册。在你想使用某个 skill 之前，可以先使用此工具查看该 skill 的使用说明。";
  }

  get parameters(): Record<string, any> {
    return GetSkillSchema.toJSONSchema();
  }

  /**
   * Fetch the SKILL.md playbook for a given skill.
   * @param skill_name - Name of the skill to fetch.
   */
  async execute(skill_name: string): Promise<ToolResult> {
    let payload: { skill_name: string };
    try {
      payload = GetSkillSchema.parse({ skill_name });
    } catch (err) {
      return new ToolResult({
        success: false,
        error: `Invalid get_skill_tool input: ${(err as Error).message}`,
      });
    }

    const skill = this.registry[payload.skill_name];
    if (!skill) {
      return new ToolResult({
        success: false,
        error: `Skill '${payload.skill_name}' does not exist.`,
      });
    }

    const playbook = await skill.getPlaybook();
    return new ToolResult({ success: true, content: playbook });
  }
}
