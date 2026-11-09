import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { handleWorkbenchRequest, type WorkbenchHost } from "../module.js";

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
});
