/**
 * Skill Loader - Load Claude Skills
 *
 * Supports loading skills from SKILL.md files and providing them to Agent
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

/** Skill data structure */
export class Skill {
  name: string;
  description: string;
  content: string;
  license?: string | null;
  allowedTools?: string[] | null;
  metadata?: Record<string, string> | null;
  skillPath?: string | null;

  constructor(options: {
    name: string;
    description: string;
    content: string;
    license?: string | null;
    allowedTools?: string[] | null;
    metadata?: Record<string, string> | null;
    skillPath?: string | null;
  }) {
    this.name = options.name;
    this.description = options.description;
    this.content = options.content;
    this.license = options.license ?? null;
    this.allowedTools = options.allowedTools ?? null;
    this.metadata = options.metadata ?? null;
    this.skillPath = options.skillPath ?? null;
  }

  /** Convert skill to prompt format */
  toPrompt(): string {
    return `
# Skill: ${this.name}

${this.description}

---

${this.content}
`;
  }
}

export class SkillLoader {
  skillsDir: string;
  loadedSkills: Record<string, Skill>;

  /**
   * Initialize Skill Loader
   *
   * @param skillsDir Skills directory path
   */
  constructor(skillsDir: string = "./skills") {
    this.skillsDir = path.resolve(skillsDir);
    this.loadedSkills = {};
  }

  /**
   * Load single skill from SKILL.md file
   *
   * @param skillPath SKILL.md file path
   * @returns Skill object, or null if loading fails
   */
  loadSkill(skillPath: string): Skill | null {
    try {
      const content = fs.readFileSync(skillPath, "utf-8");

      // Parse YAML frontmatter
      const frontmatterMatch = content.match(/^---\n(.*?)\n---\n(.*)$/s);

      if (!frontmatterMatch) {
        console.log(`⚠️  ${skillPath} missing YAML frontmatter`);
        return null;
      }

      const frontmatterText = frontmatterMatch[1];
      const skillContent = frontmatterMatch[2].trim();

      // Parse YAML
      let frontmatter: any;
      try {
        frontmatter = yaml.load(frontmatterText);
      } catch (error) {
        console.log(`❌ Failed to parse YAML frontmatter: ${error}`);
        return null;
      }

      // Required fields
      if (!frontmatter?.name || !frontmatter?.description) {
        console.log(
          `⚠️  ${skillPath} missing required fields (name or description)`,
        );
        return null;
      }

      // Get skill directory (parent of SKILL.md)
      const skillDir = path.dirname(skillPath);

      // Replace relative paths in content with absolute paths
      // This ensures scripts and resources can be found from any working directory
      const processedContent = this._processSkillPaths(skillContent, skillDir);

      // Create Skill object
      const skill = new Skill({
        name: frontmatter.name as string,
        description: frontmatter.description as string,
        content: processedContent,
        license: (frontmatter.license as string | undefined) ?? null,
        allowedTools:
          (frontmatter["allowed-tools"] as string[] | undefined) ?? null,
        metadata:
          (frontmatter.metadata as Record<string, string> | undefined) ?? null,
        skillPath,
      });

      return skill;
    } catch (error) {
      console.log(`❌ Failed to load skill (${skillPath}): ${error}`);
      return null;
    }
  }

