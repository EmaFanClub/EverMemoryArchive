/**
 * @prism-shadow/use-ema - Penguin Workbench Module Implementation
 *
 * Provides backend routing and API handlers for guiding users to create EMA
 * lifelong AI companions or install personality features using @prism-shadow/ema.
 */

import {
  DEFAULT_EMA_CONFIG,
  DEFAULT_PERSONALITY_FEATURE_CONFIG,
  EMA_AGENT_PRESETS,
  PERSONALITY_FEATURE_PRESETS,
  generateEmaAgent,
  buildEmaSystemPrompt,
  buildEmaAgentsMd,
  buildPersonalityFeaturePrompt,
  installPersonalityFeatureToAgentsMd,
  hasPersonalityFeature,
  validateEmaAgentConfig,
  generatePenguinSystemConfigYaml,
  getAgentPreset,
  getPersonalityPreset,
  installWebWorkbench,
  type EmaAgentConfig,
  type EmaPersonalityFeatureConfig,
  type WebWorkbenchInstallOptions,
} from "@prism-shadow/ema";

export interface WorkbenchHost {
  listAgents?: () => Array<{ agentId: string }>;
  createSession?: (options?: { agentId?: string }) => Promise<{ sessionId: string }>;
  run?: (
    sessionId: string,
    inputs: Array<{ text: string }>,
  ) => Promise<{ sessionId: string; queued: boolean }>;
  sessionStatus?: (sessionId: string) => string;
  sessionTitle?: (sessionId: string) => null | string;
  sessionResult?: (
    sessionId: string,
  ) => Promise<{ status: "running" | "completed" | "failed"; text: string; error: null | string }>;
  subscribe?: (sessionId: string, listener: (record: unknown) => void) => () => void;
  getState?: () => unknown;
  setState?: (state: unknown) => Promise<void>;
  log?: (text: string) => void;
}

export interface WorkbenchRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  bytes?: Uint8Array;
}

export interface WorkbenchResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  bytes?: Uint8Array;
}

export interface WorkbenchModuleCtx<Use = { host: WorkbenchHost }> {
  use: Use;
  effect?: (dispose: () => void) => void;
}

/**
 * Dispatches an incoming workbench API request.
 */
export async function handleWorkbenchRequest(
  req: WorkbenchRequest,
  host?: WorkbenchHost,
): Promise<WorkbenchResponse> {
  const path = req.path.replace(/\/$/, ""); // Normalize trailing slash

  // Health check
  if (req.method === "GET" && (path === "" || path === "/api/health" || path === "/health")) {
    return {
      status: 200,
      body: {
        status: "ok",
        service: "@prism-shadow/use-ema",
        version: "0.1.0",
        mission: "We build lifelong AI companions that grow, remember, and evolve with you.",
      },
    };
  }

  // Retrieve presets
  if (req.method === "GET" && path === "/api/presets") {
    return {
      status: 200,
      body: {
        agentPresets: EMA_AGENT_PRESETS,
        personalityPresets: PERSONALITY_FEATURE_PRESETS,
        defaultAgentConfig: DEFAULT_EMA_CONFIG,
        defaultPersonalityConfig: DEFAULT_PERSONALITY_FEATURE_CONFIG,
      },
    };
  }

  // List existing agents in Penguin project (if host provides listAgents)
  if (req.method === "GET" && path === "/api/agents") {
    const agents = host?.listAgents ? host.listAgents() : [];
    return {
      status: 200,
      body: { agents },
    };
  }

  // Generate EMA Companion Agent Prompt & Config
  if (req.method === "POST" && path === "/api/generate-agent") {
    const body = (req.body || {}) as Partial<EmaAgentConfig>;
    const validation = validateEmaAgentConfig(body);
    if (!validation.valid) {
      return {
        status: 400,
        body: { error: validation.errors.join("; "), errors: validation.errors },
      };
    }

    const generated = generateEmaAgent(body);
    const systemConfigYaml = generatePenguinSystemConfigYaml(body);

    return {
      status: 200,
      body: {
        success: true,
        agent: generated,
        systemConfigYaml,
      },
    };
  }

  // Install EMA Personality Feature into existing AGENTS.md
  if (req.method === "POST" && path === "/api/install-personality") {
    const body = (req.body || {}) as {
      existingAgentsMd?: string;
      config?: Partial<EmaPersonalityFeatureConfig>;
    };

    const existing = body.existingAgentsMd || "";
    const featureConfig = body.config || {};
    const updatedAgentsMd = installPersonalityFeatureToAgentsMd(existing, featureConfig);
    const featurePrompt = buildPersonalityFeaturePrompt(featureConfig);
    const alreadyHad = hasPersonalityFeature(existing);

    return {
      status: 200,
      body: {
        success: true,
        updatedAgentsMd,
        featurePrompt,
        wasUpdated: alreadyHad,
      },
    };
  }

  // Install Web Companion Portal Workbench into a Penguin Agent
  if (req.method === "POST" && path === "/api/install-workbench") {
    const body = (req.body || {}) as Partial<WebWorkbenchInstallOptions>;
    if (!body.agentId || typeof body.agentId !== "string") {
      return {
        status: 400,
        body: { error: "Missing required 'agentId' parameter." },
      };
    }
    try {
      const result = installWebWorkbench(body as WebWorkbenchInstallOptions);
      return {
        status: 200,
        body: {
          success: true,
          workbench: result,
        },
      };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  // Quick Preset Generator
  if (req.method === "POST" && path === "/api/quick-setup") {
    const body = (req.body || {}) as { presetId: string; type: "agent" | "personality" };
    if (body.type === "agent") {
      const preset = getAgentPreset(body.presetId);
      if (!preset) {
        return { status: 404, body: { error: `Preset '${body.presetId}' not found.` } };
      }
      const generated = generateEmaAgent(preset.config);
      const systemConfigYaml = generatePenguinSystemConfigYaml(preset.config);
      return {
        status: 200,
        body: { success: true, preset, agent: generated, systemConfigYaml },
      };
    } else {
      const preset = getPersonalityPreset(body.presetId);
      if (!preset) {
        return { status: 404, body: { error: `Preset '${body.presetId}' not found.` } };
      }
      const featurePrompt = buildPersonalityFeaturePrompt(preset.config);
      return {
        status: 200,
        body: { success: true, preset, featurePrompt },
      };
    }
  }

  // Default: Route not found
  return {
    status: 404,
    body: {
      error: `Route not found: ${req.method} ${req.path}`,
    },
  };
}

/**
 * Standard Penguin Workbench Module Factory.
 */
export function createWorkbenchModule(ctx: WorkbenchModuleCtx<{ host: WorkbenchHost }>) {
  const host = ctx.use.host;
  return {
    api: {
      main: {
        async handle(req: WorkbenchRequest): Promise<WorkbenchResponse> {
          return handleWorkbenchRequest(req, host);
        },
      },
    },
  };
}

/**
 * Penguin Workbench Package default export.
 */
export default {
  modules: {
    Workbench: {
      create: createWorkbenchModule,
    },
  },
};
