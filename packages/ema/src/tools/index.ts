export * from "./base";

import type { Tool } from "./base";
import { KeepSilenceTool } from "./keep_silence_tool";
import { EmaReplyTool } from "./ema_reply_tool";
import { GetSkillTool } from "./get_skill_tool";
import { ExecSkillTool } from "./exec_skill_tool";
import { ListConversationsTool } from "./list_conversations_tool";
import { skillRegistry } from "../skills";

export const baseTools: Tool[] = [
  new EmaReplyTool(),
  new KeepSilenceTool(),
  new ListConversationsTool(),
  new GetSkillTool(skillRegistry),
  new ExecSkillTool(skillRegistry),
];