  /**
   * Process skill content to replace relative paths with absolute paths.
   *
   * Supports Progressive Disclosure Level 3+: converts relative file references
   * to absolute paths so Agent can easily read nested resources.
   *
   * @param content Original skill content
   * @param skillDir Skill directory path
   * @returns Processed content with absolute paths
   */
  _processSkillPaths(content: string, skillDir: string): string {
    // Pattern 1: Directory-based paths (scripts/, examples/, templates/, reference/)
    const replaceDirPath = (match: string, prefix: string, relPath: string) => {
      const absPath = path.join(skillDir, relPath);
      if (fs.existsSync(absPath)) {
        return `${prefix}${absPath}`;
      }
      return match;
    };

    const patternDirs =
      /(python\s+|`)((?:scripts|examples|templates|reference)\/[^\s`\)]+)/g;
    content = content.replace(patternDirs, replaceDirPath);

    // Pattern 2: Direct markdown/document references (forms.md, reference.md, etc.)
    // Matches phrases like "see reference.md" or "read forms.md"
    const replaceDocPath = (
      match: string,
      prefix: string,
      filename: string,
      suffix: string,
    ) => {
      const absPath = path.join(skillDir, filename);
      if (fs.existsSync(absPath)) {
        // Add helpful instruction for Agent
        return `${prefix}\`${absPath}\` (use read_file to access)${suffix}`;
      }
      return match;
    };

    const patternDocs =
      /(see|read|refer to|check)\s+([a-zA-Z0-9_-]+\.(?:md|txt|json|yaml))([.,;\s])/gi;
    content = content.replace(patternDocs, replaceDocPath);

    // Pattern 3: Markdown links - supports multiple formats:
    // - [`filename.md`](filename.md) - simple filename
    // - [text](./reference/file.md) - relative path with ./
    // - [text](scripts/file.js) - directory-based path
    // Matches patterns like: "Read [`docx-js.md`](docx-js.md)" or "Load [Guide](./reference/guide.md)"
    const replaceMarkdownLink = (
      match: string,
      prefix: string | undefined,
      linkText: string,
      filepath: string,
    ) => {
      // Remove leading ./ if present
      const cleanPath = filepath.startsWith("./")
        ? filepath.slice(2)
        : filepath;

      const absPath = path.join(skillDir, cleanPath);
      if (fs.existsSync(absPath)) {
        // Preserve the link text style (with or without backticks)
        const prefixText = prefix ? `${prefix} ` : "";
        return `${prefixText}[${linkText}](\`${absPath}\`) (use read_file to access)`;
      }
      return match;
    };

    const patternMarkdown =
      /(?:(Read|See|Check|Refer to|Load|View)\s+)?\[(`?[^`\]]+`?)\]\(((?:\.\/)?[^)]+\.(?:md|txt|json|yaml|js|py|html))\)/gi;
    content = content.replace(patternMarkdown, replaceMarkdownLink);

    return content;
  }

  /**
   * Discover and load all skills in the skills directory
   *
   * @returns List of Skills
   */
  discoverSkills(): Skill[] {
    const skills: Skill[] = [];

    if (!fs.existsSync(this.skillsDir)) {
      console.log(`⚠️  Skills directory does not exist: ${this.skillsDir}`);
      return skills;
    }

    const skillFiles: string[] = [];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else if (entry.isFile() && entry.name === "SKILL.md") {
          skillFiles.push(entryPath);
        }
      }
    };

    walk(this.skillsDir);

    for (const skillFile of skillFiles) {
      const skill = this.loadSkill(skillFile);
      if (skill) {
        skills.push(skill);
        this.loadedSkills[skill.name] = skill;
      }
    }

    return skills;
  }

  /**
   * Get loaded skill
   *
   * @param name Skill name
   * @returns Skill object, or null if not found
   */
  getSkill(name: string): Skill | null {
    return this.loadedSkills[name] ?? null;
  }

  /**
   * List all loaded skill names
   *
   * @returns List of skill names
   */
  listSkills(): string[] {
    return Object.keys(this.loadedSkills);
  }

  /**
   * Generate prompt containing ONLY metadata (name + description) for all skills.
   * This implements Progressive Disclosure - Level 1.
   *
   * @returns Metadata-only prompt string
   */
  getSkillsMetadataPrompt(): string {
    if (!Object.keys(this.loadedSkills).length) {
      return "";
    }

    const promptParts = ["## Available Skills\n"];
    promptParts.push(
      "You have access to specialized skills. Each skill provides expert guidance for specific tasks.\n",
    );
    promptParts.push(
      "Load a skill's full content using the appropriate skill tool when needed.\n",
    );

    // List all skills with their descriptions
    for (const skill of Object.values(this.loadedSkills)) {
      promptParts.push(`- \`${skill.name}\`: ${skill.description}`);
    }

    return promptParts.join("\n");
  }
}
