export * from "./base";

import { buildSkillsPrompt, loadSkills } from "./base";

export const skillRegistry = await loadSkills();

export const skillsPrompt = buildSkillsPrompt(skillRegistry);
