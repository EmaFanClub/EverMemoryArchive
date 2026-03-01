import { describe, it, expect, vi } from "vitest";
import { GetSkillTool } from "../../tools/get_skill_tool";
import type { ToolResult } from "../../tools/base";
import { Skill } from "../../skills/base";

class StubSkill extends Skill {
  playbook: string;
  constructor(playbook: string, name: string = "stub") {
    super("/tmp", name);
    this.playbook = playbook;
  }
  get description() {
    return "stub";
  }
  get parameters() {
    return {};
  }
  async execute(): Promise<ToolResult> {
    return { success: true, content: "ok" };
  }
  async getPlaybook(): Promise<string> {
    return this.playbook;
  }
}

describe("GetSkillTool", () => {
  it("returns playbook when skill exists", async () => {
    const registry = { stub: new StubSkill("playbook") };
    const tool = new GetSkillTool(registry);
    const res = await tool.execute({ skill_name: "stub" });
    expect(res.success).toBe(true);
    expect(res.content).toBe("playbook");
  });

  it("fails when skill missing", async () => {
    const tool = new GetSkillTool({});
    const res = await tool.execute({ skill_name: "missing" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/does not exist/);
  });

  it("validates input schema", async () => {
    const registry = { stub: new StubSkill("playbook") };
    const tool = new GetSkillTool(registry);
    const res = await tool.execute({ skill_name: "" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid get_skill_tool input/);
  });

  it("validates non-string input", async () => {
    const registry = { stub: new StubSkill("playbook") };
    const tool = new GetSkillTool(registry);
    const res = await tool.execute({ skill_name: 123 as any });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid get_skill_tool input/);
  });

  it("calls getPlaybook exactly once", async () => {
    const getPlaybook = vi.fn(async () => "doc");
    class SpySkill extends StubSkill {
      async getPlaybook(): Promise<string> {
        return getPlaybook();
      }
    }
    const registry = { spy: new SpySkill("doc", "spy") };
    const tool = new GetSkillTool(registry);
    const res = await tool.execute({ skill_name: "spy" });
    expect(res.success).toBe(true);
    expect(res.content).toBe("doc");
    expect(getPlaybook).toHaveBeenCalledTimes(1);
  });
});
