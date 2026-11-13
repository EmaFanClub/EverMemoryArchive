import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  handleWorkbenchRequest,
  setPersonasDirOverride,
  type WorkbenchHost,
} from "../module.js";

describe("Penguin Workbench Module (Use EMA)", () => {
  it("responds to health check route", async () => {
    const res = await handleWorkbenchRequest({
      method: "GET",
      path: "/api/health",
    });

    expect(res.status).toBe(200);
    expect((res.body as any).status).toBe("ok");
    expect((res.body as any).service).toBe("@prism-shadow/use-ema");
  });

  it("returns available companion and personality presets", async () => {
    const res = await handleWorkbenchRequest({
      method: "GET",
      path: "/api/presets",
    });

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.agentPresets.length).toBeGreaterThan(0);
    expect(body.personalityPresets.length).toBeGreaterThan(0);
  });

  it("lists project agents from WorkbenchHost", async () => {
    const mockHost: WorkbenchHost = {
      listAgents: () => [{ agentId: "agent_alpha" }, { agentId: "agent_beta" }],
    };

    const res = await handleWorkbenchRequest(
      {
        method: "GET",
        path: "/api/agents",
      },
      mockHost,
    );

    expect(res.status).toBe(200);
    expect((res.body as any).agents).toHaveLength(2);
    expect((res.body as any).agents[0].agentId).toBe("agent_alpha");
  });

  it("generates EMA companion agent configuration via POST /api/generate-agent", async () => {
    const res = await handleWorkbenchRequest({
      method: "POST",
      path: "/api/generate-agent",
      body: {
        id: "lumi_companion",
        name: "Lumi",
        title: "Thought Partner",
        warmthLevel: "playful",
        relationshipRole: "curious_explorer",
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.success).toBe(true);
    expect(body.agent.agentsMd).toContain("Lumi");
    expect(body.agent.systemPrompt).toContain("Lumi");
    expect(body.systemConfigYaml).toContain('name: "Lumi"');
  });

  it("validates and rejects invalid agent ID in POST /api/generate-agent", async () => {
    const res = await handleWorkbenchRequest({
      method: "POST",
      path: "/api/generate-agent",
      body: {
        id: "invalid-id-with-dashes",
        name: "Test",
      },
    });

    expect(res.status).toBe(400);
    expect((res.body as any).error).toContain(
      "Agent ID must contain only letters, numbers, and underscores",
    );
  });

  it("installs personality feature into AGENTS.md via POST /api/install-personality", async () => {
    const existing = `# Support Agent\n\nYou resolve tickets.`;
    const res = await handleWorkbenchRequest({
      method: "POST",
      path: "/api/install-personality",
      body: {
        existingAgentsMd: existing,
        config: {
          warmthLevel: "warm",
          personalityTraits: ["Empathetic responses"],
        },
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.success).toBe(true);
    expect(body.updatedAgentsMd).toContain("# Support Agent");
    expect(body.updatedAgentsMd).toContain("<!-- EMA_PERSONALITY_FEATURE_START -->");
    expect(body.updatedAgentsMd).toContain("<!-- EMA_PERSONALITY_FEATURE_END -->");
  });

  it("installs companion_portal workbench via POST /api/install-workbench", async () => {
    const tmpAppDataDir = `/tmp/use-ema-test-wb-${Date.now()}`;
    const res = await handleWorkbenchRequest({
      method: "POST",
      path: "/api/install-workbench",
      body: {
        agentId: "aoi_rei",
        appDataDir: tmpAppDataDir,
        companionName: "苍星怜",
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.success).toBe(true);
    expect(body.workbench.workbenchId).toBe("companion_portal");
    expect(fs.existsSync(path.join(body.workbench.workbenchDir, "index.ts"))).toBe(true);
    fs.rmSync(tmpAppDataDir, { recursive: true, force: true });
  });

  it("returns 404 for unknown route", async () => {
    const res = await handleWorkbenchRequest({
      method: "GET",
      path: "/api/unknown-endpoint",
    });

    expect(res.status).toBe(404);
  });

  describe("Persona & Playscript Hot Update API", () => {
    let tmpPersonasDir = "";

    beforeAll(() => {
      tmpPersonasDir = fs.mkdtempSync("/tmp/use-ema-personas-fixture-");
      for (const id of ["sakana-chan", "sakana-kawaii"]) {
        const pDir = path.join(tmpPersonasDir, id);
        fs.mkdirSync(path.join(pDir, "script"), { recursive: true });
        fs.mkdirSync(path.join(pDir, "constraints"), { recursive: true });
        fs.writeFileSync(
          path.join(pDir, "persona.toml"),
          [
            "[persona]",
            `name = "大肥鱼"`,
            `display_name = "大肥鱼 (鱼鱼)"`,
            `summary = "深海蓝鲸化身的小鱼干。"`,
            "",
            "[speech_style]",
            `tone = "温软粘人"`,
          ].join("\n"),
          "utf8",
        );
        fs.writeFileSync(
          path.join(pDir, "script", "index.toml"),
          `title = "大肥鱼剧本"\n`,
          "utf8",
        );
        fs.writeFileSync(
          path.join(pDir, "script", "chapters.toml"),
          [
            "[[chapters]]",
            `id = "chapter_01"`,
            `order = 1`,
            `title = "序章"`,
            `setting_time = "深海"`,
            `lines = [{ type = "dialogue", speaker = "sakana", text = "你好呀，我是背着铁饭盆的大肥鱼。" }]`,
          ].join("\n"),
          "utf8",
        );
        fs.writeFileSync(
          path.join(pDir, "constraints", "persona-constraints.md"),
          "# Persona Constraints\n",
          "utf8",
        );
      }
      setPersonasDirOverride(tmpPersonasDir);
    });

    afterAll(() => {
      setPersonasDirOverride(null);
      if (tmpPersonasDir && fs.existsSync(tmpPersonasDir)) {
        fs.rmSync(tmpPersonasDir, { recursive: true, force: true });
      }
    });

    it("lists personas including sakana-chan via GET /api/personas", async () => {
      const res = await handleWorkbenchRequest({
        method: "GET",
        path: "/api/personas",
      });

      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.personas).toBeDefined();
      const sakana = body.personas.find((p: any) => p.id === "sakana-chan");
      expect(sakana).toBeDefined();
      expect(sakana.hasScript).toBe(true);
      expect(sakana.hasConstraints).toBe(true);
    });

    it("retrieves sakana-chan details with parsed TOML via GET /api/persona", async () => {
      const res = await handleWorkbenchRequest({
        method: "GET",
        path: "/api/persona",
        query: { id: "sakana-chan" },
      });

      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(body.persona.id).toBe("sakana-chan");
      expect(body.persona.parsed.persona).toBeDefined();
      expect(body.persona.parsed.persona.persona.display_name).toContain("大肥鱼");
      expect(body.persona.parsed.chapters.chapters.length).toBeGreaterThan(0);
      expect(body.persona.parsed.chapters.chapters[0].lines.length).toBeGreaterThan(0);
    });

    it("rejects invalid TOML update with 400 error via POST /api/persona/update", async () => {
      const res = await handleWorkbenchRequest({
        method: "POST",
        path: "/api/persona/update",
        body: {
          id: "sakana-chan",
          personaToml: "broken_toml = [ unclosed array",
        },
      });

      expect(res.status).toBe(400);
      const body = res.body as any;
      expect(body.error).toContain("Invalid persona.toml");
    });

    it("appends a new line via POST /api/persona/append-line", async () => {
      const getInitRes = await handleWorkbenchRequest({
        method: "GET",
        path: "/api/persona",
        query: { id: "sakana-chan" },
      });
      const originalChaptersToml = (getInitRes.body as any).persona.chaptersToml;

      try {
        const res = await handleWorkbenchRequest({
          method: "POST",
          path: "/api/persona/append-line",
          body: {
            id: "sakana-chan",
            chapterId: "chapter_01",
            line: {
              type: "dialogue",
              speaker: "sakana",
              text: "“测试热更新：又吹了一个新的水泡泡。”",
            },
          },
        });

        expect(res.status).toBe(200);
        const body = res.body as any;
        expect(body.success).toBe(true);
        expect(body.addedLine.speaker).toBe("sakana");
        expect(body.addedLine.text).toContain("测试热更新");

        // Verify it is readable via GET /api/persona
        const getRes = await handleWorkbenchRequest({
          method: "GET",
          path: "/api/persona",
          query: { id: "sakana-chan" },
        });
        const lines = (getRes.body as any).persona.parsed.chapters.chapters[0].lines;
        const lastLine = lines[lines.length - 1];
        expect(lastLine.text).toContain("测试热更新");
      } finally {
        // Restore original chapters.toml
        await handleWorkbenchRequest({
          method: "POST",
          path: "/api/persona/update",
          body: {
            id: "sakana-chan",
            chaptersToml: originalChaptersToml,
          },
        });
      }
    });

    it("uploads and serves PNG avatars per persona via POST /api/persona/avatar and GET /api/persona", async () => {
      const tinyPngDataUrl =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      for (const id of ["sakana-chan", "sakana-kawaii"]) {
        const uploadRes = await handleWorkbenchRequest({
          method: "POST",
          path: "/api/persona/avatar",
          body: { id, dataUrl: tinyPngDataUrl },
        });
        expect(uploadRes.status).toBe(200);
        expect((uploadRes.body as any).success).toBe(true);
      }

      for (const id of ["sakana-chan", "sakana-kawaii"]) {
        const res = await handleWorkbenchRequest({
          method: "GET",
          path: "/api/persona",
          query: { id },
        });
        expect(res.status).toBe(200);
        const persona = (res.body as any).persona;
        expect(persona.avatarDataUrl).toBe(tinyPngDataUrl);
        expect(persona.speakerAvatars["sakana-chan"]).toBe(tinyPngDataUrl);
        expect(persona.speakerAvatars["sakana-kawaii"]).toBe(tinyPngDataUrl);
      }
    });

    it("loads live chat session state for sakana-kawaii via GET /api/persona/chat", async () => {
      const res = await handleWorkbenchRequest({
        method: "GET",
        path: "/api/persona/chat",
        query: { id: "sakana-kawaii" },
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(body.chat.personaId).toBe("sakana-kawaii");
      expect(body.chat.agentId).toBe("sakana_kawaii");
      expect(body.chat.messages.length).toBeGreaterThan(0);
      expect(body.chat.messages[0].role).toBe("companion");
    });
  });
});
