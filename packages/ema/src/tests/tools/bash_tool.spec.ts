import { describe, it, expect, beforeEach } from "vitest";
import { BashKillTool, BashOutputTool, BashTool } from "../../tools/bash_tool";

describe("BashTool", () => {
  let bashTool: BashTool;

  beforeEach(() => {
    bashTool = new BashTool();
  });

  describe("initialization", () => {
    it("should have correct name", () => {
      expect(bashTool.name).toBe("bash");
    });

    it("should have correct description", () => {
      expect(bashTool.description).toContain("Execute");
    });

    it("should have required parameters schema", () => {
      const params = bashTool.parameters;
      expect(params.type).toBe("object");
      expect(params.properties).toHaveProperty("command");
      expect(params.required).toContain("command");
    });
  });

  describe("execute", () => {
    it("should execute simple commands successfully", async () => {
      const result = await bashTool.execute('echo "Hello World"');
      expect(result.success).toBe(true);
      expect(result.content).toContain("Hello World");
    });

    it("should handle command with output", async () => {
      const result = await bashTool.execute("pwd");
      expect(result.success).toBe(true);
      expect(result.content).toBeTruthy();
    });

    it("should handle command errors", async () => {
      const result = await bashTool.execute("nonexistentcommand123456");
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should handle empty command", async () => {
      const result = await bashTool.execute("");
      expect(result).toBeDefined();
    });

    it("should handle multi-line commands", async () => {
      const command = 'echo "line1" && echo "line2"';
      const result = await bashTool.execute(command);
      expect(result.success).toBe(true);
      expect(result.content).toContain("line1");
      expect(result.content).toContain("line2");
    });

    it("should handle command timeout", async () => {
      const result = await bashTool.execute("sleep 5", 1);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout|timed out/i);
    }, 15000);

    it("should run background commands", async () => {
      const result = await bashTool.execute("sleep 2", 120, true);
      expect(result.success).toBe(true);
      expect(result.content).toContain("background");
    });

    it("should separate stdout and stderr for background commands", async () => {
      const outputTool = new BashOutputTool();
      const killTool = new BashKillTool();

      const result = await bashTool.execute(
        `node -e "console.log('out'); console.error('err'); setTimeout(()=>{}, 500)"`,
        120,
        true,
      );

      const bashId = (result as any).bashId as string | null | undefined;
      expect(bashId).toBeTruthy();

      let collectedStdout = "";
      let collectedStderr = "";
      try {
        for (let attempt = 0; attempt < 20; attempt++) {
          const outputResult: any = await outputTool.execute(bashId as string);
          if (outputResult?.stdout)
            collectedStdout += `${outputResult.stdout}\n`;
          if (outputResult?.stderr)
            collectedStderr += `${outputResult.stderr}\n`;

          if (
            collectedStdout.includes("out") &&
            collectedStderr.includes("err")
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        expect(collectedStdout).toContain("out");
        expect(collectedStderr).toContain("err");
      } finally {
        await killTool.execute(bashId as string);
      }
    }, 15000);
  });

  describe("output handling", () => {
    it("should capture stdout", async () => {
      const result = await bashTool.execute('echo "test output"');
      expect(result.success).toBe(true);
      expect(result.content).toContain("test output");
    });

    it("should handle special characters in command", async () => {
      const result = await bashTool.execute('echo "test & test | test"');
      expect(result.success).toBe(true);
      expect(result.content).toContain("test & test | test");
    });

    it("should handle commands with no output", async () => {
      const result = await bashTool.execute("true");
      expect(result.success).toBe(true);
    });
  });

  describe("cross-platform", () => {
    it("should work on current platform", async () => {
      // Test a command that works on both Unix and Windows
      const result = await bashTool.execute('echo "cross-platform test"');
      expect(result.success).toBe(true);
      expect(result.content).toContain("cross-platform test");
    });
  });
});
