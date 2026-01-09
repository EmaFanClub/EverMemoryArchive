import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ToolResult } from "../tools/base";

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

  /** One-line human-readable description of the skill. */
  abstract get description(): string;

  /** JSON Schema describing the arguments the skill accepts. */
  abstract get parameters(): Record<string, any>;

  /**
   * Execute the skill.
   * @param args - Arguments object that should satisfy `parameters`.
   */
  abstract execute(...args: any[]): Promise<ToolResult>;

  /** Minimal metadata used for listing in prompts/UI. */
  get metadata(): Record<string, string> {
    return {
      name: this.name,
      description: this.description,
    };
  }

  /**
   * Load the SKILL.md playbook (strips frontmatter) and append parameter hints.
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
    const match = content.match(/^---\n[\s\S]*?\n---\s*\n?([\s\S]*)$/);
    const playbook = match ? match[1] : content;
    const parametersHint =
      "\n\n## Parameters\n\n" + JSON.stringify(this.parameters, null, 2);
    return `${playbook.trim()}${parametersHint}`;
  }
}

/**
 * Build a human-readable list of available skills for prompt injection.
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

const defaultSkillsDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dynamically import a skill module, preferring the bundler-friendly path and
 * falling back to file:// when running directly under Node.
 */
async function importSkillModule(name: string, indexPath: string) {
  // 1) bundler-friendly import so Next/Turbopack can transpile TS on the fly
  try {
    return await import(
      /* webpackInclude: /\.\/[^/]+\/index\.[tj]s$/ */
      /* webpackMode: "lazy" */
      `./${name}/index`
    );
  } catch {
    // 2) fallback for direct Node execution (no bundler)
    return await import(
      /* webpackIgnore: true */ pathToFileURL(indexPath).href
    );
  }
}

/**
 * Discover and instantiate skills under the given directory.
 * @param skillsDir - Directory containing skill folders.
 * @returns Registry keyed by skill name.
 */
export async function loadSkills(
  skillsDir: string = defaultSkillsDir,
): Promise<SkillRegistry> {
  const registry: SkillRegistry = {};
  if (!fs.existsSync(skillsDir)) {
    return registry;
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skillNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  await Promise.all(
    skillNames.map(async (name) => {
      try {
        const skillDir = path.join(skillsDir, name);
        const indexCandidates = [
          path.join(skillDir, "index.js"),
          path.join(skillDir, "index.mjs"),
          path.join(skillDir, "index.ts"),
        ];
        const indexPath = indexCandidates.find((p) => fs.existsSync(p));
        if (!indexPath) return;
        const mod = (await importSkillModule(name, indexPath)) as {
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
