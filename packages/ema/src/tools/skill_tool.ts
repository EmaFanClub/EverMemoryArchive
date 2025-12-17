/**
 * Skill Tool - Tool for Agent to load Skills on-demand
 *
 * Implements Progressive Disclosure (Level 2): Load full skill content when needed
 */

import { Tool, ToolResult } from "./base";
import { SkillLoader } from "./skill_loader";

export class GetSkillTool extends Tool {
  skillLoader: SkillLoader;

  constructor(skillLoader: SkillLoader) {
    /** Tool to get detailed information about a specific skill */
    super();
    this.skillLoader = skillLoader;
  }

  get name(): string {
    return "get_skill";
  }

  get description(): string {
    return "Get complete content and guidance for a specified skill, used for executing specific types of tasks";
  }

  get parameters(): Record<string, any> {
    return {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description:
            "Name of the skill to retrieve (use list_skills to view available skills)",
        },
      },
      required: ["skill_name"],
    };
  }

  async execute(skill_name: string): Promise<ToolResult> {
    /** Get detailed information about specified skill */
    const skill = this.skillLoader.getSkill(skill_name);

    if (!skill) {
      const available = this.skillLoader.listSkills().join(", ");
      return new ToolResult({
        success: false,
        content: "",
        error: `Skill '${skill_name}' does not exist. Available skills: ${available}`,
      });
    }

    // Return complete skill content
    const result = skill.toPrompt();
    return new ToolResult({ success: true, content: result });
  }
}

export function createSkillTools(
  skillsDir: string = "./skills",
): [Tool[], SkillLoader | null] {
  /**
   * Create skill tool for Progressive Disclosure
   *
   * Only provides get_skill tool - the agent uses metadata in system prompt
   * to know what skills are available, then loads them on-demand.
   *
   * Args:
   *     skillsDir: Skills directory path
   *
   * Returns:
   *     Tuple of (list of tools, skill loader)
   */
  // Create skill loader
  const loader = new SkillLoader(skillsDir);

  // Discover and load skills
  const skills = loader.discoverSkills();
  console.log(`✅ Discovered ${skills.length} Claude Skills`);

  // Create only the get_skill tool (Progressive Disclosure Level 2)
  const tools: Tool[] = [new GetSkillTool(loader)];

  return [tools, loader];
}
