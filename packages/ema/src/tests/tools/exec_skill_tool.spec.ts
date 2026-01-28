import { describe, it, expect, vi } from "vitest";
import { ExecSkillTool } from "../../tools/exec_skill_tool";
import type { ToolResult } from "../../tools/base";
import { Skill } from "../../skills/base";

class StubSkill extends Skill {
  executeFn: (args?: any) => Promise<ToolResult>;
  constructor(executeFn: (args?: any) => Promise<ToolResult>, name = "stub") {
    super("/tmp", name);
    this.executeFn = executeFn;
  }
  get description() {
    return "stub";
  }
  get parameters() {
    return {};
  }
  async execute(args?: any): Promise<ToolResult> {
    return this.executeFn(args);
  }
}

describe("ExeSkillTool", () => {
  it("fails when skill missing", async () => {
    const tool = new ExecSkillTool({});
    const res = await tool.execute({ skill_name: "missing" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/does not exist/);
  });

  it("validates input schema", async () => {
    const tool = new ExecSkillTool({});
    const res = await tool.execute({ skill_name: "" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid exe_skill_tool input/);
  });

  it("executes skill with args", async () => {
    const execSpy = vi.fn(async (args?: any) => {
      return { success: true, content: JSON.stringify(args) };
    });
    const registry = { stub: new StubSkill(execSpy) };
    const tool = new ExecSkillTool(registry);
    const payload = { a: 1, b: "x" };
    const res = await tool.execute({ skill_name: "stub", skill_args: payload });
    expect(execSpy).toHaveBeenCalledWith(payload);
    expect(res.success).toBe(true);
    expect(res.content).toBe(JSON.stringify(payload));
  });

  it("executes skill without args", async () => {
    const execSpy = vi.fn(async (args?: any) => {
      return {
        success: true,
        content: args === undefined ? "no-args" : "with-args",
      };
    });
    const registry = { stub: new StubSkill(execSpy) };
    const tool = new ExecSkillTool(registry);
    const res = await tool.execute({ skill_name: "stub" });
    expect(execSpy).toHaveBeenCalledWith(undefined);
    expect(res.success).toBe(true);
    expect(res.content).toBe("no-args");
  });

  it("passes through failure ToolResult", async () => {
    const execSpy = vi.fn(async () => {
      return { success: false, error: "boom" };
    });
    const registry = { stub: new StubSkill(execSpy) };
    const tool = new ExecSkillTool(registry);
    const res = await tool.execute({
      skill_name: "stub",
      skill_args: { any: "thing" },
    });
    expect(execSpy).toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(res.error).toBe("boom");
  });

  it("propagates thrown errors", async () => {
    const execSpy = vi.fn(async () => {
      throw new Error("explode");
    });
    const registry = { stub: new StubSkill(execSpy) };
    const tool = new ExecSkillTool(registry);
    await expect(tool.execute({ skill_name: "stub" })).rejects.toThrow(
      "explode",
    );
  });
});
