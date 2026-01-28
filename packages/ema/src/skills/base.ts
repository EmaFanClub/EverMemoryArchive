import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ToolResult, ToolContext } from "../tools/base";

/** Skill name -> Skill instance registry. */
export type SkillRegistry = Record<string, Skill>;

/**
 * Base class for all skills.
 *
 * A skill lives in a directory (skillDir) and exposes description, parameters
 * (JSON Schema), and an async execute entry point. Concrete skills should
 * extend this class and implement their own behaviour.
 */
export abstract class Skill {
  readonly name: string;
  readonly skillDir: string;

  constructor(skillsDir: string, name: string) {
    this.skillDir = path.join(skillsDir, name);
    this.name = name;
  }

  /** Returns a one-line human-readable description of the skill. */
  abstract description: string;

  /** Returns the JSON Schema describing the arguments the skill accepts. */
  abstract parameters: Record<string, any>;

  /**
   * Executes the skill.
   * @param args - Arguments object that should satisfy `parameters`.
   * @param context - Optional tool context (e.g. actor scope).
   */
  abstract execute(args: any, context?: ToolContext): Promise<ToolResult>;

  /** Returns minimal metadata used for listing in prompts/UI. */
  get metadata(): Record<string, string> {
    return {
      name: this.name,
      description: this.description,
    };
  }

  /**
   * Loads the SKILL.md playbook (strips frontmatter) and appends parameter hints.
   * Returns empty string when the playbook file does not exist.
   */
  async getPlaybook(): Promise<string> {
    const skillMdPath = path.join(this.skillDir, "SKILL.md");
    try {
      await fs.promises.access(skillMdPath);
    } catch {
      return "";
    }
    const content = await fs.promises.readFile(skillMdPath, "utf-8");
    const playbook = stripYamlFrontmatter(content).body;
    const parametersHint =
      "\n\n## Parameters\n\n" + JSON.stringify(this.parameters, null, 2);
    return `${playbook.trim()}${parametersHint}`;
  }
}

/**
 * Builds a human-readable list of available skills for prompt injection.
 */
export function buildSkillsPrompt(registry: SkillRegistry): string {
  const skills = Object.values(registry);
  if (!skills.length) {
    return "";
  }
  const lines = ["## Available Skills", ""];
  for (const skill of skills) {
    lines.push(`- \`${skill.name}\`: ${skill.description}`);
  }
  return lines.join("\n");
}

/**
 * Strips a leading YAML frontmatter block from markdown content.
 */
function stripYamlFrontmatter(markdown: string): {
  frontmatter: string | null;
  body: string;
} {
  if (!markdown.startsWith("---")) {
    return { frontmatter: null, body: markdown };
  }
  const lines = markdown.split(/\r?\n/);
  if (lines[0].trim() !== "---") {
    return { frontmatter: null, body: markdown };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: null, body: markdown };
  }
  const frontmatter = lines.slice(1, end).join("\n");
  const body = lines.slice(end + 1).join("\n");
  return { frontmatter, body };
}

/**
 * Discovers and instantiates skills under the given directory.
 * @param skillsDir - Directory containing skill folders.
 * @returns Registry keyed by skill name.
 */
export async function loadSkills(
  skillsDir: string = path.dirname(fileURLToPath(import.meta.url)),
): Promise<SkillRegistry> {
  const registry: SkillRegistry = {};
  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Skills directory does not exist: ${skillsDir}`);
  }

  const baseDir = path.dirname(fileURLToPath(import.meta.url));
  const skillsDirAbs = path.resolve(skillsDir);
  let skillsRel = path.relative(baseDir, skillsDirAbs) || ".";
  if (!skillsRel.startsWith(".")) {
    skillsRel = `./${skillsRel}`;
  }
  skillsRel = skillsRel.split(path.sep).join("/");

  console.log(`Loading skills from: ${skillsRel} relative to ${baseDir}`);

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skillNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  await Promise.all(
    skillNames.map(async (name) => {
      try {
        // Uses a relative path to load the skill dynamically.
        const mod = (await import(`${skillsRel}/${name}/index`)) as {
          default?: new (skillsDir: string, name: string) => Skill;
        };
        if (!mod.default) {
          return;
        }
        registry[name] = new mod.default(skillsDir, name);
      } catch (error) {
        console.error(`Failed to load skill "${name}":`, error);
        return;
      }
    }),
  );

  return registry;
}
